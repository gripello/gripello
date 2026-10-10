// Package testkit gives each test its own schema on the shared test database (GRIPELLO_TEST_DSN).
package testkit

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform/config"
	"gripello/internal/platform/db"
	"gripello/internal/platform/ids"
)

func Pool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("GRIPELLO_TEST_DSN")
	if dsn == "" {
		dsn = config.DevDatabaseURL
	}
	ctx := context.Background()
	schema := "test_" + ids.New()
	admin, err := pgxpool.New(ctx, dsn)
	if err == nil {
		err = admin.Ping(ctx)
	}
	if err != nil {
		if os.Getenv("GRIPELLO_TEST_DSN") == "" {
			t.Skip("dev database not reachable (start it with `yarn dev` or set GRIPELLO_TEST_DSN)")
		}
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	pool, err := db.Connect(ctx, dsn+sep+"search_path="+schema)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	})
	return pool
}
