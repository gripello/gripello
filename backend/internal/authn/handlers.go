package authn

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/blocklist"
	"gripello/internal/platform/captcha"
	"gripello/internal/platform/climbers"
	"gripello/internal/platform/db"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/locales"
	"gripello/internal/platform/lockout"
	platformmail "gripello/internal/platform/mail"
	pw "gripello/internal/platform/password"
)

const (
	recoveryCodeCount = 10
	nameMax           = 5000
	codeNotUnique     = "validation_not_unique"
)

var (
	usernamePattern = regexp.MustCompile(`^[\w][\w.\-]*$`)
)

func (m *module) login(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Identity string `json:"identity"`
		Password string `json:"password"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if err := captcha.Request(r.Context(), m.db, r, "login"); err != nil {
		return err
	}
	ctx := r.Context()
	user, err := findAccountByIdentity(ctx, m.db, strings.TrimSpace(body.Identity))
	if err != nil && !isNoRows(err) {
		return err
	}
	var known *account
	if err == nil {
		known = &user
	}
	key := lockoutKey(known, body.Identity)
	if err := lockout.Reserve(ctx, m.db, key); err != nil {
		return err
	}
	if !checkPassword(user.PasswordHash, body.Password) || known == nil {
		m.recordLoginFailure(ctx, r, key, known, maskedIdentity(body.Identity))
		return errFailedAuth
	}
	if err := lockout.Release(ctx, m.db, key); err != nil {
		return err
	}
	m.upgradeLegacyHash(ctx, user, body.Password)
	if err := checkAccess(user); err != nil {
		return err
	}
	return m.firstFactorDone(w, r, user, methodPassword)
}

// firstFactorDone signs in, or answers 401 {mfaId, methods} when the account has second factors.
func (m *module) firstFactorDone(w http.ResponseWriter, r *http.Request, user account, method string) error {
	ctx := r.Context()
	factors, err := listFactors(ctx, m.db, user.ID)
	if err != nil {
		return err
	}
	if len(factors) == 0 {
		return m.signIn(w, r, user, method, "")
	}
	methods, err := m.secondFactorMethods(ctx, user.ID)
	if err != nil {
		return err
	}
	mfaID, err := insertChallenge(ctx, m.db, "login", user.ID, method, nil)
	if err != nil {
		return err
	}
	m.audit(ctx, AuthEvent{Action: "login_second_factor", User: user.ID, Label: user.label(), Method: method, IP: httpx.ClientIP(r)})
	return httpx.Respond(w, http.StatusUnauthorized, map[string]any{"mfaId": mfaID, "methods": methods}, nil)
}

type secondStep struct {
	MFAID string `json:"mfaId"`
	Code  string `json:"code"`
}

func (m *module) loginWithTOTP(w http.ResponseWriter, r *http.Request) error {
	var body secondStep
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	ctx := r.Context()
	user, err := m.mfaUser(ctx, body.MFAID)
	if err != nil {
		return err
	}
	factors, err := listFactors(ctx, m.db, user.ID)
	if err != nil {
		lockout.Release(ctx, m.db, user.ID)
		return err
	}
	accepted := false
	for _, f := range factors {
		if f.Kind != methodTOTP {
			continue
		}
		if key, err := decodeTOTPSecret(f.Secret); err == nil {
			step := matchTOTP(key, body.Code, time.Now(), f.LastStep)
			accepted = step != 0 && claimTOTPStep(ctx, m.db, f.ID, step)
		}
	}
	if !accepted {
		m.recordLoginFailure(ctx, r, user.ID, &user, "")
		return errFailedAuth
	}
	if err := lockout.Release(ctx, m.db, user.ID); err != nil {
		return err
	}
	return m.signIn(w, r, user, methodTOTP, body.MFAID)
}

func (m *module) loginWithRecoveryCode(w http.ResponseWriter, r *http.Request) error {
	var body secondStep
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	ctx := r.Context()
	user, err := m.mfaUser(ctx, body.MFAID)
	if err != nil {
		return err
	}
	hash := hashRecoveryCode(body.Code)
	if !useRecoveryCode(ctx, m.db, user.ID, hash) {
		m.recordLoginFailure(ctx, r, user.ID, &user, "")
		return errFailedAuth
	}
	if err := lockout.Release(ctx, m.db, user.ID); err != nil {
		restoreRecoveryCode(ctx, m.db, user.ID, hash)
		return err
	}
	if err := m.signIn(w, r, user, methodRecovery, body.MFAID); err != nil {
		restoreRecoveryCode(ctx, m.db, user.ID, hash)
		return err
	}
	m.audit(ctx, AuthEvent{Action: "recovery_code_used", User: user.ID, Label: user.label(), IP: httpx.ClientIP(r)})
	return nil
}

func (m *module) refresh(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	ctx := r.Context()
	user, err := findAccount(ctx, m.db, p.UserID)
	if err != nil {
		return err
	}
	if err := checkAccess(user); err != nil {
		return err
	}
	if _, err := m.db.Exec(ctx, `UPDATE sessions SET last_seen = now(), ip = $2 WHERE id = $1`, p.SessionID, httpx.ClientIP(r)); err != nil {
		return err
	}
	return m.respondWithToken(w, r, user, p.SessionID)
}

func (m *module) logout(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	err = pgx.BeginFunc(r.Context(), m.db, func(tx pgx.Tx) error {
		return deleteSessions(r.Context(), tx, p.UserID, `"user" = $1 AND id = $2`, p.SessionID)
	})
	if err != nil {
		return err
	}
	return httpx.NoContent(w, nil)
}

func (m *module) register(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Email           string `json:"email"`
		Username        string `json:"username"`
		Password        string `json:"password"`
		PasswordConfirm string `json:"passwordConfirm"`
		Firstname       string `json:"firstname"`
		Name            string `json:"name"`
		Language        string `json:"language"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	ctx := r.Context()
	var allowed bool
	if err := m.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM settings WHERE allow_registration)`).Scan(&allowed); err != nil {
		return err
	}
	if !allowed {
		return httpx.NewError(http.StatusForbidden, "Registration is disabled.")
	}
	if err := captcha.Request(ctx, m.db, r, "register"); err != nil {
		return err
	}
	invalid := httpx.BadRequest("Failed to create record.")
	body.Email = platformmail.NormalizeAddress(body.Email)
	code, message, err := m.validateNewEmail(r, body.Email, "")
	if err != nil {
		return err
	}
	taken := code == codeNotUnique
	if code != "" && !taken {
		invalid.Field("email", code, message)
	}
	if body.Username == "" {
		body.Username = m.generateUsername(r)
	} else if code, message, err := m.validateUsername(r, body.Username); err != nil {
		return err
	} else if code != "" {
		invalid.Field("username", code, message)
	}
	validatePassword(invalid, "password", body.Password, body.PasswordConfirm)
	for field, value := range map[string]string{"firstname": body.Firstname, "name": body.Name} {
		if utf8.RuneCountInString(value) > nameMax {
			invalid.Field(field, "validation_max_text_constraint", fmt.Sprintf("Must be no more than %d character(s).", nameMax))
		}
	}
	if protected, err := blocklist.NameProtected(ctx, m.db, body.Firstname+" "+body.Name); err != nil {
		return err
	} else if protected {
		invalid.Field("name", blocklist.CodeNameProtected, "This name is reserved.")
	}
	if !locales.Allowed(body.Language) {
		invalid.Field("language", "validation_invalid_value", "Invalid value "+body.Language+".")
	}
	if len(invalid.Data) > 0 {
		return invalid
	}
	hash, err := pw.Hash(body.Password)
	if err != nil {
		return err
	}
	if taken {
		m.notifyAccountExists(ctx, body.Email)
		w.WriteHeader(http.StatusAccepted)
		return nil
	}
	user, err := scanAccount(m.db.QueryRow(ctx, `INSERT INTO users (id, email, username, firstname, name, language, password_hash, token_key)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING `+accountColumns,
		ids.New(), body.Email, body.Username, strings.TrimSpace(body.Firstname), strings.TrimSpace(body.Name), body.Language, hash, newTokenKey()))
	if db.IsUnique(err, "email") {
		m.notifyAccountExists(ctx, body.Email)
		w.WriteHeader(http.StatusAccepted)
		return nil
	}
	if err != nil {
		return err
	}
	m.sendVerification(r, user)
	w.WriteHeader(http.StatusAccepted)
	return nil
}

// notifyAccountExists answers a sign-up or e-mail change to a taken address by telling its owner instead of the requester.
func (m *module) notifyAccountExists(ctx context.Context, email string) {
	if owner, err := findAccountByEmail(ctx, m.db, email); err == nil {
		m.sendAuthMail(ctx, owner, owner.Email, platformmail.Content{Key: "accountExists", Name: owner.Firstname, Action: "/auth/login"})
	}
}

func (m *module) validateNewEmail(r *http.Request, email, exceptID string) (string, string, error) {
	if email == "" {
		return "validation_required", "Cannot be blank.", nil
	}
	if !platformmail.ValidAddress(email) {
		return "validation_is_email", "Must be a valid email address.", nil
	}
	if blocked, err := blocklist.EmailBlocked(r.Context(), m.db, email); err != nil || blocked {
		return blocklist.CodeEmailBlocked, "This e-mail address can't be used.", err
	}
	if taken, err := emailTaken(r.Context(), m.db, email, exceptID); err != nil || taken {
		return codeNotUnique, "Value must be unique.", err
	}
	return "", "", nil
}

func (m *module) validateUsername(r *http.Request, username string) (string, string, error) {
	if length := utf8.RuneCountInString(username); length < 3 || length > 150 {
		return "validation_length_out_of_range", "The length must be between 3 and 150.", nil
	}
	if !usernamePattern.MatchString(username) {
		return "validation_invalid_format", "Invalid value format.", nil
	}
	if protected, err := blocklist.NameProtected(r.Context(), m.db, username); err != nil || protected {
		return blocklist.CodeNameProtected, "This name is reserved.", err
	}
	if taken, err := usernameTaken(r.Context(), m.db, username); err != nil || taken {
		return "validation_not_unique", "Value must be unique.", err
	}
	return "", "", nil
}

func (m *module) generateUsername(r *http.Request) string {
	for {
		n, _ := rand.Int(rand.Reader, big.NewInt(1_000_000))
		username := fmt.Sprintf("users%06d", n.Int64())
		if taken, err := usernameTaken(r.Context(), m.db, username); err != nil || !taken {
			return username
		}
	}
}

func validatePassword(invalid *httpx.Error, field, password, confirm string) {
	if password == "" {
		invalid.Field(field, "validation_required", "Cannot be blank.")
	} else if pw.TooShort(password) {
		invalid.Field(field, "validation_length_out_of_range", fmt.Sprintf("Must be at least %d characters.", pw.MinLength))
	}
	if password != confirm {
		invalid.Field(field+"Confirm", "validation_values_mismatch", "Values don't match.")
	}
}

func (m *module) sendVerification(r *http.Request, user account) {
	token, err := m.signMailToken(user, "verification", "", verificationTokenTTL)
	if err == nil {
		m.sendAuthMail(r.Context(), user, user.Email, platformmail.Verification(user.Firstname, token))
	}
}

func (m *module) requestPasswordReset(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Email string `json:"email"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	ctx := r.Context()
	if err := captcha.Request(ctx, m.db, r, "password-reset"); err != nil {
		return err
	}
	if user, err := findAccountByEmail(ctx, m.db, strings.TrimSpace(body.Email)); err == nil {
		if token, err := m.signMailToken(user, "passwordReset", "", passwordResetTokenTTL); err == nil {
			m.sendAuthMail(ctx, user, user.Email, platformmail.PasswordReset(user.Firstname, token))
		}
		go m.audit(context.WithoutCancel(ctx), AuthEvent{Action: "password_reset_request", User: user.ID, Label: user.label(), IP: httpx.ClientIP(r)})
	} else if !isNoRows(err) {
		return err
	}
	return httpx.NoContent(w, nil)
}

