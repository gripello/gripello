// Package importer copies a PocketBase pb_data directory (SQLite + storage) into PostgreSQL + the blob dir.
// It replaces all rows (TRUNCATE + COPY), so running it twice is safe; ids, timestamps, bcrypt hashes and token keys survive.
package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "modernc.org/sqlite"
)

// Tables in foreign-key order. Views, events, jobs and goose state are not imported.
var tables = []string{
	"users", "gyms", "retired_slugs", "settings", "permissions", "roles", "memberships", "invites",
	"locations", "walls", "routes", "ratings", "beta_videos", "ticks", "seasons", "tasks",
	"competitions", "competition_categories", "competition_routes", "competition_entries", "competition_scores",
	"follows", "blocks", "notifications", "push_subscriptions", "user_badges", "reports", "moderation_items",
	"audit_logs", "sessions", "mfa_factors", "mfa_recovery_codes", "login_lockouts", "cap_nonces",
}

var renamed = map[string]string{ // postgres column → sqlite column
	"password_hash":    "password",
	"token_key":        "tokenKey",
	"email_visibility": "emailVisibility",
}

type Report struct {
	Rows  map[string]int64
	Files int
}

type column struct {
	name     string
	dataType string
	nullable bool
}

func Run(ctx context.Context, pbData string, pool *pgxpool.Pool, blobDir string) (Report, error) {
	report := Report{Rows: map[string]int64{}}
	lite, err := sql.Open("sqlite", "file:"+filepath.Join(pbData, "data.db")+"?mode=ro")
	if err != nil {
		return report, err
	}
	defer lite.Close()

	collections, authSecret, err := readCollections(ctx, lite)
	if err != nil {
		return report, err
	}
	permissionNames, err := readPermissionNames(ctx, lite)
	if err != nil {
		return report, err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return report, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `TRUNCATE `+strings.Join(tables, ", ")+` CASCADE`); err != nil {
		return report, err
	}
	for _, table := range tables {
		n, err := copyTable(ctx, lite, tx, table, permissionNames)
		if err != nil {
			return report, fmt.Errorf("%s: %w", table, err)
		}
		report.Rows[table] = n
	}
	// PocketBase wrote "superuser" / "superuser:<email>"; the audit filters and the UI know only the platform-admin label.
	if _, err := tx.Exec(ctx, `UPDATE audit_logs SET actor_label = 'Platform administrator' WHERE actor_label LIKE 'superuser%'`); err != nil {
		return report, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO app_secrets (key, value) VALUES ('users_auth_token_secret', $1)
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, authSecret); err != nil {
		return report, err
	}
	if err := tx.Commit(ctx); err != nil {
		return report, err
	}

	report.Files, err = copyFiles(filepath.Join(pbData, "storage"), blobDir, collections)
	return report, err
}

func readCollections(ctx context.Context, lite *sql.DB) (map[string]string, string, error) {
	rows, err := lite.QueryContext(ctx, `SELECT id, name, options FROM _collections`)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	byID := map[string]string{}
	secret := ""
	for rows.Next() {
		var id, name, options string
		if err := rows.Scan(&id, &name, &options); err != nil {
			return nil, "", err
		}
		byID[id] = name
		if name == "users" {
			var opts struct {
				AuthToken struct{ Secret string } `json:"authToken"`
			}
			json.Unmarshal([]byte(options), &opts)
			secret = opts.AuthToken.Secret
		}
	}
	if secret == "" {
		return nil, "", fmt.Errorf("users collection auth secret not found")
	}
	return byID, secret, rows.Err()
}

func readPermissionNames(ctx context.Context, lite *sql.DB) (map[string]string, error) {
	rows, err := lite.QueryContext(ctx, `SELECT id, name FROM permissions`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	names := map[string]string{}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		names[id] = name
	}
	return names, rows.Err()
}

func sqliteColumns(ctx context.Context, lite *sql.DB, table string) (map[string]bool, error) {
	rows, err := lite.QueryContext(ctx, `SELECT name FROM pragma_table_info(?)`, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	present := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		present[name] = true
	}
	return present, rows.Err()
}

