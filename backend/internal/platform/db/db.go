package db

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"math"
	neturl "net/url"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"gripello/internal/platform/httpx"
)

// Querier is what a pool and a transaction share.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

//go:embed migrations/*.sql
var migrations embed.FS

const migrateLock = 7231001

// MaxConns is the pool size per replica; replicas × MaxConns must stay below Postgres' max_connections.
var MaxConns int32 = 20

func MigrationsChecksum() string {
	hash := sha256.New()
	fs.WalkDir(migrations, ".", func(path string, entry fs.DirEntry, err error) error {
		if err == nil && !entry.IsDir() {
			content, _ := migrations.ReadFile(path)
			hash.Write([]byte(path))
			hash.Write(content)
		}
		return nil
	})
	return hex.EncodeToString(hash.Sum(nil))[:12]
}

func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = MaxConns
	if cfg.ConnConfig.ConnectTimeout == 0 {
		// pgx waits for the OS connect timeout (minutes) on a host that drops packets
		cfg.ConnConfig.ConnectTimeout = 10 * time.Second
	}
	cfg.ConnConfig.Tracer = tracer{}
	// timestamptz values are rendered in the session zone; clients compare ISO strings, so keep it UTC everywhere.
	cfg.ConnConfig.RuntimeParams["timezone"] = "UTC"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	return pool, pool.Ping(ctx)
}

// ConnectWait keeps retrying an unreachable database (it may still be starting or not resolvable yet) until ctx ends.
func ConnectWait(ctx context.Context, url string, retry time.Duration) (*pgxpool.Pool, error) {
	for {
		pool, err := Connect(ctx, url)
		if err == nil || pool == nil {
			return pool, err
		}
		pool.Close()
		if !retryable(err) {
			return nil, err
		}
		slog.Warn("database unreachable, retrying", "error", err)
		select {
		case <-ctx.Done():
			return nil, err
		case <-time.After(retry):
		}
	}
}

func retryable(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return true
	}
	switch pgErr.Code {
	case "28000", "28P01", "3D000": // bad credentials or an unknown database won't heal by waiting
		return false
	}
	return true
}

// Migrate applies pending migrations; the advisory lock lets every replica call it at startup.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	return MigrateTo(ctx, pool, math.MaxInt64)
}

func MigrateTo(ctx context.Context, pool *pgxpool.Pool, version int64) error {
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer sqlDB.Close()
	return withLock(ctx, sqlDB, func() error {
		goose.SetBaseFS(migrations)
		goose.SetLogger(goose.NopLogger())
		if err := goose.SetDialect("postgres"); err != nil {
			return err
		}
		return goose.UpToContext(ctx, sqlDB, "migrations", version)
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

// List scans every row into T by column name.
func List[T any](ctx context.Context, q Querier, sql string, args ...any) ([]T, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[T])
}

// First answers httpx.ErrNotFound for an empty result.
func First[T any](items []T, err error) (T, error) {
	var zero T
	if err != nil {
		return zero, err
	}
	if len(items) == 0 {
		return zero, httpx.ErrNotFound
	}
	return items[0], nil
}

func One[T any](ctx context.Context, q Querier, sql string, args ...any) (T, error) {
	return First(List[T](ctx, q, sql, args...))
}
