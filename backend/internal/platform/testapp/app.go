package testapp

import (
	"context"
	"net/http"
	"slices"
	"sync"
	"testing"
	"time"

	"gripello/internal/platform"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/blob"
	"gripello/internal/platform/db"
	"gripello/internal/platform/events"
	"gripello/internal/platform/jobs"
	"gripello/internal/platform/locales"
	"gripello/internal/platform/mail"
	"gripello/internal/platform/push"
	"gripello/internal/platform/realtime"
	"gripello/internal/platform/tenancy"
	"gripello/internal/platform/testkit"
)

// App returns a migrated, isolated App with the bus running; modules call Register on it and hit App.Mux via httptest.
func App(t *testing.T) *platform.App {
	t.Helper()
	pool := testkit.Pool(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	bus := events.NewBus(pool)
	go bus.Run(ctx)
	blobDir := t.TempDir()
	store, err := blob.NewFS(blobDir)
	if err != nil {
		t.Fatal(err)
	}
	messages := locales.Load(localesDir)
	app := &platform.App{
		Mail:          &mailRecorder{},
		MailTemplates: &mail.Templates{Messages: messages, AppName: "Gripello", AppURL: "http://localhost:3000"},
		Locales:       messages,
		Blob:          store,
		Push:          push.New("", "", ""),
		DB:            pool,
		Mux:           http.NewServeMux(),
		Bus:           bus,
		Cron:          jobs.NewCron(pool),
		Workers:       map[string]jobs.Worker{},
		Realtime:      realtime.NewHub(bus, tenancy.New(pool)),
		Tokens:        auth.Issuer{Secret: "test-secret", Duration: time.Hour},
	}
	app.Cfg.TokenSecret = "test-secret"
	app.Cfg.AppURL = "http://localhost:3000"
	app.Cfg.LocalesDir = localesDir
	app.Cfg.AppName = "Gripello"
	app.Cfg.BlobDir = blobDir
	app.Handle("GET /files/{table}/{id}/{name}", store.ServeFile(app.Cfg.TokenSecret))
	app.Handle("POST /files/token", store.IssueToken(app.Cfg.TokenSecret))
	return app
}

const localesDir = "../../../i18n/locales"

type mailRecorder struct {
	mu   sync.Mutex
	sent []mail.Message
}

func (r *mailRecorder) Send(ctx context.Context, to, subject, html, text string) error {
	return r.SendMessage(ctx, mail.Message{To: []string{to}, Subject: subject, HTML: html, Text: text})
}

func (r *mailRecorder) SendMessage(_ context.Context, m mail.Message) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sent = append(r.sent, m)
	return nil
}

// Mails returns what the module sent through app.Mail (nil when a test swapped the mailer).
func Mails(app *platform.App) []mail.Message {
	r, ok := app.Mail.(*mailRecorder)
	if !ok {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return slices.Clone(r.sent)
}

// Handler wraps the mux with the middleware chain, exactly as serve does.
func Handler(app *platform.App) http.Handler {
	return app.Handler()
}

// WaitFor polls until cond is true, for event-driven assertions.
func WaitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("condition not met in time")
}
