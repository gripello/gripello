package platformadmin

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	gmail "gripello/internal/platform/mail"
	"gripello/internal/platform/ratelimit"
)

// Mirrored in shared/utils/featureFlags.ts; the gyms module only checks that flags are booleans.
var featureFlags = []string{"beta_links", "beta_uploads"}

type module struct {
	app          *platform.App
	testMails    *ratelimit.Limiter
	clientErrors *ratelimit.Limiter
	clientIPs    *ratelimit.Limiter
}

func Register(app *platform.App) {
	m := &module{app: app, testMails: ratelimit.New(5, time.Minute), clientErrors: ratelimit.New(60, time.Minute), clientIPs: ratelimit.New(10, time.Minute)}
	for pattern, handler := range map[string]httpx.Handler{
		"GET /platform/users":                    m.listUsers,
		"GET /platform/users/{id}":               m.getUser,
		"PATCH /platform/users/{id}":             m.updateUser,
		"DELETE /platform/users/{id}":            m.deleteUser,
		"POST /platform/users/{id}/suspension":   m.suspend,
		"DELETE /platform/users/{id}/suspension": m.liftSuspension,
		"GET /platform/stats":                    m.stats,
		"GET /platform/traffic":                  m.traffic,
		"GET /platform/system":                   m.system,
		"GET /platform/features":                 m.features,
		"PUT /platform/gyms/{id}/features":       m.setFeatures,
		"POST /platform/admins":                  m.addAdmin,
		"DELETE /platform/admins/{user}":         m.removeAdmin,
		"GET /platform/mail":                     m.getMail,
		"PUT /platform/mail":                     m.putMail,
		"POST /platform/mail/test":               m.sendTestMail,
		"GET /platform/logs":                     m.listLogs,
		"PUT /platform/logs/level":               m.setLogLevel,
		"GET /platform/issues":                   m.listIssues,
		"GET /platform/issues/{fingerprint}":     m.issueOccurrences,
	} {
		app.Handle(pattern, onlyPlatformAdmins(handler))
	}
	app.Handle("POST /client-errors", httpx.Handler(m.reportClientError))
	app.Cron.Add("issueAlerts", "*/5 * * * *", m.alertIssues)
}

func onlyPlatformAdmins(next httpx.Handler) httpx.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		p, err := auth.Require(r.Context())
		if err != nil {
			return err
		}
		if !p.PlatformAdmin {
			return httpx.ErrForbidden
		}
		return next(w, r)
	}
}

func notFoundIfNoRows(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.ErrNotFound
	}
	return err
}

func (m *module) stats(w http.ResponseWriter, r *http.Request) error {
	type gymStats struct {
		ID      string `json:"id"`
		Slug    string `json:"slug"`
		Name    string `json:"name"`
		Active  bool   `json:"active"`
		Members int    `json:"members"`
		Routes  int    `json:"routes"`
	}
	rows, err := m.app.DB.Query(r.Context(), `SELECT g.id, g.slug, g.name, g.active, s.members, s.routes
		FROM gyms g JOIN gym_stats s ON s.id = g.id ORDER BY g.name`)
	if err != nil {
		return err
	}
	gyms, err := pgx.CollectRows(rows, pgx.RowToStructByPos[gymStats])
	if err != nil {
		return err
	}
	totals := map[string]int{"gyms": len(gyms), "active_gyms": 0, "members": 0, "routes": 0}
	for _, g := range gyms {
		totals["members"] += g.Members
		totals["routes"] += g.Routes
		if g.Active {
			totals["active_gyms"]++
		}
	}
	var users int
	if err := m.app.DB.QueryRow(r.Context(), `SELECT count(*) FROM users`).Scan(&users); err != nil {
		return err
	}
	totals["users"] = users
	if gyms == nil {
		gyms = []gymStats{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"gyms": gyms, "totals": totals})
	return nil
}

func (m *module) features(w http.ResponseWriter, r *http.Request) error {
	httpx.JSON(w, http.StatusOK, map[string]any{"flags": featureFlags})
	return nil
}

