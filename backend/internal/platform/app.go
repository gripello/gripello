package platform

import (
	"context"
	"io"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/config"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/jobs"
	"gripello/internal/platform/locales"
	"gripello/internal/platform/mail"
	"gripello/internal/platform/push"
	"gripello/internal/platform/realtime"
)

// Mailer and BlobStore are the ports modules use; platform/mail and platform/blob implement them.
// Localized mails: app.MailTemplates.Send(ctx, app.Mail, brand, mail.Invite(...), recipients).
type Mailer interface {
	Send(ctx context.Context, to, subject, html, text string) error
}

type BlobStore interface {
	Put(ctx context.Context, key string, r io.Reader) error
	Open(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
	Upload(ctx context.Context, key string, r io.Reader, allowed []string, maxBytes int64) (string, error)
	WarmThumbs(key string, sizes ...string)
}

// App is what every module gets; modules never import each other's internals.
type App struct {
	Mail          Mailer
	MailTemplates *mail.Templates
	Locales       locales.Messages
	Blob          BlobStore
	Push          *push.Sender
	Cfg           config.Config
	DB            *pgxpool.Pool
	Mux           *http.ServeMux
	Bus           *events.Bus
	Cron          *jobs.Cron
	Workers       map[string]jobs.Worker
	Realtime      *realtime.Hub
	Tokens        auth.Issuer
}

type Module interface {
	Register(app *App)
}

// Handle mounts a handler under /api using Go 1.22 method+path patterns ("GET /gyms/{gym}/routes").
func (a *App) Handle(pattern string, h http.Handler) {
	method, path, _ := cutSpace(pattern)
	a.Mux.Handle(method+" /api"+path, h)
}

func (a *App) Worker(kind string, w jobs.Worker) { a.Workers[kind] = w }

func (a *App) Handler() http.Handler {
	return httpx.Versioned(config.Version)(auth.Middleware(a.DB, a.Cfg.TokenSecret)(a.Mux))
}

func (a *App) Serve(ctx context.Context) error {
	srv := &http.Server{Addr: a.Cfg.HTTPAddr, Handler: a.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}
	go func() {
		<-ctx.Done()
		srv.Shutdown(context.Background())
	}()
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		return err
	}
	return nil
}

func cutSpace(s string) (string, string, bool) {
	for i := 0; i < len(s); i++ {
		if s[i] == ' ' {
			return s[:i], s[i+1:], true
		}
	}
	return s, "", false
}
