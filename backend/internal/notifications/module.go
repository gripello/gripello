package notifications

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/push"
)

const (
	defaultPageSize     = 50
	maxPageSize         = 200
	testPushesPerMinute = 3
)

type module struct {
	app        *platform.App
	testPushes *limiter
}

func Register(app *platform.App) {
	m := &module{app: app, testPushes: &limiter{max: testPushesPerMinute, window: time.Minute, hits: map[string][]time.Time{}}}
	for pattern, handler := range map[string]httpx.Handler{
		"GET /me/notifications":              m.list,
		"POST /me/notifications/read":        m.markRead,
		"DELETE /me/notifications/{id}":      m.delete,
		"GET /notifications/settings":        m.settings,
		"GET /me/notification-prefs":         m.getPrefs,
		"PUT /me/notification-prefs":         m.putPrefs,
		"GET /me/push-subscriptions":         m.listSubscriptions,
		"POST /me/push-subscriptions":        m.subscribe,
		"DELETE /me/push-subscriptions/{id}": m.unsubscribe,
		"POST /me/push/test":                 m.testPush,
	} {
		app.Handle(pattern, handler)
	}
	app.Worker(pushJob, m.pushWorker)
	if app.Bus != nil {
		app.Bus.Subscribe(TopicNotify, m.onNotify)
	}
	app.Cron.Add("wallNewRoutes", "*/15 * * * *", func(ctx context.Context) error {
		return m.notifyWallNewRoutes(ctx, time.Now())
	})
	app.Cron.Add("notificationRetention", "23 3 * * *", m.pruneNotifications)
}

func invalid(field, message string) error {
	return httpx.NewError(http.StatusBadRequest, "Failed to process the request.").Field(field, "validation_invalid", message)
}

func (m *module) list(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	query := r.URL.Query()
	page, _ := strconv.Atoi(query.Get("page"))
	limit, _ := strconv.Atoi(query.Get("limit"))
	page = max(page, 1)
	if limit < 1 {
		limit = defaultPageSize
	}
	limit = min(limit, maxPageSize)
	unread := query.Get("unread") == "true" || query.Get("unread") == "1"
	var total int
	if err := m.app.DB.QueryRow(r.Context(), `SELECT COUNT(*) FROM notifications WHERE "user" = $1 AND (NOT $2 OR NOT read)`, p.UserID, unread).Scan(&total); err != nil {
		return err
	}
	rows, err := m.app.DB.Query(r.Context(), `SELECT `+notificationColumns+` FROM notifications
		WHERE "user" = $1 AND (NOT $2 OR NOT read) ORDER BY created DESC, id LIMIT $3 OFFSET $4`,
		p.UserID, unread, limit, (page-1)*limit)
	if err != nil {
		return err
	}
	items, err := pgx.CollectRows(rows, scanNotification)
	if err != nil {
		return err
	}
	if items == nil {
		items = []Notification{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items, "page": page, "limit": limit, "total": total})
	return nil
}

