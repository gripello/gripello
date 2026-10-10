package importer

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/db"
	"gripello/internal/platform/testkit"
)

// Imports the repo's dev PocketBase database and checks that a token signed the PocketBase way still verifies.
func TestImportDevDatabase(t *testing.T) {
	pbData, _ := filepath.Abs("../../../../pocketbase/pb_data")
	if _, err := os.Stat(filepath.Join(pbData, "data.db")); err != nil {
		t.Skip("no pocketbase/pb_data/data.db")
	}
	ctx := context.Background()
	pool := testkit.Pool(t)
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	report, err := Run(ctx, pbData, pool, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if report.Rows["users"] == 0 || report.Rows["gyms"] == 0 {
		t.Fatalf("nothing imported: %+v", report.Rows)
	}

	var userID, tokenKey, secret string
	pool.QueryRow(ctx, `SELECT id, token_key FROM users ORDER BY created LIMIT 1`).Scan(&userID, &tokenKey)
	pool.QueryRow(ctx, `SELECT value FROM app_secrets WHERE key = 'users_auth_token_secret'`).Scan(&secret)
	token, err := auth.Issuer{Secret: secret, Duration: 3600e9}.Sign(userID, tokenKey, "")
	if err != nil {
		t.Fatal(err)
	}
	p, err := auth.Verify(ctx, pool, secret, token)
	if err != nil || p.UserID != userID {
		t.Fatalf("imported user token rejected: %v", err)
	}

	var legacyLabels int
	pool.QueryRow(ctx, `SELECT count(*) FROM audit_logs WHERE actor_label LIKE 'superuser%'`).Scan(&legacyLabels)
	if legacyLabels != 0 {
		t.Fatalf("%d audit rows still carry the PocketBase superuser label", legacyLabels)
	}

	var perms []string
	pool.QueryRow(ctx, `SELECT permissions FROM roles WHERE name = 'admin' LIMIT 1`).Scan(&perms)
	if len(perms) == 0 || len(perms[0]) == 15 {
		t.Fatalf("role permissions should be names, got %v", perms)
	}
}
