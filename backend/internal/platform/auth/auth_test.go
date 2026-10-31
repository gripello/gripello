package auth

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/events"
	"gripello/internal/platform/testkit"
)

func TestSignCarriesUserSessionAndType(t *testing.T) {
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

func TestTokenFromAuthCookie(t *testing.T) {
	r, _ := http.NewRequest("GET", "/", nil)
	r.Header.Set("Cookie", "gripello_auth=%7B%22token%22%3A%22abc.def.ghi%22%2C%22record%22%3A%7B%22id%22%3A%22x%22%7D%7D")
	if got := TokenFrom(r); got != "abc.def.ghi" {
		t.Fatalf("got %q", got)
	}
	r.Header.Set("Authorization", "Bearer zzz")
	if TokenFrom(r) != "zzz" {
		t.Fatal("bearer header should win")
	}
}

func TestVerifyRejectsWrongTypeMissingExpiryAndMissingSession(t *testing.T) {
	ctx := context.Background()
	pool := testkit.Pool(t)
	pool.Exec(ctx, `INSERT INTO users (id, username, token_key) VALUES ('u1', 'u1', 'key1')`)
	sign := func(claims Claims) string {
		token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("key1s"))
		return token
	}
	inAnHour := jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}
	pool.Exec(ctx, `INSERT INTO sessions (id, "user") VALUES ('s1', 'u1')`)
	if _, err := Verify(ctx, pool, "s", sign(Claims{RegisteredClaims: inAnHour, ID: "u1", Type: "auth", SessionID: "s1"})); err != nil {
		t.Fatalf("valid token refused: %v", err)
	}
	for name, token := range map[string]string{
		"no session":      sign(Claims{RegisteredClaims: inAnHour, ID: "u1", Type: "auth"}),
		"revoked session": sign(Claims{RegisteredClaims: inAnHour, ID: "u1", Type: "auth", SessionID: "gone"}),
		"file type":       sign(Claims{RegisteredClaims: inAnHour, ID: "u1", Type: "file"}),
		"no expiry":       sign(Claims{ID: "u1", Type: "auth"}),
		"no type":         sign(Claims{RegisteredClaims: inAnHour, ID: "u1"}),
		"wrong user":      sign(Claims{RegisteredClaims: inAnHour, ID: "u2", Type: "auth"}),
	} {
		if _, err := Verify(ctx, pool, "s", token); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestVerifiedTokensSkipTheDatabaseUntilAnEventDropsThem(t *testing.T) {
	ctx := context.Background()
	pool := testkit.Pool(t)
	pool.Exec(ctx, `INSERT INTO users (id, username, token_key) VALUES ('u1', 'u1', 'key1'), ('u2', 'u2', 'key2')`)
	token, _ := Issuer{Secret: "s", Duration: time.Hour}.Sign("u1", "key1", "sid1")
	otherToken, _ := Issuer{Secret: "s", Duration: time.Hour}.Sign("u2", "key2", "sid2")
	cache := NewVerifiedTokens()
	createSessions := func() {
		pool.Exec(ctx, `INSERT INTO sessions (id, "user") VALUES ('sid1', 'u1'), ('sid2', 'u2') ON CONFLICT DO NOTHING`)
	}
	verifies := func(token string) bool {
		_, err := cache.Verify(ctx, pool, "s", token)
		return err == nil
	}

	if verifies(token) {
		t.Fatal("token without a session row accepted")
	}
	createSessions()
	if !verifies(token) || !verifies(otherToken) {
		t.Fatal("failed verification was cached")
	}
	pool.Exec(ctx, `DELETE FROM sessions`)
	if !verifies(token) {
		t.Fatal("cached token queried the database")
	}

	cache.Forget(events.Event{Topic: "session.revoked", Kind: "session.revoked", Payload: []byte(`{"session":"sid1","user":"u1"}`)})
	if verifies(token) {
		t.Error("session.revoked kept the entry")
	}
	if !verifies(otherToken) {
		t.Error("session.revoked dropped another user's entry")
	}

	createSessions()
	verifies(token)
	pool.Exec(ctx, `DELETE FROM sessions`)
	cache.Forget(events.Event{Topic: "user:u1", Kind: "user.updated", Payload: []byte(`{"record":{},"changed":["platform_admin"]}`)})
	if verifies(token) {
		t.Error("user:<id> event kept the entry")
	}

	createSessions()
	verifies(token)
	defer cache.Listen(events.NewBus(pool))()
	pool.Exec(ctx, `DELETE FROM sessions`)
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		return events.Publish(ctx, tx, "session.revoked", "session.revoked", map[string]string{"session": "sid1", "user": "u1"}, events.Audience{})
	})
	if err != nil {
		t.Fatal(err)
	}
	if verifies(token) {
		t.Error("publishing on this replica kept the entry until the bus delivered it")
	}
}

func TestVerifiedTokensRefuseExpiredTokens(t *testing.T) {
	ctx := context.Background()
	pool := testkit.Pool(t)
	pool.Exec(ctx, `INSERT INTO users (id, username, token_key) VALUES ('u1', 'u1', 'key1')`)
	pool.Exec(ctx, `INSERT INTO sessions (id, "user") VALUES ('sid1', 'u1')`)
	token, _ := Issuer{Secret: "s", Duration: 2 * time.Second}.Sign("u1", "key1", "sid1")
	cache := NewVerifiedTokens()
	if _, err := cache.Verify(ctx, pool, "s", token); err != nil {
		t.Fatal(err)
	}
	time.Sleep(2100 * time.Millisecond)
	if _, err := cache.Verify(ctx, pool, "s", token); err == nil {
		t.Error("expired token served from the cache")
	}
}
