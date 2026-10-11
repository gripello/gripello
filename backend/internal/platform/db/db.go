package db

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	neturl "net/url"
	"strconv"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var migrations embed.FS

const migrateLock = 7231001

func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 20
	// timestamptz values are rendered in the session zone; clients compare ISO strings, so keep it UTC everywhere.
	cfg.ConnConfig.RuntimeParams["timezone"] = "UTC"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	return pool, pool.Ping(ctx)
}

// Migrate applies pending migrations; the advisory lock lets every replica call it at startup.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer sqlDB.Close()
	return withLock(ctx, sqlDB, func() error {
		goose.SetBaseFS(migrations)
		goose.SetLogger(goose.NopLogger())
		if err := goose.SetDialect("postgres"); err != nil {
			return err
		}
		return goose.UpContext(ctx, sqlDB, "migrations")
	})
}

func withLock(ctx context.Context, sqlDB *sql.DB, fn func() error) error {
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, "SELECT pg_advisory_lock($1)", migrateLock); err != nil {
		return fmt.Errorf("migrate lock: %w", err)
	}
	defer conn.ExecContext(ctx, "SELECT pg_advisory_unlock($1)", migrateLock)
	return fn()
}

// CommandEnv turns DATABASE_URL into PG* variables for pg_dump/pg_restore, so the password never shows up in argv.
func CommandEnv(url string) ([]string, error) {
	cfg, err := pgconn.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	env := []string{"PGHOST=" + cfg.Host, "PGPORT=" + strconv.Itoa(int(cfg.Port)), "PGUSER=" + cfg.User, "PGPASSWORD=" + cfg.Password, "PGDATABASE=" + cfg.Database}
	// libpq reads TLS options from PG* variables; without them it would fall back to sslmode=prefer.
	if parsed, err := neturl.Parse(url); err == nil && parsed.Query().Get("sslmode") != "" {
		for param, name := range map[string]string{"sslmode": "PGSSLMODE", "sslrootcert": "PGSSLROOTCERT", "sslcert": "PGSSLCERT", "sslkey": "PGSSLKEY"} {
			if v := parsed.Query().Get(param); v != "" {
				env = append(env, name+"="+v)
			}
		}
	} else if cfg.TLSConfig == nil {
		env = append(env, "PGSSLMODE=disable")
	}
	return env, nil
}
