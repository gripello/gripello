package authn

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/climbers"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/lockout"
	"gripello/internal/platform/mail"
	pw "gripello/internal/platform/password"
)

// adminTarget loads the account a platform admin acts on; their own account and other admins are off limits.
func (m *module) adminTarget(r *http.Request, reauth bool) (auth.Principal, account, error) {
	ctx := r.Context()
	p, err := auth.RequirePlatformAdmin(ctx)
	if err != nil {
		return p, account{}, err
	}
	id := r.PathValue("id")
	if id == p.UserID {
		return p, account{}, httpx.NewError(http.StatusForbidden, "Use your account page for your own account.")
	}
	var isAdmin bool
	if err := m.db.QueryRow(ctx, `SELECT platform_admin FROM users WHERE id = $1`, id).Scan(&isAdmin); err != nil {
		if err == pgx.ErrNoRows {
			return p, account{}, httpx.ErrNotFound
		}
		return p, account{}, err
	}
	if isAdmin {
		return p, account{}, httpx.NewError(http.StatusForbidden, "Platform admins can't change another platform admin.")
	}
	if reauth {
		if err := auth.RequireRecentReauth(ctx, m.db, p); err != nil {
			return p, account{}, err
		}
	}
	user, err := findAccount(ctx, m.db, id)
	return p, user, err
}

// adminChange runs mutate and records it as a user.updated event, which the audit log lists under the user.
func (m *module) adminChange(ctx context.Context, p auth.Principal, userID, changed string, mutate func(tx pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		if err := mutate(tx); err != nil {
			return err
		}
		record, err := climbers.OwnRecord(ctx, tx, userID)
		if err != nil {
			return err
		}
		return climbers.PublishUserUpdated(ctx, tx, p.UserID, userID, record, []string{changed})
	})
}

func (m *module) adminResetMFA(w http.ResponseWriter, r *http.Request) error {
	p, user, err := m.adminTarget(r, true)
	if err != nil {
		return err
	}
	ctx := r.Context()
	err = m.adminChange(ctx, p, user.ID, "mfa", func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM mfa_factors WHERE "user" = $1`, user.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM mfa_recovery_codes WHERE "user" = $1`, user.ID); err != nil {
			return err
		}
		return rotateTokenKey(ctx, tx, user.ID)
	})
	if err != nil {
		return err
	}
	if user.Email != "" {
		m.sendAuthMail(ctx, user, user.Email, mail.Content{Key: "mfaResetByAdmin", Name: user.Firstname})
	}
	return httpx.NoContent(w, nil)
}

func (m *module) adminRevokeSessions(w http.ResponseWriter, r *http.Request) error {
	p, user, err := m.adminTarget(r, false)
	if err != nil {
		return err
	}
	ctx := r.Context()
	if err := m.adminChange(ctx, p, user.ID, "sessions", func(tx pgx.Tx) error {
		return rotateTokenKey(ctx, tx, user.ID)
	}); err != nil {
		return err
	}
	return httpx.NoContent(w, nil)
}

func (m *module) adminClearLockout(w http.ResponseWriter, r *http.Request) error {
	p, user, err := m.adminTarget(r, false)
	if err != nil {
		return err
	}
	ctx := r.Context()
	if err := m.adminChange(ctx, p, user.ID, "lockout", func(tx pgx.Tx) error {
		return lockout.Clear(ctx, tx, user.ID)
	}); err != nil {
		return err
	}
	return httpx.NoContent(w, nil)
}

func (m *module) adminSetPassword(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Password        string `json:"password"`
		PasswordConfirm string `json:"passwordConfirm"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	p, user, err := m.adminTarget(r, true)
	if err != nil {
		return err
	}
	invalid := httpx.BadRequest("Failed to validate.")
	validatePassword(invalid, "password", body.Password, body.PasswordConfirm)
	if len(invalid.Data) > 0 {
		return invalid
	}
	hash, err := pw.Hash(body.Password)
	if err != nil {
		return err
	}
	ctx := r.Context()
	err = m.adminChange(ctx, p, user.ID, "password", func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE users SET password_hash = $2 WHERE id = $1`, user.ID, hash); err != nil {
			return err
		}
		if err := lockout.Clear(ctx, tx, user.ID); err != nil {
			return err
		}
		return rotateTokenKey(ctx, tx, user.ID)
	})
	if err != nil {
		return err
	}
	if user.Email != "" {
		m.sendAuthMail(ctx, user, user.Email, mail.Content{Key: "passwordSetByAdmin", Name: user.Firstname})
	}
	return httpx.NoContent(w, nil)
}
