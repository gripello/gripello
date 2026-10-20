package authn

import (
	"context"
	"crypto/rand"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/db"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
)

func (m *module) listMFAFactors(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	factors, err := listFactors(r.Context(), m.db, p.UserID)
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, map[string]any{"factors": factors, "recoveryCodesLeft": recoveryCodesLeft(r.Context(), m.db, p.UserID)}, nil)
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
		r.PathValue("id"), p.UserID, httpx.Truncate(strings.TrimSpace(body.Name), 60)))
	if isNoRows(err) {
		return httpx.ErrNotFound
	}
	if err != nil {
		return err
	}
	m.announceAccount(r.Context(), p.UserID, "mfa")
	return httpx.Respond(w, http.StatusOK, f, nil)
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
		return publishAuthEvent(ctx, tx, AuthEvent{Action: action, User: user.ID, Label: user.label(), IP: httpx.ClientIP(r)})
	})
	if err != nil {
		return err
	}
	m.announceAccount(ctx, user.ID, "mfa")
	return httpx.NoContent(w, nil)
}

func (m *module) totpSetup(w http.ResponseWriter, r *http.Request) error {
	user, err := m.requirePassword(r)
	if err != nil {
		return err
	}
	secret := newTOTPSecret()
	return httpx.Respond(w, http.StatusOK, map[string]string{"secret": secret, "uri": totpURI(m.appName, firstNonEmpty(user.Email, user.Username), secret)}, nil)
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
	if err := m.confirmPassword(r, user, "password", body.Password, "invalid_password"); err != nil {
		return err
	}
	key, err := decodeTOTPSecret(body.Secret)
	if err != nil {
		return httpx.BadRequest("Invalid secret.")
	}
	step := matchTOTP(key, body.Code, time.Now(), 0)
	if step == 0 {
		return httpx.BadRequest("Invalid code.").Field("code", "invalid_code", "Invalid code.")
	}
	factors, err := listFactors(ctx, m.db, user.ID)
	if err != nil {
		return err
	}
	if slices.ContainsFunc(factors, func(f factor) bool { return f.Kind == methodTOTP }) {
		return httpx.BadRequest("An authenticator app is already set up.")
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
		return publishAuthEvent(ctx, tx, AuthEvent{Action: action, User: user.ID, Label: user.label(), IP: httpx.ClientIP(r)})
	})
	if err != nil {
		return err
	}
	m.announceAccount(ctx, user.ID, "mfa")
	return httpx.Respond(w, http.StatusOK, result, nil)
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
		return httpx.BadRequest("Two-factor authentication is not set up.")
	}
	codes, err := issueRecoveryCodes(r.Context(), m.db, user.ID)
	if err != nil {
		return err
	}
	m.announceAccount(r.Context(), user.ID, "mfa")
	return httpx.Respond(w, http.StatusOK, map[string]any{"recoveryCodes": codes}, nil)
}

func issueRecoveryCodes(ctx context.Context, q db.Querier, userID string) ([]string, error) {
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
	return ids.Hash(strings.ToLower(strings.NewReplacer("-", "", " ", "").Replace(code)))
}
