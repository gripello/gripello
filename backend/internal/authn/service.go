package authn

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/mail"
)

const (
	methodPassword = "password"
	methodTOTP     = "totp"
	methodPasskey  = "passkey"
	methodRecovery = "recovery"

	lockoutMaxFailures = 10
	lockoutWindow      = 15 * time.Minute
	lockoutDuration    = 15 * time.Minute

	sessionUserAgentMax = 300

	passwordMin = 8
	passwordMax = 71

	verificationTokenTTL  = 7 * 24 * time.Hour
	passwordResetTokenTTL = 30 * time.Minute
	emailChangeTokenTTL   = 30 * time.Minute
)

var (
	errFailedAuth      = httpx.NewError(http.StatusBadRequest, "Failed to authenticate.")
	errInvalidMFA      = httpx.NewError(http.StatusBadRequest, "Invalid or expired MFA session.")
	errAccountLocked   = httpx.NewError(http.StatusTooManyRequests, "Account temporarily locked. Try again later.")
	errNotVerified     = httpx.NewError(http.StatusForbidden, "The account is not verified.")
	errSuspended       = httpx.NewError(http.StatusForbidden, "This account is suspended.")
	errCeremonyExpired = httpx.NewError(http.StatusBadRequest, "The passkey request expired.")
)

func lockoutKey(user *account, identity string) string {
	if user != nil {
		return user.ID
	}
	digest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(identity))))
	return hex.EncodeToString(digest[:])
}

