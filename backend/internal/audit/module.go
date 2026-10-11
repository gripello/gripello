package audit

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/tenancy"
)

const (
	defaultRetentionDays = 90
	platformLabel        = "Platform administrator"
)

var (
	authActions        = []string{"login", "login_failed", "password_reset_request", "password_reset", "email_change_request", "email_change"}
	skippedCollections = []string{"audit_logs", "mfa_factors", "mfa_recovery_codes", "login_lockouts", "cap_nonces", "sessions"}
	kindCollections    = map[string]string{"gym": "gyms", "membership": "memberships", "role": "roles", "invite": "invites", "user": "users", "tick": "ticks", "task": "tasks"}
	recordActions      = map[string]string{"create": "create", "created": "create", "update": "update", "updated": "update", "accepted": "update", "delete": "delete", "deleted": "delete"}
)

type module struct {
	db    *pgxpool.Pool
	perms *tenancy.Permissions
}

func Register(app *platform.App) {
	m := &module{db: app.DB, perms: tenancy.New(app.DB)}
	app.Handle("GET /gyms/{gym}/audit", httpx.Handler(m.listGym))
	app.Handle("GET /platform/audit", httpx.Handler(m.listPlatform))
	app.Handle("GET /me/audit", httpx.Handler(m.listOwn))
	if app.Bus != nil {
		for _, prefix := range []string{"audit", "gym_changes:", "gym:", "tasks", "user:", "own_ticks"} {
			app.Bus.SubscribeOnce(prefix, "audit.write", m.onEvent)
		}
	}
	app.Cron.Add("auditRetention", "17 3 * * *", m.prune)
}

type entry struct {
	Actor, ActorLabel, Action, Collection, RecordID, Gym, IP string
	Changed                                                  []string
}

type eventRecord struct {
	ID    string `json:"id"`
	Gym   string `json:"gym"`
	User  string `json:"user"`
	Actor string `json:"actor"`
}

type eventPayload struct {
	eventRecord
	Action     string       `json:"action"`
	Collection string       `json:"collection"`
	Changed    []string     `json:"changed"`
	Record     *eventRecord `json:"record"`
	Label      string       `json:"label"`
	IP         string       `json:"ip"`
}

// entryFor maps one outbox event to an audit row; payload variants for other audiences and internal topics are skipped.
func entryFor(e events.Event) (entry, bool) {
	var p eventPayload
	if json.Unmarshal(e.Payload, &p) != nil {
		return entry{}, false
	}
	if e.Topic == "audit" {
		if !slices.Contains(authActions, p.Action) {
			return entry{}, false
		}
		return entry{Actor: cmp.Or(e.Actor, p.User), ActorLabel: p.Label, Action: p.Action, Collection: "users", RecordID: p.User, IP: p.IP}, true
	}
	prefix, suffix, _ := strings.Cut(e.Kind, ".")
	en := entry{Action: recordActions[suffix], Collection: kindCollections[prefix], Actor: cmp.Or(e.Actor, p.Actor), RecordID: p.ID, Gym: p.Gym}
	if suffix == "changed" {
		en.Action = recordActions[p.Action]
	}
	if p.Record != nil {
		en.RecordID, en.Gym = p.Record.ID, p.Record.Gym
		if en.Actor == "" {
			en.Actor = p.Record.Actor
		}
	}
	switch topic, id, _ := strings.Cut(e.Topic, ":"); topic {
	case "gym_changes":
		if !e.Audience.Public && !e.Audience.GuestsOnly {
			return entry{}, false
		}
		en.Collection, en.Gym = p.Collection, id
		if en.Action == "" {
			en.Action = recordActions[p.Action]
		}
	case "gym":
		en.Gym = id
	case "tasks":
		en.Gym = cmp.Or(en.Gym, id)
	case "user":
		en.RecordID = id
		if en.Actor == "" {
			en.Actor = id
		}
	case "own_ticks":
		if p.Record != nil && en.Actor == "" {
			en.Actor = p.Record.User
		}
	default:
		return entry{}, false
	}
	if en.Action == "" || en.Collection == "" || slices.Contains(skippedCollections, en.Collection) {
		return entry{}, false
	}
	if en.Action == "update" && p.Changed != nil {
		en.Changed = p.Changed
	}
	return en, true
}

