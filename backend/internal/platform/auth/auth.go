package auth

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
)

// The cookie store on the client reads `exp`, the server reads `id` and `sid`.
type Claims struct {
	jwt.RegisteredClaims
	ID          string `json:"id"`
	Type        string `json:"type"`
	Refreshable bool   `json:"refreshable"`
	SessionID   string `json:"sid"`
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

// Sign uses HS256 with the user's tokenKey + the token secret, so rotating tokenKey revokes every token of the user.
func (i Issuer) Sign(userID, tokenKey, sessionID string) (string, error) {
	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Now().Add(i.Duration))},
		ID:               userID,
		Type:             "auth",
		Refreshable:      true,
		SessionID:        sessionID,
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(tokenKey + i.Secret))
}

var ErrInvalidToken = errors.New("invalid token")

type userRow struct {
	TokenKey      string
	PlatformAdmin bool
	Verified      bool
}

// Verify parses the token, loads the user's tokenKey and checks the session row still exists.
func Verify(ctx context.Context, pool *pgxpool.Pool, secret, token string) (Principal, error) {
	p, _, err := verify(ctx, pool, secret, token)
	return p, err
}

func verify(ctx context.Context, pool *pgxpool.Pool, secret, token string) (Principal, time.Time, error) {
	var claims Claims
	parser := jwt.NewParser(jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
	if _, _, err := parser.ParseUnverified(token, &claims); err != nil || claims.ID == "" || claims.Type != "auth" || claims.SessionID == "" {
		return Principal{}, time.Time{}, ErrInvalidToken
	}
	var u userRow
	err := pool.QueryRow(ctx, `SELECT token_key, platform_admin, verified FROM users WHERE id = $1`, claims.ID).
		Scan(&u.TokenKey, &u.PlatformAdmin, &u.Verified)
	if err != nil {
		return Principal{}, time.Time{}, ErrInvalidToken
	}
	_, err = parser.ParseWithClaims(token, &Claims{}, func(*jwt.Token) (any, error) {
		return []byte(u.TokenKey + secret), nil
	})
	if err != nil {
		return Principal{}, time.Time{}, ErrInvalidToken
	}
	var exists bool
	pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM sessions WHERE id = $1 AND "user" = $2)`, claims.SessionID, claims.ID).Scan(&exists)
	if !exists {
		return Principal{}, time.Time{}, ErrInvalidToken
	}
	return Principal{UserID: claims.ID, SessionID: claims.SessionID, PlatformAdmin: u.PlatformAdmin, Verified: u.Verified}, claims.ExpiresAt.Time, nil
}

const (
	verifiedTokenTTL   = 15 * time.Second
	verifiedTokenLimit = 100_000
)

// VerifiedTokens remembers recent Verify results per token on this replica, so a busy client costs no queries; events drop a user's entries the moment a session or the user changes.
type VerifiedTokens struct {
	mu      sync.Mutex
	entries map[[32]byte]verifiedToken
	byUser  map[string]map[[32]byte]struct{}
	// A fill that started before an invalidation must not store what it read.
	generation uint64
}

type verifiedToken struct {
	principal Principal
	expires   time.Time
}

func NewVerifiedTokens() *VerifiedTokens {
	return &VerifiedTokens{entries: map[[32]byte]verifiedToken{}, byUser: map[string]map[[32]byte]struct{}{}}
}

// Verify is the package Verify behind the cache; failures are never cached.
func (c *VerifiedTokens) Verify(ctx context.Context, pool *pgxpool.Pool, secret, token string) (Principal, error) {
	if c == nil {
		return Verify(ctx, pool, secret, token)
	}
	key := sha256.Sum256([]byte(token))
	now := time.Now()
	c.mu.Lock()
	hit, ok := c.entries[key]
	generation := c.generation
	c.mu.Unlock()
	if ok && now.Before(hit.expires) {
		return hit.principal, nil
	}
	p, expires, err := verify(ctx, pool, secret, token)
	if err != nil {
		return Principal{}, err
	}
	if ttl := now.Add(verifiedTokenTTL); ttl.Before(expires) {
		expires = ttl
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.generation != generation {
		return p, nil
	}
	if len(c.entries) >= verifiedTokenLimit {
		c.entries, c.byUser = map[[32]byte]verifiedToken{}, map[string]map[[32]byte]struct{}{}
	}
	c.entries[key] = verifiedToken{p, expires}
	if c.byUser[p.UserID] == nil {
		c.byUser[p.UserID] = map[[32]byte]struct{}{}
	}
	c.byUser[p.UserID][key] = struct{}{}
	return p, nil
}

// Forget drops the entries of the user behind a session.revoked event or any event on topic user:<id>.
func (c *VerifiedTokens) Forget(e events.Event) {
	userID, ok := strings.CutPrefix(e.Topic, "user:")
	if e.Topic == "session.revoked" {
		var revoked struct {
			User string `json:"user"`
		}
		json.Unmarshal(e.Payload, &revoked)
		userID, ok = revoked.User, true
	}
	if !ok {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.generation++
	for key := range c.byUser[userID] {
		delete(c.entries, key)
	}
	delete(c.byUser, userID)
}

// Listen drops entries when the writing transaction publishes (so this replica's next request already misses) and again when the bus delivers the committed event (every replica, and fills that raced the commit).
func (c *VerifiedTokens) Listen(bus *events.Bus) (stop func()) {
	bus.Subscribe("session.revoked", c.Forget)
	bus.Subscribe("user:", c.Forget)
	return events.ObservePublish(c.Forget)
}

type ctxKey struct{}

// Middleware resolves the bearer token (or the auth cookie for SSR + SSE) into a Principal; guests pass through.
func Middleware(pool *pgxpool.Pool, secret string, verified *VerifiedTokens) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if token := TokenFrom(r); token != "" {
				if p, err := verified.Verify(r.Context(), pool, secret, token); err == nil {
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
	if c, err := r.Cookie("gripello_auth"); err == nil {
		return cookieToken(c.Value)
	}
	return ""
}

// The client stores encodeURIComponent(JSON {"token":..., "record":...}) in the cookie; a bare JWT is also accepted.
func cookieToken(value string) string {
	if unescaped, err := url.PathUnescape(value); err == nil {
		value = unescaped
	}
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

// UserID is the signed-in caller's id, empty for guests.
func UserID(ctx context.Context) string {
	p, _ := From(ctx)
	return p.UserID
}

// WithPrincipal is for tests and internal calls.
func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, ctxKey{}, p)
}

// StaleBearer reports a request whose bearer token no longer resolves (revoked session, rotated key): the client still believes it is signed in.
func StaleBearer(r *http.Request) bool {
	_, ok := From(r.Context())
	return !ok && r.Header.Get("Authorization") != ""
}

// Require returns the signed-in principal or ErrUnauthorized (handlers map it to 401 via httpx).
func Require(ctx context.Context) (Principal, error) {
	p, ok := From(ctx)
	if !ok {
		return Principal{}, httpx.ErrUnauthorized
	}
	return p, nil
}

// ReauthWindow is how long a password confirmation unlocks sensitive admin actions.
const ReauthWindow = 5 * time.Minute

var ErrReauthRequired = httpx.NewError(http.StatusForbidden, "Confirm your password first.").Field("password", "reauth_required", "Confirm your password first.")

// RequireRecentReauth passes when the caller's session confirmed its password within ReauthWindow.
func RequireRecentReauth(ctx context.Context, pool *pgxpool.Pool, p Principal) error {
	var fresh bool
	err := pool.QueryRow(ctx, `SELECT COALESCE(reauthenticated_at > now() - make_interval(secs => $3), false) FROM sessions WHERE id = $1 AND "user" = $2`,
		p.SessionID, p.UserID, ReauthWindow.Seconds()).Scan(&fresh)
	if err != nil || !fresh {
		return ErrReauthRequired
	}
	return nil
}

// RequireCallerReauth is RequireRecentReauth for the principal in ctx.
func RequireCallerReauth(ctx context.Context, pool *pgxpool.Pool) error {
	p, _ := From(ctx)
	return RequireRecentReauth(ctx, pool, p)
}

// RequirePlatformAdmin answers 401 for guests and 403 for everyone but platform admins.
func RequirePlatformAdmin(ctx context.Context) (Principal, error) {
	p, err := Require(ctx)
	if err == nil && !p.PlatformAdmin {
		err = httpx.ErrForbidden
	}
	return p, err
}

func PlatformAdminsOnly(next httpx.Handler) httpx.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		if _, err := RequirePlatformAdmin(r.Context()); err != nil {
			return err
		}
		return next(w, r)
	}
}
