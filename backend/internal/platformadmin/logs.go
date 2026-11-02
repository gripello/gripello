package platformadmin

import (
	"log/slog"
	"net/http"
	"slices"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/logbuf"
	"gripello/internal/platform/replicas"
)

const maxLogSearch = 200

// listLogs shows the newest records of every replica.
func (m *module) listLogs(w http.ResponseWriter, r *http.Request) error {
	query := r.URL.Query()
	filter := logbuf.Filter{Min: slog.LevelInfo, Req: query.Get("req"), User: query.Get("user"), Route: query.Get("route"), Query: query.Get("q"), Limit: 2000}
	if raw := query.Get("level"); raw != "" {
		if err := filter.Min.UnmarshalText([]byte(raw)); err != nil {
			return httpx.BadRequest("Unknown level.")
		}
	}
	if err := httpx.TooLong("q", filter.Query, maxLogSearch); err != nil {
		return err
	}
	if raw := query.Get("cursor"); raw != "" {
		cursor, ok := logbuf.ParseCursor(raw)
		if !ok {
			return httpx.Invalid("cursor", "Use the next value of a previous page.")
		}
		filter.Before = &cursor
	}
	items, err := logbuf.Recent(r.Context(), m.app.DB, filter)
	if err != nil {
		return err
	}
	servers, err := replicas.List(r.Context(), m.app.DB)
	if err != nil {
		return err
	}
	level := "info"
	if m.app.Logs != nil {
		level = m.app.Logs.Level.Level().String()
	}
	var next *string
	if len(items) == filter.Limit {
		cursor := logbuf.Cursor{Time: items[len(items)-1].Time, ID: items[len(items)-1].ID}.String()
		next = &cursor
	}
	return httpx.Respond(w, http.StatusOK, map[string]any{"level": level, "items": items, "replicas": servers, "next": next}, nil)
}

// setLogLevel stores the level; every replica applies it when the platform_config event arrives.
func (m *module) setLogLevel(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Level string `json:"level"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	name := body.Level
	if !slices.Contains([]string{"debug", "info", "warn", "error"}, name) {
		return httpx.BadRequest("Unknown level.").Field("level", "validation_invalid_value", "Use debug, info, warn or error.")
	}
	ctx := r.Context()
	p, _ := auth.From(ctx)
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE platform_config SET log_level = $1, updated = now()`, name); err != nil {
			return err
		}
		return events.PublishAs(ctx, tx, p.UserID, "platform", "platform_config.updated", map[string]any{"id": "platformconfig", "changed": []string{"log_level"}}, events.Audience{PlatformAdmins: true})
	})
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, map[string]string{"level": name}, nil)
}