func isLockedOut(ctx context.Context, q querier, key string) bool {
	var locked bool
	q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM login_lockouts WHERE key = $1 AND locked_until > now())`, key).Scan(&locked)
	return locked
}

// countLoginFailure is one upsert, so parallel guesses are all counted; the tenth locks the key.
func countLoginFailure(ctx context.Context, q querier, key string) (bool, error) {
	var failures int
	err := q.QueryRow(ctx, `INSERT INTO login_lockouts (id, key, failures, window_start) VALUES ($1, $2, 1, now())
		ON CONFLICT (key) DO UPDATE SET
		  failures = CASE WHEN login_lockouts.window_start IS NULL OR login_lockouts.window_start < now() - $3::interval THEN 1 ELSE login_lockouts.failures + 1 END,
		  window_start = CASE WHEN login_lockouts.window_start IS NULL OR login_lockouts.window_start < now() - $3::interval THEN now() ELSE login_lockouts.window_start END
		RETURNING failures`, ids.New(), key, lockoutWindow.String()).Scan(&failures)
	if err != nil || failures < lockoutMaxFailures {
		return false, err
	}
	_, err = q.Exec(ctx, `UPDATE login_lockouts SET locked_until = now() + $2::interval, failures = 0, window_start = now() WHERE key = $1`,
		key, lockoutDuration.String())
	return err == nil, err
}

func clearLoginFailures(ctx context.Context, q querier, key string) error {
	_, err := q.Exec(ctx, `DELETE FROM login_lockouts WHERE key = $1`, key)
	return err
}

func (m *module) recordLoginFailure(ctx context.Context, r *http.Request, key string, user *account, label string) {
	locked, err := countLoginFailure(ctx, m.db, key)
	if err != nil {
		slog.Error("authn: counting a failed login failed", "error", err)
		return
	}
	event := AuthEvent{Action: "login_failed", Label: label, IP: clientIP(r)}
	if user != nil {
		event.User, event.Label = user.ID, user.label()
	}
	m.audit(ctx, event)
	if locked {
		if user == nil {
			event.Label = "unknown:" + key[:8]
		}
		event.Action = "account_locked"
		m.audit(ctx, event)
	}
}

func (m *module) audit(ctx context.Context, event AuthEvent) {
	if err := pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error { return publishAuthEvent(ctx, tx, event) }); err != nil {
		slog.Error("authn: audit event failed", "action", event.Action, "error", err)
	}
}

func maskedIdentity(identity string) string {
	identity = strings.TrimSpace(identity)
	if at := strings.IndexByte(identity, '@'); at > 0 {
		return identity[:1] + "***" + identity[at:]
	}
	if len(identity) > 2 {
		return identity[:2] + "***"
	}
	return "***"
}

var unknownAccountHash = sync.OnceValue(func() []byte {
	hash, _ := bcrypt.GenerateFromPassword([]byte(ids.New()), 10)
	return hash
})

// checkPassword spends a bcrypt round even without a hash, so timing doesn't tell unknown identities apart.
func checkPassword(hash, password string) bool {
	if hash == "" {
		bcrypt.CompareHashAndPassword(unknownAccountHash(), []byte(password))
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

func hashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	return string(hash), err
}

// checkAccess mirrors the users auth rule (verified) and the suspension guard.
func checkAccess(user account) error {
	if !user.Verified {
		return errNotVerified
	}
	if user.SuspendedUntil != nil && user.SuspendedUntil.After(time.Now()) {
		return errSuspended
	}
	return nil
}

// signIn ends every login path: it consumes the MFA challenge, starts a session and answers {token, record}.
func (m *module) signIn(w http.ResponseWriter, r *http.Request, user account, method, mfaID string) error {
	if err := checkAccess(user); err != nil {
		return err
	}
	ctx := r.Context()
	var sessionID string
	err := pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		if mfaID != "" {
			c, err := takeChallenge(ctx, tx, "login", mfaID)
			if isNoRows(err) || err == nil && (c.User != user.ID || c.Method == method) {
				return errInvalidMFA
			}
			if err != nil {
				return err
			}
		}
		var err error
		if sessionID, err = insertSession(ctx, tx, user.ID, method, r.UserAgent(), clientIP(r)); err != nil {
			return err
		}
		if err := clearLoginFailures(ctx, tx, user.ID); err != nil {
			return err
		}
		return publishAuthEvent(ctx, tx, AuthEvent{Action: "login", User: user.ID, Label: user.label(), Method: method, IP: clientIP(r)})
	})
	if err != nil {
		return err
	}
	return m.respondWithToken(w, r, user, sessionID)
}

func (m *module) respondWithToken(w http.ResponseWriter, r *http.Request, user account, sessionID string) error {
	token, err := m.tokens.Sign(user.ID, user.TokenKey, sessionID)
	if err != nil {
		return err
	}
	record, err := userRecord(r.Context(), m.db, user.ID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"token": token, "record": record})
	return nil
}

func (m *module) secondFactorMethods(ctx context.Context, userID string) ([]string, error) {
	factors, err := listFactors(ctx, m.db, userID)
	if err != nil {
		return nil, err
	}
	kinds := map[string]bool{}
	for _, f := range factors {
		kinds[f.Kind] = true
	}
	methods := []string{}
	for _, method := range []string{methodTOTP, methodPasskey} {
		if kinds[method] {
			methods = append(methods, method)
		}
	}
	if recoveryCodesLeft(ctx, m.db, userID) > 0 {
		methods = append(methods, methodRecovery)
	}
	return methods, nil
}

// mfaUser resolves the pending challenge of a second step without consuming it, so a wrong code can be retried.
func (m *module) mfaUser(ctx context.Context, mfaID string) (account, error) {
	c, err := findChallenge(ctx, m.db, "login", mfaID)
	if isNoRows(err) || err == nil && c.User == "" {
		return account{}, errInvalidMFA
	}
	if err != nil {
		return account{}, err
	}
	user, err := findAccount(ctx, m.db, c.User)
	if isNoRows(err) {
		return account{}, errInvalidMFA
	}
	if err != nil {
		return account{}, err
	}
	if isLockedOut(ctx, m.db, user.ID) {
		return account{}, errAccountLocked
	}
	return user, checkAccess(user)
}

type mailClaims struct {
	jwt.RegisteredClaims
	ID       string `json:"id"`
	Type     string `json:"type"`
	Email    string `json:"email"`
	NewEmail string `json:"newEmail,omitempty"`
}

// Mail-flow tokens are signed with the user's token key, so they die with a password or email change.
func (m *module) signMailToken(user account, kind, newEmail string, ttl time.Duration) (string, error) {
	claims := mailClaims{
		RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl))},
		ID:               user.ID,
		Type:             kind,
		Email:            user.Email,
		NewEmail:         newEmail,
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(user.TokenKey + m.tokens.Secret))
}

func (m *module) parseMailToken(ctx context.Context, q querier, token, kind string) (account, mailClaims, bool) {
	var claims mailClaims
	parser := jwt.NewParser(jwt.WithValidMethods([]string{"HS256"}))
	if _, _, err := parser.ParseUnverified(token, &claims); err != nil || claims.ID == "" || claims.Type != kind {
		return account{}, claims, false
	}
	user, err := findAccount(ctx, q, claims.ID)
	if err != nil {
		return account{}, claims, false
	}
	_, err = parser.ParseWithClaims(token, &mailClaims{}, func(*jwt.Token) (any, error) {
		return []byte(user.TokenKey + m.tokens.Secret), nil
	})
	return user, claims, err == nil && strings.EqualFold(claims.Email, user.Email)
}

func (m *module) sendAuthMail(ctx context.Context, user account, to string, content mail.Content) {
	_, err := m.templates.Send(ctx, m.mail, m.templates.AppBrand(), content, []mail.Recipient{{Address: to, Language: user.Language}})
	if err != nil {
		slog.Error("authn: sending mail failed", "mail", content.Key, "user", user.ID, "error", err)
	}
}

// clientIP trusts X-Real-IP / X-Forwarded-For because nginx sets them in front of every replica.
func clientIP(r *http.Request) string {
	raw := r.Header.Get("X-Real-IP")
	if raw == "" {
		raw, _, _ = strings.Cut(r.Header.Get("X-Forwarded-For"), ",")
	}
	if raw = strings.TrimSpace(raw); raw == "" {
		raw = r.RemoteAddr
		if host, _, err := net.SplitHostPort(raw); err == nil {
			raw = host
		}
	}
	return displayIP(raw)
}

func displayIP(raw string) string {
	if ip := net.ParseIP(raw); ip != nil {
		return ip.String()
	}
	return raw
}

func truncateRunes(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max])
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
