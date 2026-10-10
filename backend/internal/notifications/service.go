package notifications

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/events"
	"gripello/internal/platform/jobs"
	"gripello/internal/platform/push"
)

const (
	TopicNotify            = "notify"
	KindNotify             = "notify"
	TopicOwnNotifications  = "own_notifications"
	TopicPushSubscriptions = "push_subscriptions"
	pushJob                = "push"

	readRetention   = 30 * 24 * time.Hour
	maxRetention    = 90 * 24 * time.Hour
	wallDigestEvery = 15 * time.Minute
)

type Notify struct {
	Type   string         `json:"type"`
	Users  []string       `json:"users"`
	Gym    string         `json:"gym"`
	Params map[string]any `json:"params"`
	URL    string         `json:"url"`
}

type Notification struct {
	ID      string         `json:"id"`
	Created time.Time      `json:"created"`
	Updated time.Time      `json:"updated"`
	User    string         `json:"user"`
	Type    string         `json:"type"`
	Params  map[string]any `json:"params"`
	URL     string         `json:"url"`
	Read    bool           `json:"read"`
}

type Change struct {
	Action string       `json:"action"`
	Record Notification `json:"record"`
}

const notificationColumns = `id, created, updated, "user", type, params, url, read`

func scanNotification(row pgx.CollectableRow) (Notification, error) {
	var n Notification
	err := row.Scan(&n.ID, &n.Created, &n.Updated, &n.User, &n.Type, &n.Params, &n.URL, &n.Read)
	return n, err
}

func publishChange(ctx context.Context, tx pgx.Tx, actor, action string, n Notification) error {
	return events.PublishAs(ctx, tx, actor, TopicOwnNotifications, "notification."+action, Change{Action: action, Record: n}, events.Audience{Users: []string{n.User}})
}

// Every replica's bus sees the event, so ids derive from event+user and the insert ignores repeats.
func notificationID(eventID int64, user string) string {
	sum := sha256.Sum256(fmt.Appendf(nil, "%d:%s", eventID, user))
	id := make([]byte, 15)
	for i := range id {
		id[i] = "abcdefghijklmnopqrstuvwxyz0123456789"[int(sum[i])%36]
	}
	return string(id)
}

func (m *module) onNotify(e events.Event) {
	if e.Kind != KindNotify {
		return
	}
	var n Notify
	if json.Unmarshal(e.Payload, &n) != nil || n.Type == "" || len(n.Users) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := withRetries(deliveryAttempts, deliveryBackoff, func() error { return m.deliver(ctx, e.ID, n) }); err != nil {
		slog.Error("notifications: delivery failed", "event", e.ID, "type", n.Type, "error", err)
	}
}

const (
	deliveryAttempts = 3
	deliveryBackoff  = 500 * time.Millisecond
)

// withRetries doubles the pause after each failure; deliver is idempotent per event and user, so a rerun never duplicates.
func withRetries(attempts int, backoff time.Duration, fn func() error) error {
	err := fn()
	for attempt := 1; err != nil && attempt < attempts; attempt++ {
		time.Sleep(backoff)
		backoff *= 2
		err = fn()
	}
	return err
}

func (m *module) deliver(ctx context.Context, eventID int64, n Notify) error {
	notificationIDs := make([]string, len(n.Users))
	for i, user := range n.Users {
		notificationIDs[i] = notificationID(eventID, user)
	}
	params := n.Params
	if params == nil {
		params = map[string]any{}
	}
	var created []Notification
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `INSERT INTO notifications (id, "user", type, params, url)
			SELECT n.id, n.u, $3, $4, $5 FROM unnest($1::text[], $2::text[]) AS n(id, u) JOIN users ON users.id = n.u
			ON CONFLICT (id) DO NOTHING RETURNING `+notificationColumns, notificationIDs, n.Users, n.Type, params, n.URL)
		if err != nil {
			return err
		}
		created, err = pgx.CollectRows(rows, scanNotification)
		if err != nil {
			return err
		}
		for _, row := range created {
			if err := publishChange(ctx, tx, "", "create", row); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil || !m.app.Push.Enabled() {
		return err
	}
	payload, _ := json.Marshal(pushJobPayload{Gym: n.Gym})
	for _, row := range created {
		// ponytail: enqueued after commit, a crash in between drops that push; move into the tx if it matters
		if err := jobs.Enqueue(ctx, m.app.DB, pushJob, row.ID, payload, 0); err != nil {
			return err
		}
	}
	return nil
}

