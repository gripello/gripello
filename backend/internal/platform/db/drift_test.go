package db_test

import (
	"context"
	"fmt"
	neturl "net/url"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform/config"
	"gripello/internal/platform/db"
	"gripello/internal/platform/ids"
)

const schemaQuery = `
SELECT format('column %s.%s %s%s%s', c.relname, a.attname, format_type(a.atttypid, a.atttypmod),
    CASE WHEN a.attnotnull THEN ' not null' ELSE '' END, COALESCE(' default ' || pg_get_expr(d.adbin, d.adrelid), ''))
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'v') AND a.attnum > 0 AND NOT a.attisdropped AND c.relname <> 'goose_db_version'
UNION ALL
SELECT format('constraint %s.%s %s', c.relname, k.conname, pg_get_constraintdef(k.oid))
  FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema() AND c.relname <> 'goose_db_version'
UNION ALL
SELECT format('index %s%s', pg_get_indexdef(i.indexrelid), CASE WHEN i.indisvalid THEN '' ELSE ' INVALID' END)
  FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema() AND c.relname <> 'goose_db_version'
UNION ALL
SELECT format('view %s %s', c.relname, pg_get_viewdef(c.oid))
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relkind = 'v'
UNION ALL
SELECT format('function %s', pg_get_functiondef(p.oid))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = current_schema()
UNION ALL
SELECT format('trigger %s', pg_get_triggerdef(t.oid))
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema() AND NOT t.tgisinternal`

func schema(t *testing.T, pool *pgxpool.Pool) []string {
	t.Helper()
	rows, err := pool.Query(context.Background(), schemaQuery)
	if err != nil {
		t.Fatal(err)
	}
	lines, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	slices.Sort(lines)
	return lines
}

// TestSchemaMatchesMigrations diffs GRIPELLO_DRIFT_DSN against a database freshly migrated to the same version (`yarn db:drift`).
func TestSchemaMatchesMigrations(t *testing.T) {
	target := os.Getenv("GRIPELLO_DRIFT_DSN")
	if target == "" {
		t.Skip("set GRIPELLO_DRIFT_DSN to check a database for schema drift")
	}
	ctx := context.Background()
	targetPool, err := db.Connect(ctx, target)
	if err != nil {
		t.Fatal(err)
	}
	defer targetPool.Close()
	var version int64
	if err := targetPool.QueryRow(ctx, `SELECT max(version_id) FROM goose_db_version WHERE is_applied`).Scan(&version); err != nil {
		t.Fatal(err)
	}

	server := os.Getenv("GRIPELLO_TEST_DSN")
	if server == "" {
		server = config.DevDatabaseURL
	}
	admin, err := db.Connect(ctx, server)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := "drift_" + ids.New()
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(context.Background(), "DROP DATABASE "+name+" WITH (FORCE)")
	freshURL, err := neturl.Parse(server)
	if err != nil {
		t.Fatal(err)
	}
	freshURL.Path = "/" + name
	fresh, err := db.Connect(ctx, freshURL.String())
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	if err := db.MigrateTo(ctx, fresh, version); err != nil {
		t.Fatal(err)
	}

	want, got := schema(t, fresh), schema(t, targetPool)
	var diff []string
	for _, line := range want {
		if !slices.Contains(got, line) {
			diff = append(diff, "- "+line)
		}
	}
	for _, line := range got {
		if !slices.Contains(want, line) {
			diff = append(diff, "+ "+line)
		}
	}
	if len(diff) > 0 {
		t.Errorf("schema drift at migration %d (- only in the migrated schema, + only in the target):\n%s", version, strings.Join(diff, "\n"))
	} else {
		fmt.Printf("no schema drift at migration %d\n", version)
	}
}