func (m *module) onEvent(e events.Event) {
	en, ok := entryFor(e)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := m.write(ctx, e, en); err != nil {
		slog.Error("audit: writing entry failed", "event", e.ID, "kind", e.Kind, "error", err)
	}
}

// The row id derives from the event id, so a redelivered event can never add a second row.
func eventRowID(eventID int64) string {
	s := strconv.FormatInt(eventID, 36)
	return strings.Repeat("0", max(0, 15-len(s))) + s
}

func (m *module) write(ctx context.Context, e events.Event, en entry) error {
	if en.Actor != "" {
		var label string
		var platformAdmin, member bool
		err := m.db.QueryRow(ctx, `SELECT CASE WHEN $2 = '' THEN COALESCE(NULLIF(email, ''), username) ELSE username END, platform_admin,
			EXISTS (SELECT 1 FROM memberships WHERE "user" = users.id AND gym = $2) FROM users WHERE id = $1`, en.Actor, en.Gym).
			Scan(&label, &platformAdmin, &member)
		if errors.Is(err, pgx.ErrNoRows) && en.ActorLabel == "" && en.Gym == "" {
			m.db.QueryRow(ctx, `SELECT actor_label FROM audit_logs WHERE collection_name = 'users' AND record_id = $1 AND actor_label NOT IN ('', $2)
				ORDER BY created DESC LIMIT 1`, en.Actor, platformLabel).Scan(&label)
		}
		if en.ActorLabel == "" {
			en.ActorLabel = label
		}
		if platformAdmin && !member && !actsOnOwnRecord(en) && e.Topic != "audit" {
			en.ActorLabel = platformLabel
		}
	}
	var changed []byte
	if en.Changed != nil {
		changed, _ = json.Marshal(en.Changed)
	}
	id := eventRowID(e.ID)
	return pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `INSERT INTO audit_logs (id, created, updated, actor, actor_label, action, collection_name, record_id, changed_fields, ip, gym)
			VALUES ($1, $2, $2, (SELECT id FROM users WHERE id = $3), $4, $5, $6, $7, $8, $9, (SELECT id FROM gyms WHERE id = $10))
			ON CONFLICT (id) DO NOTHING`,
			id, e.Created, en.Actor, truncate(en.ActorLabel, 255), en.Action, en.Collection, en.RecordID, changed, en.IP, en.Gym)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		return publishCreated(ctx, tx, id)
	})
}

// publishCreated feeds the live activity page: the actor, the gym's auditors and every platform admin.
func publishCreated(ctx context.Context, tx pgx.Tx, id string) error {
	items, err := entries(ctx, tx, entryColumns+` FROM audit_logs a LEFT JOIN gyms g ON g.id = a.gym WHERE a.id = $1`, []any{id})
	if err != nil || len(items) == 0 {
		return err
	}
	row := items[0]
	rows, err := tx.Query(ctx, `SELECT id FROM users WHERE platform_admin`)
	if err != nil {
		return err
	}
	users, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	if row.Actor != "" {
		users = append(users, row.Actor)
	}
	audience := events.Audience{Users: users}
	if row.Gym != "" {
		audience.GymPerm = row.Gym + ":view_audit_log"
	}
	return events.Publish(ctx, tx, "audit_logs", "audit_log.created", map[string]any{"action": "create", "record": row}, audience)
}

func actsOnOwnRecord(en entry) bool {
	return en.Collection == "ticks" || (en.Collection == "users" && en.RecordID == en.Actor)
}

func truncate(value string, limit int) string {
	if runes := []rune(value); len(runes) > limit {
		return string(runes[:limit])
	}
	return value
}

func (m *module) prune(ctx context.Context) error {
	days := defaultRetentionDays
	var stored int
	if m.db.QueryRow(ctx, `SELECT audit_retention_days FROM settings ORDER BY id LIMIT 1`).Scan(&stored) == nil && stored >= 1 && stored <= 3650 {
		days = stored
	}
	tag, err := m.db.Exec(ctx, `DELETE FROM audit_logs WHERE created < now() - make_interval(days => $1)`, days)
	if err == nil {
		slog.Info("audit: pruned expired entries", "rows", tag.RowsAffected(), "retentionDays", days)
	}
	return err
}
