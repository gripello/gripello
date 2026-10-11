package authn

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
	"net/http"
	"net/mail"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/captcha"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	platformmail "gripello/internal/platform/mail"
)

const (
	recoveryCodeCount = 10
	nameMax           = 5000
	codeNotUnique     = "validation_not_unique"
)

var (
	usernamePattern = regexp.MustCompile(`^[\w][\w.\-]*$`)
	languages       = []string{"", "en", "de", "nl", "fr", "es"}
)

// authMethods keeps PocketBase's listAuthMethods shape; OAuth2 and OTP are not offered, second factors are per account.
func authMethods(w http.ResponseWriter, r *http.Request) error {
	httpx.JSON(w, http.StatusOK, map[string]any{
		"password": map[string]any{"enabled": true, "identityFields": []string{"email", "username"}},
		"oauth2":   map[string]any{"enabled": false, "providers": []any{}},
		"mfa":      map[string]any{"enabled": false, "duration": 0},
		"otp":      map[string]any{"enabled": false, "duration": 0},
	})
	return nil
}

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
	if isLockedOut(ctx, m.db, key) {
		return errAccountLocked
	}
	if !checkPassword(user.PasswordHash, body.Password) || known == nil {
		m.recordLoginFailure(ctx, r, key, known, maskedIdentity(body.Identity))
		return errFailedAuth
	}
	if err := checkAccess(user); err != nil {
		return err
	}
	factors, err := listFactors(ctx, m.db, user.ID)
	if err != nil {
		return err
	}
	if len(factors) == 0 {
		return m.signIn(w, r, user, methodPassword, "")
	}
	methods, err := m.secondFactorMethods(ctx, user.ID)
	if err != nil {
		return err
	}
	mfaID, err := insertChallenge(ctx, m.db, "login", user.ID, methodPassword, nil)
	if err != nil {
		return err
	}
	m.audit(ctx, AuthEvent{Action: "login_second_factor", User: user.ID, Label: user.label(), Method: methodPassword, IP: clientIP(r)})
	httpx.JSON(w, http.StatusUnauthorized, map[string]any{"mfaId": mfaID, "methods": methods})
	return nil
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
	if err := m.signIn(w, r, user, methodRecovery, body.MFAID); err != nil {
		restoreRecoveryCode(ctx, m.db, user.ID, hash)
		return err
	}
	m.audit(ctx, AuthEvent{Action: "recovery_code_used", User: user.ID, Label: user.label(), IP: clientIP(r)})
	return nil
}

// refresh re-signs the token with the same session; a token from before sessions existed gets one.
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
	sessionID := p.SessionID
	if sessionID == "" {
		sessionID, err = insertSession(ctx, m.db, user.ID, "", r.UserAgent(), clientIP(r))
	} else {
		_, err = m.db.Exec(ctx, `UPDATE sessions SET last_seen = now(), ip = $2 WHERE id = $1`, sessionID, clientIP(r))
	}
	if err != nil {
		return err
	}
	return m.respondWithToken(w, r, user, sessionID)
}

