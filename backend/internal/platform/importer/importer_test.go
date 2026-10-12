package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/secretbox"
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
	report, err := Run(ctx, pbData, pool, t.TempDir(), "")
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

func TestImportOAuth2ProvidersAndIdentities(t *testing.T) {
	ctx := context.Background()
	pool := testkit.Pool(t)
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, token_key) VALUES ('u1', 'u1', 'k')`); err != nil {
		t.Fatal(err)
	}
	lite, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "data.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer lite.Close()
	for _, stmt := range []string{
		`CREATE TABLE _externalAuths (id TEXT, collectionRef TEXT, recordRef TEXT, provider TEXT, providerId TEXT, created TEXT)`,
		`INSERT INTO _externalAuths VALUES ('e1', 'col', 'u1', 'microsoft', 'ms-sub', '2026-05-01 10:00:00.000Z'),
			('e2', 'col', 'gone', 'microsoft', 'x', '2026-05-01 10:00:00.000Z'), ('e3', 'col', 'u1', 'github', 'gh', '2026-05-01 10:00:00.000Z')`,
	} {
		if _, err := lite.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	var users usersOptions
	json.Unmarshal([]byte(`{"oauth2":{"enabled":false,"providers":[
		{"name":"microsoft","clientId":"ms-client","clientSecret":"ms-secret","authURL":"https://login.microsoftonline.com/c00762ff-ede4/oauth2/v2.0/authorize"},
		{"name":"google","clientId":"g-client","clientSecret":"g-secret"},
		{"name":"github","clientId":"gh"}]}}`), &users)
	users.ID = "col"
	for range 2 {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		providers, identities, err := importOAuth2(ctx, lite, tx, users, "secret")
		if err != nil || providers != 2 || identities != 1 {
			tx.Rollback(ctx)
			t.Fatalf("imported %d providers, %d identities: %v", providers, identities, err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
	var tenant, sealed string
	var enabled bool
	pool.QueryRow(ctx, `SELECT tenant, client_secret, enabled FROM oauth2_providers WHERE provider = 'microsoft'`).Scan(&tenant, &sealed, &enabled)
	if plain, err := secretbox.Open("secret", sealed); tenant != "c00762ff-ede4" || enabled || err != nil || plain != "ms-secret" || strings.Contains(sealed, "ms-secret") {
		t.Errorf("microsoft = tenant %q, enabled %v, secret %q (%v)", tenant, enabled, plain, err)
	}
	var count int
	pool.QueryRow(ctx, `SELECT count(*) FROM user_identities WHERE "user" = 'u1' AND provider = 'microsoft' AND subject = 'ms-sub'`).Scan(&count)
	if count != 1 {
		t.Errorf("%d microsoft identities after two imports", count)
	}
}
