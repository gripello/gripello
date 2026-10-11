package auth

import (
	"context"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"gripello/internal/platform/db"
	"gripello/internal/platform/testkit"
)

func TestSignKeepsPocketBaseClaimNames(t *testing.T) {
	token, err := Issuer{Secret: "s", Duration: time.Hour}.Sign("user1", "key1", "sid1")
	if err != nil {
		t.Fatal(err)
	}
	var claims Claims
	if _, err := jwt.ParseWithClaims(token, &claims, func(*jwt.Token) (any, error) { return []byte("key1s"), nil }); err != nil {
		t.Fatal(err)
	}
	if claims.ID != "user1" || claims.SessionID != "sid1" || claims.Type != "auth" || !claims.Refreshable {
		t.Fatalf("claims %+v", claims)
	}
}

func TestTokenFromPocketBaseCookie(t *testing.T) {
	r, _ := http.NewRequest("GET", "/", nil)
	r.AddCookie(&http.Cookie{Name: "pb_auth", Value: url.QueryEscape(`{"token":"abc.def.ghi","record":{"id":"x"}}`)})
	c, _ := r.Cookie("pb_auth")
	c.Value, _ = url.QueryUnescape(c.Value)
	if got := cookieToken(c.Value); got != "abc.def.ghi" {
		t.Fatalf("got %q", got)
	}
	r.Header.Set("Authorization", "Bearer zzz")
	if TokenFrom(r) != "zzz" {
		t.Fatal("bearer header should win")
	}
}

func TestVerifyRejectsWrongTypeMissingExpiryAndExpiredLegacyTokens(t *testing.T) {
	ctx := context.Background()
	pool := testkit.Pool(t)
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	pool.Exec(ctx, `INSERT INTO users (id, username, token_key) VALUES ('u1', 'u1', 'key1')`)
	sign := func(claims Claims) string {
		token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("key1s"))
		return token
	}
	inAnHour := jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}
	legacy := sign(Claims{RegisteredClaims: inAnHour, ID: "u1", Type: "auth"})
	if _, err := Verify(ctx, pool, "s", legacy); err != nil {
		t.Fatalf("legacy token refused before the cutoff: %v", err)
	}
	for name, token := range map[string]string{
		"file type":  sign(Claims{RegisteredClaims: inAnHour, ID: "u1", Type: "file"}),
		"no expiry":  sign(Claims{ID: "u1", Type: "auth"}),
		"no type":    sign(Claims{RegisteredClaims: inAnHour, ID: "u1"}),
		"wrong user": sign(Claims{RegisteredClaims: inAnHour, ID: "u2", Type: "auth"}),
	} {
		if _, err := Verify(ctx, pool, "s", token); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	defer func(previous time.Time) { legacyTokensUntil = previous }(legacyTokensUntil)
	legacyTokensUntil = time.Now()
	if _, err := Verify(ctx, pool, "s", legacy); err == nil {
		t.Error("token without a session accepted after the cutoff")
	}
}