func (m *module) logout(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	if p.SessionID != "" {
		err = pgx.BeginFunc(r.Context(), m.db, func(tx pgx.Tx) error {
			return deleteSessions(r.Context(), tx, p.UserID, `"user" = $1 AND id = $2`, p.SessionID)
		})
	}
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
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
	invalid := httpx.NewError(http.StatusBadRequest, "Failed to create record.")
	body.Email = strings.TrimSpace(body.Email)
	code, message := m.validateNewEmail(r, body.Email, "")
	taken := code == codeNotUnique
	if code != "" && !taken {
		invalid.Field("email", code, message)
	}
	if body.Username == "" {
		body.Username = m.generateUsername(r)
	} else if code, message := m.validateUsername(r, body.Username); code != "" {
		invalid.Field("username", code, message)
	}
	validatePassword(invalid, "password", body.Password, body.PasswordConfirm)
	for field, value := range map[string]string{"firstname": body.Firstname, "name": body.Name} {
		if utf8.RuneCountInString(value) > nameMax {
			invalid.Field(field, "validation_max_text_constraint", fmt.Sprintf("Must be no more than %d character(s).", nameMax))
		}
	}
	if !slices.Contains(languages, body.Language) {
		invalid.Field("language", "validation_invalid_value", "Invalid value "+body.Language+".")
	}
	if len(invalid.Data) > 0 {
		return invalid
	}
	hash, err := hashPassword(body.Password)
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
	if isUniqueViolation(err, "email") {
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

func (m *module) validateNewEmail(r *http.Request, email, exceptID string) (string, string) {
	if email == "" {
		return "validation_required", "Cannot be blank."
	}
	if address, err := mail.ParseAddress(email); err != nil || address.Address != email {
		return "validation_is_email", "Must be a valid email address."
	}
	if taken, err := emailTaken(r.Context(), m.db, email, exceptID); err != nil || taken {
		return codeNotUnique, "Value must be unique."
	}
	return "", ""
}

func (m *module) validateUsername(r *http.Request, username string) (string, string) {
	if length := utf8.RuneCountInString(username); length < 3 || length > 150 {
		return "validation_length_out_of_range", "The length must be between 3 and 150."
	}
	if !usernamePattern.MatchString(username) {
		return "validation_invalid_format", "Invalid value format."
	}
	if taken, err := usernameTaken(r.Context(), m.db, username); err != nil || taken {
		return "validation_not_unique", "Value must be unique."
	}
	return "", ""
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
	} else if length := utf8.RuneCountInString(password); length < passwordMin || length > passwordMax {
		invalid.Field(field, "validation_length_out_of_range", fmt.Sprintf("The length must be between %d and %d.", passwordMin, passwordMax))
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
	if _, signedIn := auth.From(ctx); !signedIn {
		if err := captcha.Request(ctx, m.db, r, "password-reset"); err != nil {
			return err
		}
	}
	if user, err := findAccountByEmail(ctx, m.db, strings.TrimSpace(body.Email)); err == nil {
		if token, err := m.signMailToken(user, "passwordReset", "", passwordResetTokenTTL); err == nil {
			m.sendAuthMail(ctx, user, user.Email, platformmail.PasswordReset(user.Firstname, token))
		}
		m.audit(ctx, AuthEvent{Action: "password_reset_request", User: user.ID, Label: user.label(), IP: clientIP(r)})
	} else if !isNoRows(err) {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func invalidToken() *httpx.Error {
	return httpx.NewError(http.StatusBadRequest, "Invalid or expired token.").Field("token", "validation_invalid_token", "Invalid or expired token.")
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
	invalid := httpx.NewError(http.StatusBadRequest, "Failed to validate.")
	validatePassword(invalid, "password", body.Password, body.PasswordConfirm)
	if len(invalid.Data) > 0 {
		return invalid
	}
	ctx := r.Context()
	user, _, ok := m.parseMailToken(ctx, m.db, body.Token, "passwordReset")
	if !ok {
		return invalidToken()
	}
	hash, err := hashPassword(body.Password)
	if err != nil {
		return err
	}
	err = pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE users SET password_hash = $2, verified = true WHERE id = $1`, user.ID, hash); err != nil {
			return err
		}
		if err := rotateTokenKey(ctx, tx, user.ID); err != nil {
			return err
		}
		if err := clearLoginFailures(ctx, tx, user.ID); err != nil {
			return err
		}
		return publishAuthEvent(ctx, tx, AuthEvent{Action: "password_reset", User: user.ID, Label: user.label(), IP: clientIP(r)})
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
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
	w.WriteHeader(http.StatusNoContent)
	return nil
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
	if _, err := m.db.Exec(r.Context(), `UPDATE users SET verified = true WHERE id = $1 AND NOT verified`, user.ID); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
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
	newEmail := strings.TrimSpace(body.NewEmail)
	if code, message := m.validateNewEmail(r, newEmail, ""); code == codeNotUnique {
		if !strings.EqualFold(newEmail, user.Email) {
			m.notifyAccountExists(ctx, newEmail)
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	} else if code != "" {
		return httpx.NewError(http.StatusBadRequest, "Failed to validate.").Field("newEmail", code, message)
	}
	token, err := m.signMailToken(user, "emailChange", newEmail, emailChangeTokenTTL)
	if err != nil {
		return err
	}
	m.sendAuthMail(ctx, user, newEmail, platformmail.EmailChange(user.Firstname, token))
	m.audit(ctx, AuthEvent{Action: "email_change_request", User: user.ID, Label: user.label(), IP: clientIP(r)})
	w.WriteHeader(http.StatusNoContent)
	return nil
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
	if !checkPassword(user.PasswordHash, body.Password) {
		return httpx.NewError(http.StatusBadRequest, "Failed to validate.").Field("password", "validation_invalid_password", "Missing or invalid auth record password.")
	}
	if code, message := m.validateNewEmail(r, claims.NewEmail, user.ID); code != "" {
		return httpx.NewError(http.StatusBadRequest, "Failed to validate.").Field("newEmail", code, message)
	}
	err := pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE users SET email = $2, verified = true WHERE id = $1`, user.ID, claims.NewEmail); err != nil {
			return err
		}
		if err := rotateTokenKey(ctx, tx, user.ID); err != nil {
			return err
		}
		return publishAuthEvent(ctx, tx, AuthEvent{Action: "email_change", User: user.ID, Label: claims.NewEmail, IP: clientIP(r)})
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// changePassword ends every session (like PocketBase's tokenKey refresh) and answers with a fresh login for this device.
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
	invalid := httpx.NewError(http.StatusBadRequest, "Failed to validate.")
	if !checkPassword(user.PasswordHash, body.OldPassword) {
		invalid.Field("oldPassword", "validation_invalid_old_password", "Missing or invalid old password.")
	}
	validatePassword(invalid, "password", body.Password, body.PasswordConfirm)
	if len(invalid.Data) > 0 {
		return invalid
	}
	hash, err := hashPassword(body.Password)
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
		if sessionID, err = insertSession(ctx, tx, user.ID, methodPassword, r.UserAgent(), clientIP(r)); err != nil {
			return err
		}
		return publishAuthEvent(ctx, tx, AuthEvent{Action: "password_change", User: user.ID, Label: user.label(), IP: clientIP(r)})
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
	if isLockedOut(ctx, m.db, user.ID) {
		return account{}, errAccountLocked
	}
	if !checkPassword(user.PasswordHash, body.Password) {
		m.recordLoginFailure(ctx, r, user.ID, &user, "")
		return account{}, httpx.NewError(http.StatusBadRequest, "Invalid password.").Field("password", "invalid_password", "Invalid password.")
	}
	return user, nil
}

func (m *module) listMFAFactors(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	factors, err := listFactors(r.Context(), m.db, p.UserID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"factors": factors, "recoveryCodesLeft": recoveryCodesLeft(r.Context(), m.db, p.UserID)})
	return nil
}

func (m *module) renameMFAFactor(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	f, err := scanFactor(m.db.QueryRow(r.Context(), `UPDATE mfa_factors SET name = $3 WHERE id = $1 AND "user" = $2 RETURNING `+factorColumns,
		r.PathValue("id"), p.UserID, truncateRunes(strings.TrimSpace(body.Name), 60)))
	if isNoRows(err) {
		return httpx.ErrNotFound
	}
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, f)
	return nil
}

func (m *module) deleteMFAFactor(w http.ResponseWriter, r *http.Request) error {
	user, err := m.requirePassword(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	f, err := findOwnFactor(ctx, m.db, user.ID, r.PathValue("id"))
	if isNoRows(err) {
		return httpx.ErrNotFound
	}
	if err != nil {
		return err
	}
	action := "mfa_disabled"
	if f.Kind == methodPasskey {
		action = "passkey_removed"
	}
	err = pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM mfa_factors WHERE id = $1`, f.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM mfa_recovery_codes WHERE "user" = $1 AND NOT EXISTS (SELECT 1 FROM mfa_factors WHERE "user" = $1)`, user.ID); err != nil {
			return err
		}
		return publishAuthEvent(ctx, tx, AuthEvent{Action: action, User: user.ID, Label: user.label(), IP: clientIP(r)})
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (m *module) totpSetup(w http.ResponseWriter, r *http.Request) error {
	user, err := m.requirePassword(r)
	if err != nil {
		return err
	}
	secret := newTOTPSecret()
	httpx.JSON(w, http.StatusOK, map[string]string{"secret": secret, "uri": totpURI(m.appName, firstNonEmpty(user.Email, user.Username), secret)})
	return nil
}

func (m *module) totpEnable(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	var body struct {
		Password string `json:"password"`
		Secret   string `json:"secret"`
		Code     string `json:"code"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	ctx := r.Context()
	user, err := findAccount(ctx, m.db, p.UserID)
	if err != nil {
		return err
	}
	if isLockedOut(ctx, m.db, user.ID) {
		return errAccountLocked
	}
	if !checkPassword(user.PasswordHash, body.Password) {
		m.recordLoginFailure(ctx, r, user.ID, &user, "")
		return httpx.NewError(http.StatusBadRequest, "Invalid password.").Field("password", "invalid_password", "Invalid password.")
	}
	key, err := decodeTOTPSecret(body.Secret)
	if err != nil {
		return httpx.NewError(http.StatusBadRequest, "Invalid secret.")
	}
	step := matchTOTP(key, body.Code, time.Now(), 0)
	if step == 0 {
		return httpx.NewError(http.StatusBadRequest, "Invalid code.").Field("code", "invalid_code", "Invalid code.")
	}
	factors, err := listFactors(ctx, m.db, user.ID)
	if err != nil {
		return err
	}
	if slices.ContainsFunc(factors, func(f factor) bool { return f.Kind == methodTOTP }) {
		return httpx.NewError(http.StatusBadRequest, "An authenticator app is already set up.")
	}
	return m.saveFactor(w, r, user, factor{Kind: methodTOTP, Secret: totpEncoding.EncodeToString(key), LastStep: step}, "mfa_enabled")
}

// saveFactor stores a new factor and hands out recovery codes with the first one (or when none are left).
func (m *module) saveFactor(w http.ResponseWriter, r *http.Request, user account, f factor, action string) error {
	ctx := r.Context()
	result := map[string]any{}
	err := pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		var existing int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM mfa_factors WHERE "user" = $1`, user.ID).Scan(&existing); err != nil {
			return err
		}
		saved, err := insertFactor(ctx, tx, user.ID, f)
		if err != nil {
			return err
		}
		result["factor"] = saved
		if existing == 0 || recoveryCodesLeft(ctx, tx, user.ID) == 0 {
			codes, err := issueRecoveryCodes(ctx, tx, user.ID)
			if err != nil {
				return err
			}
			result["recoveryCodes"] = codes
		}
		return publishAuthEvent(ctx, tx, AuthEvent{Action: action, User: user.ID, Label: user.label(), IP: clientIP(r)})
	})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, result)
	return nil
}

