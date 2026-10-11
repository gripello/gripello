// Package backups writes scheduled database (+ storage) archives into BACKUP_DIR for platform admins to download.
// Restoring is CLI only (`gripello admin restore`): it needs every other replica stopped.
package backups

import (
	"context"
	"net/http"
	"time"

	"gripello/internal/platform"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/jobs"
)

const jobKind = "backup"

type module struct {
	app *platform.App
	dir string
}

func Register(app *platform.App) {
	m := &module{app: app, dir: app.Cfg.BackupDir}
	for pattern, handler := range map[string]httpx.Handler{
		"GET /platform/backups":           m.list,
		"POST /platform/backups":          m.runNow,
		"GET /platform/backups/{name}":    m.download,
		"DELETE /platform/backups/{name}": m.remove,
		"PUT /platform/backups/settings":  m.saveSettings,
	} {
		app.Handle(pattern, onlyPlatformAdmins(handler))
	}
	if m.dir == "" {
		return
	}
	app.Worker(jobKind, func(ctx context.Context, _ jobs.Job) error { return m.runAndRecord(ctx) })
	app.Cron.Add("backupSchedule", "30 * * * *", func(ctx context.Context) error {
		s, err := loadSettings(ctx, app.DB)
		if err != nil || s.Keep == 0 || time.Now().UTC().Hour() != s.Hour {
			return err
		}
		return jobs.Enqueue(ctx, app.DB, jobKind, "run", nil, 0)
	})
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

// requireDir answers 404 on deployments without BACKUP_DIR, so the page can tell the feature is off.
func (m *module) requireDir() error {
	if m.dir == "" {
		return httpx.NewError(http.StatusNotFound, "Backups are not enabled on this server (BACKUP_DIR).")
	}
	return nil
}

func (m *module) requireReauth(r *http.Request) error {
	p, _ := auth.From(r.Context())
	return auth.RequireRecentReauth(r.Context(), m.app.DB, p)
}
