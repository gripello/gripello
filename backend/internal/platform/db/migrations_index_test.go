package db

import (
	"io/fs"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// Migrations up to here predate the rule and can't be edited (migrations.sum).
const lastUnguardedMigration = "0046"

var concurrentIndexBuild = regexp.MustCompile(`(?i)CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)`)

// A failover mid-build leaves an INVALID index that IF NOT EXISTS skips when goose reruns the migration.
func unguardedIndexBuilds(sql string) []string {
	var out []string
	for _, match := range concurrentIndexBuild.FindAllStringSubmatchIndex(sql, -1) {
		name := sql[match[2]:match[3]]
		drop := regexp.MustCompile(`(?i)DROP\s+INDEX\s+CONCURRENTLY\s+IF\s+EXISTS\s+` + regexp.QuoteMeta(name) + `\b`)
		if loc := drop.FindStringIndex(sql); loc == nil || loc[0] > match[0] {
			out = append(out, name)
		}
	}
	return out
}

func TestIndexBuildsDropAnInvalidLeftoverFirst(t *testing.T) {
	names, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range names {
		if strings.TrimPrefix(path, "migrations/") <= lastUnguardedMigration+"_~" {
			continue
		}
		content, _ := migrations.ReadFile(path)
		for _, name := range unguardedIndexBuilds(string(content)) {
			t.Errorf("%s builds %s CONCURRENTLY without `DROP INDEX CONCURRENTLY IF EXISTS %s;` before it", path, name, name)
		}
	}
}

func TestUnguardedIndexBuildsSpotsMissingDrops(t *testing.T) {
	sql := `DROP INDEX CONCURRENTLY IF EXISTS ticks_ok_idx;
CREATE INDEX CONCURRENTLY IF NOT EXISTS ticks_ok_idx ON ticks (route);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ratings_bad_idx ON ratings (route, "user");
CREATE INDEX CONCURRENTLY late_idx ON ticks (date);
DROP INDEX CONCURRENTLY IF EXISTS late_idx;`
	if got := unguardedIndexBuilds(sql); !slices.Equal(got, []string{"ratings_bad_idx", "late_idx"}) {
		t.Fatalf("unguarded = %v", got)
	}
}
