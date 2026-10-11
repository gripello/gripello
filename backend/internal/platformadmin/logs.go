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

// listLogs shows the newest records of every replica.
func (m *module) listLogs(w http.ResponseWriter, r *http.Request) error {
	min := slog.LevelInfo
	if raw := r.URL.Query().Get("level"); raw != "" {
		if err := min.UnmarshalText([]byte(raw)); err != nil {
			return httpx.NewError(http.StatusBadRequest, "Unknown level.")
		}
	}
	items, err := logbuf.Recent(r.Context(), m.app.DB, min, 2000)
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
	httpx.JSON(w, http.StatusOK, map[string]any{"level": level, "items": items, "replicas": servers})
	return nil
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
		return httpx.NewError(http.StatusBadRequest, "Unknown level.").Field("level", "validation_invalid_value", "Use debug, info, warn or error.")
	}
	ctx := r.Context()
	p, _ := auth.From(ctx)
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE platform_config SET log_level = $1, updated = now()`, name); err != nil {
			return err
		}
		return events.PublishAs(ctx, tx, p.UserID, "platform", "platform_config.updated", map[string]any{"id": "platformconfig", "changed": []string{"log_level"}}, events.Audience{})
	})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"level": name})
	return nil
}