func invalidToken() *httpx.Error {
	return httpx.BadRequest("Invalid or expired token.").Field("token", "validation_invalid_token", "Invalid or expired token.")
}

func (m *module) confirmPasswordReset(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Token           string `json:"token"`
		Password        string `json:"password"`
		PasswordConfirm string `json:"passwordConfirm"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	invalid := httpx.BadRequest("Failed to validate.")
	validatePassword(invalid, "password", body.Password, body.PasswordConfirm)
	if len(invalid.Data) > 0 {
		return invalid
	}
	ctx := r.Context()
	user, _, ok := m.parseMailToken(ctx, m.db, body.Token, "passwordReset")
	if !ok {
		return invalidToken()
	}
	hash, err := pw.Hash(body.Password)
	if err != nil {
		return err
	}
	err = pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE users SET password_hash = $2, verified = true WHERE id = $1 AND token_key = $3`, user.ID, hash, user.TokenKey)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return invalidToken()
		}
		if err := rotateTokenKey(ctx, tx, user.ID); err != nil {
			return err
		}
		if err := lockout.Clear(ctx, tx, user.ID); err != nil {
			return err
		}
		return publishAuthEvent(ctx, tx, AuthEvent{Action: "password_reset", User: user.ID, Label: user.label(), IP: httpx.ClientIP(r)})
	})
	if err != nil {
		return err
	}
	return httpx.NoContent(w, nil)
}

