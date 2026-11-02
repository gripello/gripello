package db_test

import (
	"bytes"
	"context"
	"log/slog"
	neturl "net/url"
	"os"
	"strings"
	"testing"

	"gripello/internal/platform/config"
	"gripello/internal/platform/db"
	"gripello/internal/platform/ids"
)

func TestAppliedMigrationsAreLoggedOnce(t *testing.T) {
	ctx := context.Background()
	server := os.Getenv("GRIPELLO_TEST_DSN")
	if server == "" {
		server = config.DevDatabaseURL
	}
	admin, err := db.Connect(ctx, server)
	if err != nil {
		t.Skip("test database unreachable:", err)
	}
	defer admin.Close()
	name := "migrate_log_" + ids.New()
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(context.Background(), "DROP DATABASE "+name+" WITH (FORCE)")
	url, err := neturl.Parse(server)
	if err != nil {
		t.Fatal(err)
	}
	url.Path = "/" + name
	fresh, err := db.Connect(ctx, url.String())
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()

	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	for range 2 {
		if err := db.MigrateTo(ctx, fresh, 1); err != nil {
			t.Fatal(err)
		}
	}
	if !strings.Contains(logs.String(), `msg="migrations applied" from=0 to=1`) || strings.Count(logs.String(), "migrations applied") != 1 {
		t.Errorf("log = %s", logs.String())
	}
}