func (m *module) regenerateRecoveryCodes(w http.ResponseWriter, r *http.Request) error {
	user, err := m.requirePassword(r)
	if err != nil {
		return err
	}
	factors, err := listFactors(r.Context(), m.db, user.ID)
	if err != nil {
		return err
	}
	if len(factors) == 0 {
		return httpx.NewError(http.StatusBadRequest, "Two-factor authentication is not set up.")
	}
	codes, err := issueRecoveryCodes(r.Context(), m.db, user.ID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"recoveryCodes": codes})
	return nil
}

func issueRecoveryCodes(ctx context.Context, q querier, userID string) ([]string, error) {
	codes := make([]string, recoveryCodeCount)
	hashes := make([]string, recoveryCodeCount)
	for i := range codes {
		raw := make([]byte, 10)
		rand.Read(raw)
		code := strings.ToLower(totpEncoding.EncodeToString(raw))
		codes[i] = code[:4] + "-" + code[4:8] + "-" + code[8:12] + "-" + code[12:]
		hashes[i] = hashRecoveryCode(codes[i])
	}
	return codes, storeRecoveryCodes(ctx, q, userID, hashes)
}

func hashRecoveryCode(code string) string {
	normalized := strings.ToLower(strings.NewReplacer("-", "", " ", "").Replace(code))
	digest := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(digest[:])
}

func (m *module) listSessions(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	items, err := listSessions(r.Context(), m.db, p.UserID, p.SessionID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	return nil
}

func (m *module) revokeSession(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	ctx := r.Context()
	var found bool
	err = pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM sessions WHERE id = $1 AND "user" = $2)`, r.PathValue("id"), p.UserID).Scan(&found); err != nil || !found {
			return err
		}
		return deleteSessions(ctx, tx, p.UserID, `"user" = $1 AND id = $2`, r.PathValue("id"))
	})
	if err != nil {
		return err
	}
	if !found {
		return httpx.ErrNotFound
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (m *module) signOutOtherSessions(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	ctx := r.Context()
	err = pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		if err := deleteSessions(ctx, tx, p.UserID, `"user" = $1 AND id <> $2`, p.SessionID); err != nil {
			return err
		}
		return publishAuthEvent(ctx, tx, AuthEvent{Action: "sessions_revoked", User: p.UserID, IP: clientIP(r)})
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
