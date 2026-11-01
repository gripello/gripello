package captcha

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"gripello/internal/platform/testkit"
)

func signed(t *testing.T, secret string, claims jwt.MapClaims) string {
	t.Helper()
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func TestVerifyAcceptsEachTokenOnceForItsScope(t *testing.T) {
	ctx := context.Background()
	pool := testkit.Pool(t)
	exp := time.Now().Add(time.Minute).Unix()
	valid := signed(t, "secret", jwt.MapClaims{"scope": "login", "jti": "j1", "exp": exp})
	if err := Verify(ctx, pool, "", "", "login"); err != nil {
		t.Errorf("no secret must skip the captcha: %v", err)
	}
	for name, token := range map[string]string{
		"missing":      "",
		"wrong scope":  signed(t, "secret", jwt.MapClaims{"scope": "register", "jti": "j2", "exp": exp}),
		"wrong secret": signed(t, "other", jwt.MapClaims{"scope": "login", "jti": "j3", "exp": exp}),
		"expired":      signed(t, "secret", jwt.MapClaims{"scope": "login", "jti": "j4", "exp": time.Now().Add(-time.Minute).Unix()}),
		"no expiry":    signed(t, "secret", jwt.MapClaims{"scope": "login", "jti": "j5"}),
		"no jti":       signed(t, "secret", jwt.MapClaims{"scope": "login", "exp": exp}),
		"not a token":  "garbage",
	} {
		if err := Verify(ctx, pool, "secret", token, "login"); err == nil {
			t.Errorf("%s token accepted", name)
		}
	}
	r := httptest.NewRequest("POST", "/", nil)
	r.Header.Set(Header, valid)
	t.Setenv("CAP_SECRET", "secret")
	if err := Request(ctx, pool, r, "login"); err != nil {
		t.Fatalf("valid token refused: %v", err)
	}
	if err := Verify(ctx, pool, "secret", valid, "login"); err == nil {
		t.Error("token accepted twice")
	}
}

func TestPruneNoncesDropsOnlyExpiredOnes(t *testing.T) {
	ctx := context.Background()
	pool := testkit.Pool(t)
	if _, err := pool.Exec(ctx, `INSERT INTO cap_nonces (id, jti, created) VALUES
		('old', 'old', now() - interval '2 hours'), ('fresh', 'fresh', now() - interval '30 minutes')`); err != nil {
		t.Fatal(err)
	}
	if err := PruneNonces(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var kept []string
	if err := pool.QueryRow(ctx, `SELECT coalesce(array_agg(jti), '{}') FROM cap_nonces`).Scan(&kept); err != nil {
		t.Fatal(err)
	}
	if len(kept) != 1 || kept[0] != "fresh" {
		t.Errorf("kept %v, want only fresh", kept)
	}
}