func (m *module) setFeatures(w http.ResponseWriter, r *http.Request) error {
	var body map[string]json.RawMessage
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	features := map[string]bool{}
	invalid := httpx.NewError(http.StatusBadRequest, "Invalid feature flags.")
	for flag, raw := range body {
		var on bool
		if !slices.Contains(featureFlags, flag) {
			invalid.Field(flag, "validation_invalid_value", "Unknown feature flag.")
		} else if json.Unmarshal(raw, &on) != nil {
			invalid.Field(flag, "validation_invalid_value", "Must be true or false.")
		}
		features[flag] = on
	}
	if len(invalid.Data) > 0 {
		return invalid
	}
	var gym json.RawMessage
	err := pgx.BeginFunc(r.Context(), m.app.DB, func(tx pgx.Tx) error {
		var active bool
		err := tx.QueryRow(r.Context(), `UPDATE gyms g SET features = $2 WHERE id = $1 RETURNING to_jsonb(g), active`, r.PathValue("id"), features).Scan(&gym, &active)
		if err != nil {
			return notFoundIfNoRows(err)
		}
		audience := events.Audience{Public: true}
		if !active {
			audience = events.Audience{GymPerm: r.PathValue("id") + ":manage_settings"}
		}
		p, _ := auth.From(r.Context())
		return events.PublishAs(r.Context(), tx, p.UserID, "gym:"+r.PathValue("id"), "gym.updated",
			map[string]any{"record": gym, "changed": []string{"features"}}, audience)
	})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, gym)
	return nil
}

func (m *module) addAdmin(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		User string `json:"user"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	p, _ := auth.From(r.Context())
	if err := auth.RequireRecentReauth(r.Context(), m.app.DB, p); err != nil {
		return err
	}
	record, err := m.setPlatformAdmin(r.Context(), body.User, true)
	if err != nil {
		return err
	}
	m.mailUser(r.Context(), body.User, "platformAdminGranted")
	httpx.JSON(w, http.StatusOK, record)
	return nil
}

// removeAdmin locks every admin row: of two admins revoking each other, the second finds itself no longer admin.
func (m *module) removeAdmin(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	p, _ := auth.From(ctx)
	userID := r.PathValue("user")
	if userID == p.UserID {
		return httpx.NewError(http.StatusBadRequest, "You can't remove your own platform admin rights.")
	}
	if err := auth.RequireRecentReauth(ctx, m.app.DB, p); err != nil {
		return err
	}
	var record json.RawMessage
	var admins []string
	// All admin rows are locked in id order before the target row, so two admins revoking each other can't deadlock.
	lockAdmins := func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT id FROM users WHERE platform_admin ORDER BY id FOR UPDATE`)
		if err != nil {
			return err
		}
		admins, err = pgx.CollectRows(rows, pgx.RowTo[string])
		return err
	}
	err := m.changeUser(ctx, userID, func(tx pgx.Tx) error {
		if !slices.Contains(admins, p.UserID) {
			return httpx.ErrForbidden
		}
		if !slices.Contains(admins, userID) {
			return httpx.NewError(http.StatusBadRequest, "This user is not a platform admin.")
		}
		_, err := tx.Exec(ctx, `UPDATE users SET platform_admin = false WHERE id = $1`, userID)
		return err
	}, &record, lockAdmins)
	if err != nil {
		return err
	}
	m.mailUser(ctx, userID, "platformAdminRevoked")
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (m *module) mailUser(ctx context.Context, userID, key string) {
	var t target
	if err := m.app.DB.QueryRow(ctx, `SELECT id, email, firstname, language FROM users WHERE id = $1`, userID).Scan(&t.ID, &t.Email, &t.Firstname, &t.Language); err != nil || t.Email == "" {
		return
	}
	content := gmail.Content{Key: key, Name: t.Firstname}
	if _, err := m.app.MailTemplates.Send(ctx, m.app.Mail, m.app.MailTemplates.AppBrand(), content, []gmail.Recipient{{Address: t.Email, Language: t.Language}}); err != nil {
		slog.Error("platformadmin: sending mail failed", "mail", key, "user", userID, "error", err)
	}
}

func (m *module) setPlatformAdmin(ctx context.Context, userID string, on bool) (record json.RawMessage, err error) {
	err = m.changeUser(ctx, userID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE users SET platform_admin = $2 WHERE id = $1`, userID, on)
		return err
	}, &record)
	return record, err
}