func (m *module) markRead(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	var body struct {
		IDs []string `json:"ids"`
		All bool     `json:"all"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if !body.All && len(body.IDs) == 0 {
		return invalid("ids", "Pass ids or all.")
	}
	err = pgx.BeginFunc(r.Context(), m.app.DB, func(tx pgx.Tx) error {
		rows, err := tx.Query(r.Context(), `UPDATE notifications SET read = true, updated = now()
			WHERE "user" = $1 AND NOT read AND ($2 OR id = ANY ($3)) RETURNING `+notificationColumns, p.UserID, body.All, body.IDs)
		if err != nil {
			return err
		}
		updated, err := pgx.CollectRows(rows, scanNotification)
		if err != nil {
			return err
		}
		for _, n := range updated {
			if err := publishChange(r.Context(), tx, p.UserID, "update", n); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (m *module) delete(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	err = pgx.BeginFunc(r.Context(), m.app.DB, func(tx pgx.Tx) error {
		rows, err := tx.Query(r.Context(), `DELETE FROM notifications WHERE id = $1 AND "user" = $2 RETURNING `+notificationColumns, r.PathValue("id"), p.UserID)
		if err != nil {
			return err
		}
		n, err := pgx.CollectExactlyOneRow(rows, scanNotification)
		if err == pgx.ErrNoRows {
			return httpx.ErrNotFound
		}
		if err != nil {
			return err
		}
		return publishChange(r.Context(), tx, p.UserID, "delete", n)
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (m *module) settings(w http.ResponseWriter, r *http.Request) error {
	httpx.JSON(w, http.StatusOK, map[string]any{"enabled": m.app.Push.Enabled(), "publicKey": m.app.Push.PublicKey(), "topics": topics})
	return nil
}

func (m *module) getPrefs(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	var current prefs
	if err := m.app.DB.QueryRow(r.Context(), `SELECT notification_prefs FROM users WHERE id = $1`, p.UserID).Scan(&current); err != nil {
		return err
	}
	if current == nil {
		current = prefs{}
	}
	httpx.JSON(w, http.StatusOK, current)
	return nil
}

func (m *module) putPrefs(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	var next prefs
	if err := httpx.Decode(r, &next); err != nil {
		return err
	}
	for channel, byTopic := range next {
		if channel != pushChannel {
			return invalid(channel, "Unknown channel.")
		}
		for key := range byTopic {
			if !knownTopic(key) {
				return invalid(channel, "Unknown topic "+key+".")
			}
		}
	}
	if next == nil {
		next = prefs{}
	}
	if _, err := m.app.DB.Exec(r.Context(), `UPDATE users SET notification_prefs = $2, updated = now() WHERE id = $1`, p.UserID, next); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, next)
	return nil
}

func knownTopic(key string) bool {
	for _, t := range topics {
		if t.Key == key {
			return true
		}
	}
	return false
}

type PushSubscription struct {
	ID       string    `json:"id"`
	Created  time.Time `json:"created"`
	Updated  time.Time `json:"updated"`
	User     string    `json:"user"`
	Endpoint string    `json:"endpoint"`
	Device   string    `json:"device"`
}

const subscriptionColumns = `id, created, updated, "user", endpoint, device`

func scanSubscription(row pgx.CollectableRow) (PushSubscription, error) {
	var s PushSubscription
	return s, row.Scan(&s.ID, &s.Created, &s.Updated, &s.User, &s.Endpoint, &s.Device)
}

func (m *module) listSubscriptions(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	rows, err := m.app.DB.Query(r.Context(), `SELECT `+subscriptionColumns+` FROM push_subscriptions WHERE "user" = $1 ORDER BY created DESC`, p.UserID)
	if err != nil {
		return err
	}
	items, err := pgx.CollectRows(rows, scanSubscription)
	if err != nil {
		return err
	}
	if items == nil {
		items = []PushSubscription{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	return nil
}

func (m *module) subscribe(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	var body struct {
		Endpoint string `json:"endpoint"`
		P256dh   string `json:"p256dh"`
		Auth     string `json:"auth"`
		Device   string `json:"device"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if !push.AllowedEndpoint(body.Endpoint) {
		return httpx.NewError(http.StatusBadRequest, "Unknown push service.")
	}
	if body.P256dh == "" || body.Auth == "" || len(body.P256dh) > 200 || len(body.Auth) > 100 {
		return invalid("p256dh", "Missing or invalid subscription keys.")
	}
	if len(body.Device) > 200 {
		return invalid("device", "Too long.")
	}
	var created PushSubscription
	err = pgx.BeginFunc(r.Context(), m.app.DB, func(tx pgx.Tx) error {
		var previous, p256dh, authSecret string
		err := tx.QueryRow(r.Context(), `SELECT "user", p256dh, auth FROM push_subscriptions WHERE endpoint = $1 FOR UPDATE`, body.Endpoint).Scan(&previous, &p256dh, &authSecret)
		if err != nil && err != pgx.ErrNoRows {
			return err
		}
		// An endpoint moves to another user (shared device, user switch) only when the caller holds the same keys as the browser.
		if previous != "" && previous != p.UserID && (p256dh != body.P256dh || authSecret != body.Auth) {
			return httpx.NewError(http.StatusConflict, "This push endpoint belongs to another device.")
		}
		rows, err := tx.Query(r.Context(), `INSERT INTO push_subscriptions (id, "user", endpoint, p256dh, auth, device)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (endpoint) DO UPDATE SET "user" = EXCLUDED."user", p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
				device = EXCLUDED.device, updated = now()
			RETURNING `+subscriptionColumns, ids.New(), p.UserID, body.Endpoint, body.P256dh, body.Auth, strings.TrimSpace(body.Device))
		if err != nil {
			return err
		}
		if created, err = pgx.CollectExactlyOneRow(rows, scanSubscription); err != nil {
			return err
		}
		action := "create"
		if previous == p.UserID {
			action = "update"
		} else if previous != "" {
			moved := created
			moved.User = previous
			if err := publishSubscription(r.Context(), tx, p.UserID, "delete", moved); err != nil {
				return err
			}
		}
		return publishSubscription(r.Context(), tx, p.UserID, action, created)
	})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, created)
	return nil
}

