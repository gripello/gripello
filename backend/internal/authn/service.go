package authn

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/climbers"
	"gripello/internal/platform/db"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/lockout"
	"gripello/internal/platform/mail"
	"gripello/internal/platform/password"
)

const (
	methodPassword = "password"
	methodTOTP     = "totp"
	methodPasskey  = "passkey"
	methodRecovery = "recovery"

	sessionUserAgentMax = 300

	verificationTokenTTL  = 7 * 24 * time.Hour
	passwordResetTokenTTL = 30 * time.Minute
	emailChangeTokenTTL   = 30 * time.Minute
)

var (
	errFailedAuth      = httpx.BadRequest("Failed to authenticate.")
	errInvalidMFA      = httpx.BadRequest("Invalid or expired MFA session.")
	errNotVerified     = httpx.NewError(http.StatusForbidden, "The account is not verified.")
	errSuspended       = httpx.NewError(http.StatusForbidden, "This account is suspended.")
	errCeremonyExpired = httpx.BadRequest("The passkey request expired.")
)

func lockoutKey(user *account, identity string) string {
	if user != nil {
		return user.ID
	}
	return ids.Hash(strings.ToLower(strings.TrimSpace(identity)))
}

func (m *module) recordLoginFailure(ctx context.Context, r *http.Request, key string, user *account, label string) {
	locked, err := lockout.Failed(ctx, m.db, key)
	if err != nil {
		slog.Error("authn: counting a failed login failed", "error", err)
		return
	}
	event := AuthEvent{Action: "login_failed", Label: label, IP: httpx.ClientIP(r)}
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

var unknownAccountHash = sync.OnceValue(func() string {
	hash, _ := password.Hash(ids.New())
	return hash
})

// upgradeLegacyHash stores a prefixed hash after a successful check of a plain bcrypt one; a failure only logs.
func (m *module) upgradeLegacyHash(ctx context.Context, user account, pw string) {
	if !password.Legacy(user.PasswordHash) {
		return
	}
	hash, err := password.Hash(pw)
	if err == nil {
		_, err = m.db.Exec(ctx, `UPDATE users SET password_hash = $2 WHERE id = $1 AND password_hash = $3`, user.ID, hash, user.PasswordHash)
	}
	if err != nil {
		slog.Error("authn: upgrading a legacy password hash failed", "error", err)
	}
}

// checkPassword spends a bcrypt round even without a hash, so timing doesn't tell unknown identities apart.
func checkPassword(hash, pw string) bool {
	if hash == "" {
		password.Matches(unknownAccountHash(), pw)
		return false
	}
	return password.Matches(hash, pw)
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
		if sessionID, err = insertSession(ctx, tx, user.ID, method, r.UserAgent(), httpx.ClientIP(r)); err != nil {
			return err
		}
		if err := lockout.Clear(ctx, tx, user.ID); err != nil {
			return err
		}
		return publishAuthEvent(ctx, tx, AuthEvent{Action: "login", User: user.ID, Label: user.label(), Method: method, IP: httpx.ClientIP(r)})
	})
	if err != nil {
		return err
	}
	m.announceAccount(ctx, user.ID, "sessions")
	return m.respondWithToken(w, r, user, sessionID)
}

func (m *module) respondWithToken(w http.ResponseWriter, r *http.Request, user account, sessionID string) error {
	token, err := m.tokens.Sign(user.ID, user.TokenKey, sessionID)
	if err != nil {
		return err
	}
	record, err := climbers.OwnRecord(r.Context(), m.db, user.ID)
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, map[string]any{"token": token, "record": record}, nil)
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

// mfaUser leaves the challenge for a retry and reserves a lockout attempt the caller settles.
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
	if err := checkAccess(user); err != nil {
		return account{}, err
	}
	return user, lockout.Reserve(ctx, m.db, user.ID)
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

func (m *module) parseMailToken(ctx context.Context, q db.Querier, token, kind string) (account, mailClaims, bool) {
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

// sendAuthMail runs off the request path, so answer times don't tell whether an address got a mail.
func (m *module) sendAuthMail(ctx context.Context, user account, to string, content mail.Content) {
	ctx = context.WithoutCancel(ctx)
	go func() {
		_, err := m.templates.Send(ctx, m.mail, m.templates.AppBrand(), content, []mail.Recipient{{Address: to, Language: user.Language}})
		if err != nil {
			slog.Error("authn: sending mail failed", "mail", content.Key, "user", user.ID, "error", err)
		}
	}()
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