func pgColumns(ctx context.Context, tx pgx.Tx, table string) ([]column, error) {
	rows, err := tx.Query(ctx, `SELECT column_name, data_type, is_nullable = 'YES' FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []column
	for rows.Next() {
		var c column
		if err := rows.Scan(&c.name, &c.dataType, &c.nullable); err != nil {
			return nil, err
		}
		cols = append(cols, c)
	}
	return cols, rows.Err()
}

func copyTable(ctx context.Context, lite *sql.DB, tx pgx.Tx, table string, permissionNames map[string]string) (int64, error) {
	present, err := sqliteColumns(ctx, lite, table)
	if err != nil || len(present) == 0 {
		return 0, err
	}
	allCols, err := pgColumns(ctx, tx, table)
	if err != nil {
		return 0, err
	}
	// Columns missing in SQLite (e.g. `updated` on newer collections) are left out so PostgreSQL defaults apply.
	var cols []column
	var selects, names []string
	for _, c := range allCols {
		src := c.name
		if r, ok := renamed[c.name]; ok {
			src = r
		}
		if !present[src] {
			continue
		}
		cols = append(cols, c)
		selects = append(selects, `"`+src+`"`)
		names = append(names, c.name)
	}
	rows, err := lite.QueryContext(ctx, `SELECT `+strings.Join(selects, ", ")+` FROM "`+table+`"`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	var buffered [][]any
	raw := make([]any, len(cols))
	ptrs := make([]any, len(cols))
	for i := range raw {
		ptrs[i] = &raw[i]
	}
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return 0, err
		}
		out := make([]any, len(cols))
		for i, c := range cols {
			v, err := convert(raw[i], c)
			if err != nil {
				return 0, fmt.Errorf("column %s: %w", c.name, err)
			}
			if table == "roles" && c.name == "permissions" {
				v = mapPermissions(v, permissionNames)
			}
			out[i] = v
		}
		buffered = append(buffered, out)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	return tx.CopyFrom(ctx, pgx.Identifier{table}, names, pgx.CopyFromRows(buffered))
}

func mapPermissions(v any, names map[string]string) any {
	ids, _ := v.([]string)
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if name, ok := names[id]; ok {
			out = append(out, name)
		} else {
			out = append(out, id)
		}
	}
	return out
}

// convert turns a SQLite value into what the PostgreSQL column expects. PocketBase stores "" for unset relations
// and dates, JSON as text, booleans as 0/1 and multi-values as JSON arrays.
func convert(v any, c column) (any, error) {
	s, isString := v.(string)
	if isString && s == "" && (c.nullable || c.dataType != "text") {
		if c.dataType == "text" || c.dataType == "jsonb" || c.dataType == "timestamp with time zone" {
			return nil, nil
		}
	}
	switch c.dataType {
	case "boolean":
		switch x := v.(type) {
		case int64:
			return x != 0, nil
		case bool:
			return x, nil
		case string:
			return x == "1" || x == "true", nil
		}
		return false, nil
	case "timestamp with time zone":
		if !isString {
			return nil, nil
		}
		for _, layout := range []string{"2006-01-02 15:04:05.000Z", time.RFC3339Nano, "2006-01-02 15:04:05Z", "2006-01-02"} {
			if t, err := time.Parse(layout, s); err == nil {
				return t, nil
			}
		}
		return nil, fmt.Errorf("unparseable date %q", s)
	case "jsonb":
		if !isString {
			b, _ := json.Marshal(v)
			return b, nil
		}
		if s == "null" {
			return nil, nil
		}
		return []byte(s), nil
	case "ARRAY":
		var items []string
		if isString && s != "" {
			if err := json.Unmarshal([]byte(s), &items); err != nil {
				items = []string{s}
			}
		}
		if items == nil {
			items = []string{}
		}
		return items, nil
	case "integer", "bigint":
		return toInt(v)
	case "double precision", "numeric":
		return toFloat(v)
	default:
		if isString {
			return s, nil
		}
		if v == nil {
			return nil, nil
		}
		return fmt.Sprint(v), nil
	}
}

func toInt(v any) (int64, error) {
	switch x := v.(type) {
	case int64:
		return x, nil
	case float64:
		return int64(x), nil
	case string:
		if x == "" {
			return 0, nil
		}
		f, err := strconv.ParseFloat(x, 64)
		return int64(f), err
	case nil:
		return 0, nil
	}
	return 0, fmt.Errorf("not a number: %v", v)
}

func toFloat(v any) (float64, error) {
	switch x := v.(type) {
	case int64:
		return float64(x), nil
	case float64:
		return x, nil
	case string:
		if x == "" {
			return 0, nil
		}
		return strconv.ParseFloat(x, 64)
	case nil:
		return 0, nil
	}
	return 0, fmt.Errorf("not a number: %v", v)
}

// copyFiles moves storage/<collectionId>/<recordId>/<file> to <blobDir>/<table>/<recordId>/<file>.
func copyFiles(storage, blobDir string, collections map[string]string) (int, error) {
	count := 0
	entries, err := os.ReadDir(storage)
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	for _, e := range entries {
		table, ok := collections[e.Name()]
		if !ok || !e.IsDir() {
			continue
		}
		src := filepath.Join(storage, e.Name())
		err := filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			rel, _ := filepath.Rel(src, path)
			dst := filepath.Join(blobDir, table, rel)
			if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
				return err
			}
			if err := copyFile(path, dst); err != nil {
				return err
			}
			count++
			return nil
		})
		if err != nil {
			return count, err
		}
	}
	return count, nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