func publishSubscription(ctx context.Context, tx pgx.Tx, actor, action string, s PushSubscription) error {
	return events.PublishAs(ctx, tx, actor, TopicPushSubscriptions, "push_subscription."+action,
		map[string]any{"action": action, "record": s}, events.Audience{Users: []string{s.User}})
}

// deleteSubscription removes one device (of owner, unless owner is empty) and tells its owner's other tabs.
func (m *module) deleteSubscription(ctx context.Context, actor, id, owner string) error {
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `DELETE FROM push_subscriptions WHERE id = $1 AND ($2 = '' OR "user" = $2) RETURNING `+subscriptionColumns, id, owner)
		if err != nil {
			return err
		}
		s, err := pgx.CollectExactlyOneRow(rows, scanSubscription)
		if err != nil {
			return err
		}
		return publishSubscription(ctx, tx, actor, "delete", s)
	})
}

func (m *module) unsubscribe(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	err = m.deleteSubscription(r.Context(), p.UserID, r.PathValue("id"), p.UserID)
	if err == pgx.ErrNoRows {
		return httpx.ErrNotFound
	}
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (m *module) testPush(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	if !m.testPushes.allow(p.UserID, time.Now()) {
		w.Header().Set("Retry-After", "60")
		return httpx.NewError(http.StatusTooManyRequests, "Too Many Requests.")
	}
	var body struct {
		Endpoint string `json:"endpoint"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if body.Endpoint == "" {
		return invalid("endpoint", "Missing endpoint.")
	}
	if !m.app.Push.Enabled() {
		return httpx.NewError(http.StatusServiceUnavailable, "Push is not configured.")
	}
	subscriptions, err := m.subscriptionsOf(r.Context(), p.UserID, body.Endpoint)
	if err != nil {
		return err
	}
	if len(subscriptions) == 0 {
		return httpx.ErrNotFound
	}
	var language string
	m.app.DB.QueryRow(r.Context(), `SELECT language FROM users WHERE id = $1`, p.UserID).Scan(&language)
	payload, _ := json.Marshal(push.Payload{
		Title: m.app.Cfg.AppName,
		Body:  m.app.Locales.Translate(m.app.Locales.Language(language), "accountSettings.push.testMessage", nil),
		URL:   "/account/settings",
		Tag:   "test",
	})
	m.sendAll(r.Context(), subscriptions, payload)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ponytail: per-replica limiter, so N replicas allow N×max; move to a Postgres counter if that matters.
type limiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	hits   map[string][]time.Time
}

func (l *limiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	recent := l.hits[key][:0]
	for _, hit := range l.hits[key] {
		if now.Sub(hit) < l.window {
			recent = append(recent, hit)
		}
	}
	if len(recent) >= l.max {
		l.hits[key] = recent
		return false
	}
	l.hits[key] = append(recent, now)
	return true
}
