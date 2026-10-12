// Package testkit gives each test its own database on the shared test server (GRIPELLO_TEST_DSN), cloned from a template migrated once.
package testkit

import (
	"context"
	"errors"
	neturl "net/url"
	"os"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform/config"
	"gripello/internal/platform/db"
	"gripello/internal/platform/ids"
)

const templateLock = 7231002

var errDatabaseUnreachable = errors.New("test database unreachable")

var (
	setupOnce sync.Once
	setupErr  error
	admin     *pgxpool.Pool
	template  = "test_template_" + db.MigrationsChecksum()
)

func Pool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("GRIPELLO_TEST_DSN")
	if dsn == "" {
		dsn = config.DevDatabaseURL
	}
	ctx := context.Background()
	setupOnce.Do(func() {
		if admin, setupErr = pgxpool.New(ctx, dsn); setupErr == nil {
			setupErr = admin.Ping(ctx)
		}
		if setupErr != nil {
			if os.Getenv("GRIPELLO_TEST_DSN") == "" {
				setupErr = errDatabaseUnreachable
			}
			return
		}
		setupErr = ensureTemplate(ctx, admin, dsn)
	})
	if setupErr == errDatabaseUnreachable {
		t.Skip("dev database not reachable (start it with `yarn dev` or set GRIPELLO_TEST_DSN)")
	}
	if setupErr != nil {
		t.Fatal(setupErr)
	}
	name := "test_" + ids.New()
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name+" TEMPLATE "+template); err != nil {
		t.Fatal(err)
	}
	pool, err := db.Connect(ctx, withDatabase(dsn, name))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		admin.Exec(ctx, "DROP DATABASE "+name+" WITH (FORCE)")
	})
	return pool
}

func ensureTemplate(ctx context.Context, admin *pgxpool.Pool, dsn string) error {
	conn, err := admin.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", templateLock); err != nil {
		return err
	}
	defer conn.Exec(ctx, "SELECT pg_advisory_unlock($1)", templateLock)
	var exists bool
	if err := conn.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)", template).Scan(&exists); err != nil || exists {
		return err
	}
	stale, err := conn.Query(ctx, "SELECT datname FROM pg_database WHERE datname LIKE 'test\\_template\\_%'")
	if err != nil {
		return err
	}
	var names []string
	for stale.Next() {
		var name string
		stale.Scan(&name)
		names = append(names, name)
	}
	for _, name := range names {
		conn.Exec(ctx, "DROP DATABASE "+name+" WITH (FORCE)")
	}
	building := template + "_building"
	if _, err := conn.Exec(ctx, "CREATE DATABASE "+building); err != nil {
		return err
	}
	pool, err := db.Connect(ctx, withDatabase(dsn, building))
	if err != nil {
		return err
	}
	err = db.Migrate(ctx, pool)
	pool.Close()
	if err != nil {
		return err
	}
	_, err = conn.Exec(ctx, "ALTER DATABASE "+building+" RENAME TO "+template)
	return err
}

func withDatabase(dsn, name string) string {
	url, err := neturl.Parse(dsn)
	if err != nil {
		return dsn
	}
	url.Path = "/" + name
	return url.String()
}