func (m *module) requestVerification(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Email string `json:"email"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if err := captcha.Request(r.Context(), m.db, r, "verification"); err != nil {
		return err
	}
	user, err := findAccountByEmail(r.Context(), m.db, strings.TrimSpace(body.Email))
	if err == nil && !user.Verified {
		m.sendVerification(r, user)
	} else if err != nil && !isNoRows(err) {
		return err
	}
	return httpx.NoContent(w, nil)
}

func (m *module) confirmVerification(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Token string `json:"token"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	user, _, ok := m.parseMailToken(r.Context(), m.db, body.Token, "verification")
	if !ok {
		return invalidToken()
	}
	ctx := r.Context()
	err := pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE users SET verified = true WHERE id = $1 AND NOT verified`, user.ID)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		record, err := climbers.OwnRecord(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		return climbers.PublishUserUpdated(ctx, tx, "", user.ID, record, []string{"verified"})
	})
	if err != nil {
		return err
	}
	return httpx.NoContent(w, nil)
}

func (m *module) requestEmailChange(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	var body struct {
		NewEmail string `json:"newEmail"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	ctx := r.Context()
	user, err := findAccount(ctx, m.db, p.UserID)
	if err != nil {
		return err
	}
	newEmail := platformmail.NormalizeAddress(body.NewEmail)
	if code, message, err := m.validateNewEmail(r, newEmail, ""); err != nil {
		return err
	} else if code == codeNotUnique {
		if newEmail != user.Email {
			m.notifyAccountExists(ctx, newEmail)
		}
		return httpx.NoContent(w, nil)
	} else if code != "" {
		return httpx.BadRequest("Failed to validate.").Field("newEmail", code, message)
	}
	token, err := m.signMailToken(user, "emailChange", newEmail, emailChangeTokenTTL)
	if err != nil {
		return err
	}
	m.sendAuthMail(ctx, user, newEmail, platformmail.EmailChange(user.Firstname, token))
	m.audit(ctx, AuthEvent{Action: "email_change_request", User: user.ID, Label: user.label(), IP: httpx.ClientIP(r)})
	return httpx.NoContent(w, nil)
}

