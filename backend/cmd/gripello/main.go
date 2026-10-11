package main

import (
	"context"
	"crypto/rand"
	"flag"
	"fmt"
	"gripello/internal/account"
	"gripello/internal/achievements"
	"gripello/internal/audit"
	"gripello/internal/authn"
	"gripello/internal/competitions"
	"gripello/internal/gyms"
	"gripello/internal/members"
	"gripello/internal/moderation"
	"gripello/internal/notifications"
	"gripello/internal/platformadmin"
	"gripello/internal/ratings"
	"gripello/internal/routes"
	"gripello/internal/social"
	"gripello/internal/tasks"
	"gripello/internal/ticks"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"gripello/internal/platform"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/blob"
	"gripello/internal/platform/config"
	"gripello/internal/platform/db"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/importer"
	"gripello/internal/platform/jobs"
	"gripello/internal/platform/locales"
	"gripello/internal/platform/mail"
	"gripello/internal/platform/push"
	"gripello/internal/platform/realtime"
	"gripello/internal/platform/tenancy"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: gripello serve|migrate|import-pocketbase|admin")
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	var err error
	switch os.Args[1] {
	case "serve":
		err = serve(ctx, os.Args[2:])
	case "migrate":
		err = migrate(ctx)
	case "import-pocketbase":
		err = importPocketBase(ctx, os.Args[2:])
	case "admin":
		err = admin(ctx, os.Args[2:])
	default:
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}
	if err != nil {
		slog.Error(err.Error())
		os.Exit(1)
	}
}

func connect(ctx context.Context) (config.Config, *platform.App, error) {
	cfg, err := config.Load()
	if err != nil {
		return cfg, nil, err
	}
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return cfg, nil, err
	}
	if err := db.Migrate(ctx, pool); err != nil {
		return cfg, nil, err
	}
	if cfg.TokenSecret == "" {
		pool.QueryRow(ctx, `SELECT value FROM app_secrets WHERE key = 'users_auth_token_secret'`).Scan(&cfg.TokenSecret)
	}
	if cfg.TokenSecret == "" {
		pool.QueryRow(ctx, `INSERT INTO app_secrets (key, value) VALUES ('users_auth_token_secret', $1)
			ON CONFLICT (key) DO UPDATE SET value = app_secrets.value RETURNING value`, rand.Text()+rand.Text()).Scan(&cfg.TokenSecret)
	}
	if cfg.TokenSecret == "" {
		return cfg, nil, fmt.Errorf("TOKEN_SECRET is required")
	}
	store, err := blob.NewFS(cfg.BlobDir)
	if err != nil {
		return cfg, nil, err
	}
	store.AccelPrefix = cfg.BlobAccelPrefix
	store.MayView = blob.StaffView(pool, tenancy.New(pool))
	messages := locales.Load(cfg.LocalesDir)
	if len(messages) == 0 {
		slog.Warn("i18n: no locale messages found", "dir", cfg.LocalesDir)
	}
	bus := events.NewBus(pool)
	app := &platform.App{
		Mail:          mail.New(cfg),
		MailTemplates: mail.NewTemplates(cfg, messages),
		Locales:       messages,
		Blob:          store,
		Push:          push.New(cfg.VAPIDPublicKey, cfg.VAPIDPrivateKey, cfg.SenderAddress),
		Cfg:           cfg,
		DB:            pool,
		Mux:           http.NewServeMux(),
		Bus:           bus,
		Cron:          jobs.NewCron(pool),
		Workers:       map[string]jobs.Worker{},
		Realtime:      realtime.NewHub(bus, tenancy.New(pool)),
		Tokens:        auth.Issuer{Secret: cfg.TokenSecret, Duration: cfg.AuthTokenDuration},
	}
	app.Handle("GET /files/{table}/{id}/{name}", store.ServeFile(cfg.TokenSecret))
	app.Handle("POST /files/token", store.IssueToken(cfg.TokenSecret))
	return cfg, app, nil
}

func migrate(ctx context.Context) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	return db.Migrate(ctx, pool)
}

func serve(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	role := fs.String("role", "", "all|api|worker (default: ROLE env or all)")
	addr := fs.String("http", "", "listen address (default: HTTP_ADDR env or :8080)")
	fs.Parse(args)
	cfg, app, err := connect(ctx)
	if err != nil {
		return err
	}
	defer app.DB.Close()
	if *role != "" {
		cfg.Role = *role
	}
	if *addr != "" {
		cfg.HTTPAddr = *addr
		app.Cfg.HTTPAddr = *addr
	}

	app.Handle("GET /health", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		if err := app.DB.Ping(r.Context()); err != nil {
			return err
		}
		httpx.JSON(w, 200, map[string]string{"version": config.Version})
		return nil
	}))
	app.Handle("GET /mail-status", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		if _, err := auth.Require(r.Context()); err != nil {
			return err
		}
		httpx.JSON(w, 200, mail.Status(cfg))
		return nil
	}))
	app.Handle("GET /online", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		if _, err := auth.Require(r.Context()); err != nil {
			return err
		}
		httpx.JSON(w, 200, map[string]int{"clients": app.Realtime.Clients()})
		return nil
	}))
	app.Handle("GET /realtime", httpx.Handler(app.Realtime.Connect))
	app.Handle("PUT /realtime/{clientId}/subscriptions", httpx.Handler(app.Realtime.Subscriptions))
	// Dependency order: a module may only consume events of modules registered before it.
	gyms.Register(app)
	authn.Register(app)
	account.Register(app)
	members.Register(app)
	routes.Register(app)
	ratings.Register(app)
	tasks.Register(app)
	ticks.Register(app)
	competitions.Register(app)
	social.Register(app)
	notifications.Register(app)
	achievements.Register(app)
	audit.Register(app)
	moderation.Register(app)
	platformadmin.Register(app)

	app.Cron.Add("eventsPrune", "*/10 * * * *", func(ctx context.Context) error {
		return app.Bus.Prune(ctx, time.Hour)
	})

	go app.Bus.Run(ctx)
	if cfg.Role != "api" {
		app.Cron.Start()
		defer app.Cron.Stop()
		go jobs.RunQueue(ctx, app.DB, app.Workers, 2)
	}
	if cfg.Role == "worker" {
		<-ctx.Done()
		return nil
	}
	slog.Info("listening", "addr", cfg.HTTPAddr, "role", cfg.Role)
	return app.Serve(ctx)
}

func importPocketBase(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("import-pocketbase", flag.ExitOnError)
	pbData := fs.String("pb-data", "../pocketbase/pb_data", "PocketBase data directory")
	fs.Parse(args)
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}
	report, err := importer.Run(ctx, *pbData, pool, cfg.BlobDir)
	for table, n := range report.Rows {
		fmt.Printf("%-24s %d\n", table, n)
	}
	fmt.Printf("%-24s %d\n", "files", report.Files)
	return err
}
