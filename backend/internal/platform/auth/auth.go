package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform/httpx"
)

// Claims keep PocketBase's names: the cookie store on the client reads `exp`, the server reads `id` and `sid`.
type Claims struct {
	jwt.RegisteredClaims
	ID           string `json:"id"`
	Type         string `json:"type"`
	CollectionID string `json:"collectionId"`
	Refreshable  bool   `json:"refreshable"`
	SessionID    string `json:"sid"`
}

type Principal struct {
	UserID        string
	SessionID     string
	PlatformAdmin bool
	Verified      bool
}

type Issuer struct {
	Secret   string
	Duration time.Duration
}

// Sign matches PocketBase: HS256 with secret = user's tokenKey + collection secret, so imported sessions stay valid.
func (i Issuer) Sign(userID, tokenKey, sessionID string) (string, error) {
	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Now().Add(i.Duration))},
		ID:               userID,
		Type:             "auth",
		CollectionID:     "_pb_users_auth_",
		Refreshable:      true,
		SessionID:        sessionID,
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(tokenKey + i.Secret))
}

var ErrInvalidToken = errors.New("invalid token")

// Imported PocketBase tokens carry no sid and can't be revoked by logout; refresh gives them one, after this date they are refused.
var legacyTokensUntil = time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)

type userRow struct {
	TokenKey      string
	PlatformAdmin bool
	Verified      bool
}

// Verify parses the token, loads the user's tokenKey and checks the session row still exists.
func Verify(ctx context.Context, pool *pgxpool.Pool, secret, token string) (Principal, error) {
	var claims Claims
	parser := jwt.NewParser(jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
	if _, _, err := parser.ParseUnverified(token, &claims); err != nil || claims.ID == "" || claims.Type != "auth" {
		return Principal{}, ErrInvalidToken
	}
	if claims.SessionID == "" && !time.Now().Before(legacyTokensUntil) {
		return Principal{}, ErrInvalidToken
	}
	var u userRow
	err := pool.QueryRow(ctx, `SELECT token_key, platform_admin, verified FROM users WHERE id = $1`, claims.ID).
		Scan(&u.TokenKey, &u.PlatformAdmin, &u.Verified)
	if err != nil {
		return Principal{}, ErrInvalidToken
	}
	_, err = parser.ParseWithClaims(token, &Claims{}, func(*jwt.Token) (any, error) {
		return []byte(u.TokenKey + secret), nil
	})
	if err != nil {
		return Principal{}, ErrInvalidToken
	}
	if claims.SessionID != "" {
		var exists bool
		pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM sessions WHERE id = $1 AND "user" = $2)`, claims.SessionID, claims.ID).Scan(&exists)
		if !exists {
			return Principal{}, ErrInvalidToken
		}
	}
	return Principal{UserID: claims.ID, SessionID: claims.SessionID, PlatformAdmin: u.PlatformAdmin, Verified: u.Verified}, nil
}

type ctxKey struct{}

// Middleware resolves the bearer token (or pb_auth/auth cookie for SSR + SSE) into a Principal; guests pass through.
func Middleware(pool *pgxpool.Pool, secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if token := TokenFrom(r); token != "" {
				if p, err := Verify(r.Context(), pool, secret, token); err == nil {
					r = r.WithContext(context.WithValue(r.Context(), ctxKey{}, p))
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func TokenFrom(r *http.Request) string {
	if h := r.Header.Get("Authorization"); h != "" {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	}
	for _, name := range []string{"auth", "pb_auth"} {
		if c, err := r.Cookie(name); err == nil {
			return cookieToken(c.Value)
		}
	}
	return ""
}

// The PocketBase SDK stores JSON {"token":..., "record":...} in the cookie; a bare JWT is also accepted.
func cookieToken(value string) string {
	if i := strings.Index(value, `"token":"`); i >= 0 {
		rest := value[i+len(`"token":"`):]
		if j := strings.IndexByte(rest, '"'); j >= 0 {
			return rest[:j]
		}
	}
	return value
}

func From(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(ctxKey{}).(Principal)
	return p, ok
}

// WithPrincipal is for tests and internal calls.
func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, ctxKey{}, p)
}

// Require returns the signed-in principal or ErrUnauthorized (handlers map it to 401 via httpx).
func Require(ctx context.Context) (Principal, error) {
	p, ok := From(ctx)
	if !ok {
		return Principal{}, httpx.ErrUnauthorized
	}
	return p, nil
}