func (m *module) confirmEmailChange(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	ctx := r.Context()
	user, claims, ok := m.parseMailToken(ctx, m.db, body.Token, "emailChange")
	if !ok || claims.NewEmail == "" {
		return invalidToken()
	}
	claims.NewEmail = platformmail.NormalizeAddress(claims.NewEmail)
	if err := m.confirmPassword(r, user, "password", body.Password, "validation_invalid_password"); err != nil {
		return err
	}
	if code, message, err := m.validateNewEmail(r, claims.NewEmail, user.ID); err != nil {
		return err
	} else if code != "" {
		return httpx.BadRequest("Failed to validate.").Field("newEmail", code, message)
	}
	err := pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE users SET email = $2, verified = true WHERE id = $1 AND token_key = $3`, user.ID, claims.NewEmail, user.TokenKey)
		if db.IsUnique(err, "email") {
			return httpx.BadRequest("Failed to validate.").Field("newEmail", codeNotUnique, "Value must be unique.")
		}
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return invalidToken()
		}
		if err := rotateTokenKey(ctx, tx, user.ID); err != nil {
			return err
		}
		return publishAuthEvent(ctx, tx, AuthEvent{Action: "email_change", User: user.ID, Label: claims.NewEmail, IP: httpx.ClientIP(r)})
	})
	if err != nil {
		return err
	}
	return httpx.NoContent(w, nil)
}

// changePassword rotates the tokenKey, ending every session, and answers with a fresh login for this device.
func (m *module) changePassword(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	var body struct {
		OldPassword     string `json:"oldPassword"`
		Password        string `json:"password"`
		PasswordConfirm string `json:"passwordConfirm"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	ctx := r.Context()
	user, err := findAccount(ctx, m.db, p.UserID)
	if err != nil {
		return err
	}
	invalid := httpx.BadRequest("Failed to validate.")
	validatePassword(invalid, "password", body.Password, body.PasswordConfirm)
	if len(invalid.Data) > 0 {
		return invalid
	}
	if err := m.confirmPassword(r, user, "oldPassword", body.OldPassword, "validation_invalid_old_password"); err != nil {
		return err
	}
	hash, err := pw.Hash(body.Password)
	if err != nil {
		return err
	}
	var sessionID string
	err = pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE users SET password_hash = $2 WHERE id = $1`, user.ID, hash); err != nil {
			return err
		}
		if err := rotateTokenKey(ctx, tx, user.ID); err != nil {
			return err
		}
		if sessionID, err = insertSession(ctx, tx, user.ID, methodPassword, r.UserAgent(), httpx.ClientIP(r)); err != nil {
			return err
		}
		return publishAuthEvent(ctx, tx, AuthEvent{Action: "password_change", User: user.ID, Label: user.label(), IP: httpx.ClientIP(r)})
	})
	if err != nil {
		return err
	}
	user, err = findAccount(ctx, m.db, user.ID)
	if err != nil {
		return err
	}
	return m.respondWithToken(w, r, user, sessionID)
}

// reauthenticate stamps the caller's session so sensitive admin actions accept it for auth.ReauthWindow.
func (m *module) reauthenticate(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	if _, err := m.requirePassword(r); err != nil {
		return err
	}
	if _, err := m.db.Exec(r.Context(), `UPDATE sessions SET reauthenticated_at = now() WHERE id = $1`, p.SessionID); err != nil {
		return err
	}
	return httpx.NoContent(w, nil)
}

// requirePassword guards adding or removing factors; wrong passwords count toward the lockout.
func (m *module) requirePassword(r *http.Request) (account, error) {
	p, err := auth.Require(r.Context())
	if err != nil {
		return account{}, err
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return account{}, err
	}
	ctx := r.Context()
	user, err := findAccount(ctx, m.db, p.UserID)
	if err != nil {
		return account{}, err
	}
	if err := m.confirmPassword(r, user, "password", body.Password, "invalid_password"); err != nil {
		return account{}, err
	}
	return user, nil
}

// confirmPassword checks the password of a known account; wrong guesses count toward its lockout.
func (m *module) confirmPassword(r *http.Request, user account, field, password, wrongCode string) error {
	ctx := r.Context()
	if user.PasswordHash == "" {
		if lockout.IsLocked(ctx, m.db, user.ID) {
			return lockout.ErrLocked
		}
		return httpx.BadRequest("Set a password first.").Field(field, "password_required", "Set a password first.")
	}
	if err := lockout.Reserve(ctx, m.db, user.ID); err != nil {
		return err
	}
	if !checkPassword(user.PasswordHash, password) {
		m.recordLoginFailure(ctx, r, user.ID, &user, "")
		return httpx.BadRequest("Invalid password.").Field(field, wrongCode, "Invalid password.")
	}
	m.upgradeLegacyHash(ctx, user, password)
	return lockout.Release(ctx, m.db, user.ID)
}