type pushJobPayload struct {
	Gym string `json:"gym"`
}

func (m *module) pushWorker(ctx context.Context, job jobs.Job) error {
	var payload pushJobPayload
	json.Unmarshal(job.Payload, &payload)
	var (
		n        Notification
		language string
		muted    prefs
	)
	err := m.app.DB.QueryRow(ctx, `SELECT n.type, n.params, n.url, n."user", u.language, u.notification_prefs
		FROM notifications n JOIN users u ON u.id = n."user" WHERE n.id = $1`, job.Key).
		Scan(&n.Type, &n.Params, &n.URL, &n.User, &language, &muted)
	if err == pgx.ErrNoRows || (err == nil && !muted.wants(pushChannel, n.Type)) {
		return nil
	}
	if err != nil {
		return err
	}
	title := m.app.Cfg.AppName
	if payload.Gym != "" {
		var gymName string
		if m.app.DB.QueryRow(ctx, `SELECT name FROM gyms WHERE id = $1`, payload.Gym).Scan(&gymName) == nil && gymName != "" {
			title = gymName
		}
	}
	body, _ := json.Marshal(push.Payload{
		Title: title,
		Body:  push.Text(m.app.Locales, m.app.Locales.Language(language), n.Type, n.Params),
		URL:   n.URL,
		Tag:   n.Type,
	})
	subscriptions, err := m.subscriptionsOf(ctx, n.User, "")
	if err != nil {
		return err
	}
	m.sendAll(ctx, subscriptions, body)
	return nil
}

type subscription struct {
	id string
	push.Subscription
}

func (m *module) subscriptionsOf(ctx context.Context, user, endpoint string) ([]subscription, error) {
	rows, err := m.app.DB.Query(ctx, `SELECT id, endpoint, p256dh, auth FROM push_subscriptions
		WHERE "user" = $1 AND ($2 = '' OR endpoint = $2)`, user, endpoint)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (subscription, error) {
		var s subscription
		return s, row.Scan(&s.id, &s.Endpoint, &s.P256dh, &s.Auth)
	})
}

// A failed device must not re-push the others, so errors are logged, not retried.
func (m *module) sendAll(ctx context.Context, subscriptions []subscription, body []byte) {
	for _, s := range subscriptions {
		gone, err := m.app.Push.Send(ctx, s.Subscription, body)
		if err != nil {
			slog.Warn("push: send failed", "subscription", s.id, "error", err)
			continue
		}
		if gone {
			if err := m.deleteSubscription(ctx, "", s.id, ""); err != nil && err != pgx.ErrNoRows {
				slog.Error("push: dropping expired subscription failed", "subscription", s.id, "error", err)
			}
		}
	}
}

// ponytail: a restart between ticks drops that window's digest; persist the last run if it matters
func (m *module) notifyWallNewRoutes(ctx context.Context, now time.Time) error {
	end := now.UTC().Truncate(wallDigestEvery)
	rows, err := m.app.DB.Query(ctx, `SELECT r.wall, r.gym, w.name, g.slug, COUNT(*),
			ARRAY(SELECT id FROM users WHERE r.wall = ANY (followed_walls))
		FROM routes r JOIN walls w ON w.id = r.wall JOIN gyms g ON g.id = r.gym
		WHERE NOT r.archived AND r.created >= $1 AND r.created < $2
		GROUP BY r.wall, r.gym, w.name, g.slug`, end.Add(-wallDigestEvery), end)
	if err != nil {
		return err
	}
	digests, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Notify, error) {
		var wall, wallName, slug string
		var count int
		n := Notify{Type: "wall_new_routes"}
		err := row.Scan(&wall, &n.Gym, &wallName, &slug, &count, &n.Users)
		n.Params = map[string]any{"wall": wallName, "count": count}
		n.URL = "/" + slug + "/map?wall=" + wall
		return n, err
	})
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		for _, n := range digests {
			if len(n.Users) == 0 {
				continue
			}
			if err := events.PublishAs(ctx, tx, "", TopicNotify, KindNotify, n, events.Audience{}); err != nil {
				return err
			}
		}
		return nil
	})
}

func (m *module) pruneNotifications(ctx context.Context) error {
	tag, err := m.app.DB.Exec(ctx, `DELETE FROM notifications WHERE (read AND created < $1) OR created < $2`,
		time.Now().Add(-readRetention), time.Now().Add(-maxRetention))
	if err == nil {
		slog.Info("notifications: pruned expired entries", "rows", tag.RowsAffected())
	}
	return err
}
