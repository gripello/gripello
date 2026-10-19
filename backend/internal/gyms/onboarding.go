package gyms

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	gmail "gripello/internal/platform/mail"
)

const (
	onboardingLifetime = 14 * 24 * time.Hour
	trialLength        = 30 * 24 * time.Hour
	trialReminderLead  = 7 * 24 * time.Hour
	trialNoticeEnding  = 1
	trialNoticeEnded   = 2
)

const invalidOnboarding = "This link is invalid or has expired."

func newToken() string {
	b := make([]byte, 30)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (m *module) createOnboarding(w http.ResponseWriter, r *http.Request) error {
	if _, err := requirePlatformAdmin(r.Context()); err != nil {
		return err
	}
	var body struct {
		Email string `json:"email"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	if address, err := mail.ParseAddress(email); err != nil || address.Address != email {
		return httpx.NewError(http.StatusBadRequest, "Must be a valid email address.").Field("email", "validation_is_email", "Must be a valid email address.")
	}
	token := newToken()
	_, err := m.db.Exec(r.Context(), `INSERT INTO gym_onboardings (id, email, token_hash, expires_at) VALUES ($1, $2, $3, $4)
		ON CONFLICT (email) DO UPDATE SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at, created = now()`,
		ids.New(), email, hashToken(token), time.Now().Add(onboardingLifetime))
	if err != nil {
		return err
	}
	if m.app.MailTemplates != nil {
		content := gmail.Content{Key: "gymOnboarding", Action: "/auth/gym/" + token}
		if _, err := m.app.MailTemplates.Send(r.Context(), m.app.Mail, m.app.MailTemplates.AppBrand(), content, []gmail.Recipient{{Address: email}}); err != nil {
			slog.Error("gyms: onboarding mail failed", "error", err)
		}
	}
	w.WriteHeader(http.StatusAccepted)
	return nil
}

func (m *module) listOnboardings(w http.ResponseWriter, r *http.Request) error {
	if _, err := requirePlatformAdmin(r.Context()); err != nil {
		return err
	}
	var items json.RawMessage
	err := m.db.QueryRow(r.Context(), `SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'email', email, 'created', created, 'expires_at', expires_at)
		ORDER BY created DESC), '[]') FROM gym_onboardings WHERE expires_at > now()`).Scan(&items)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	return nil
}

func (m *module) deleteOnboarding(w http.ResponseWriter, r *http.Request) error {
	if _, err := requirePlatformAdmin(r.Context()); err != nil {
		return err
	}
	if _, err := m.db.Exec(r.Context(), `DELETE FROM gym_onboardings WHERE id = $1`, r.PathValue("id")); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (m *module) showOnboarding(w http.ResponseWriter, r *http.Request) error {
	var email string
	err := m.db.QueryRow(r.Context(), `SELECT email FROM gym_onboardings WHERE token_hash = $1 AND expires_at > now()`,
		hashToken(r.PathValue("token"))).Scan(&email)
	if err != nil {
		return httpx.NewError(http.StatusNotFound, invalidOnboarding)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"email": email})
	return nil
}

// redeemOnboarding creates the trial gym and hands back an admin invite, so /auth/invite does sign-in or sign-up.
func (m *module) redeemOnboarding(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	tokenHash := hashToken(r.PathValue("token"))
	var onboardingID, email string
	err := m.db.QueryRow(ctx, `SELECT id, email FROM gym_onboardings WHERE token_hash = $1 AND expires_at > now()`, tokenHash).Scan(&onboardingID, &email)
	if err != nil {
		return httpx.NewError(http.StatusNotFound, invalidOnboarding)
	}
	var raw map[string]json.RawMessage
	if err := httpx.Decode(r, &raw); err != nil {
		return err
	}
	body := map[string]json.RawMessage{"name": raw["name"], "slug": raw["slug"]}
	for field, value := range body {
		if value == nil {
			delete(body, field)
		}
	}
	changes, err := validateFields(body, gymFields, true)
	if err != nil {
		return err
	}
	changes["active"] = true
	changes["trial_ends_at"] = time.Now().Add(trialLength)
	invite := newToken()
	gymID := ids.New()
	_, err = m.saveGym(ctx, "", gymID, nil, changes, nil, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM gym_onboardings WHERE id = $1 AND token_hash = $2 AND expires_at > now()`, onboardingID, tokenHash)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.NewError(http.StatusNotFound, invalidOnboarding)
		}
		_, err = tx.Exec(ctx, `INSERT INTO invites (id, gym, role, email, token_hash, expires_at)
			SELECT $1, $2, id, $3, $4, $5 FROM roles WHERE gym = $2 AND name = 'admin'`,
			ids.New(), gymID, email, hashToken(invite), changes["trial_ends_at"])
		return err
	})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"gym": changes["slug"], "invite": invite})
	return nil
}

func pruneOnboardings(ctx context.Context, q queryer) error {
	_, err := q.Exec(ctx, `DELETE FROM gym_onboardings WHERE expires_at < now()`)
	return err
}

// remindTrials mails each trial gym's admins once a week before the end and once when it ended; the end also reaches open clients.
func (m *module) remindTrials(ctx context.Context) error {
	rows, err := m.db.Query(ctx, `SELECT id, name, trial_ends_at, trial_notice FROM gyms WHERE trial_ends_at IS NOT NULL
		AND ((trial_notice < $1 AND trial_ends_at < now() + $3::interval) OR (trial_notice < $2 AND trial_ends_at < now()))`,
		trialNoticeEnding, trialNoticeEnded, trialReminderLead.String())
	if err != nil {
		return err
	}
	type trial struct {
		id, name string
		endsAt   time.Time
		notice   int
	}
	trials, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (trial, error) {
		var t trial
		return t, row.Scan(&t.id, &t.name, &t.endsAt, &t.notice)
	})
	if err != nil {
		return err
	}
	for _, t := range trials {
		notice, key := trialNoticeEnding, "gymTrialEnding"
		if t.endsAt.Before(time.Now()) {
			notice, key = trialNoticeEnded, "gymTrialEnded"
		}
		recipients, err := gymAdmins(ctx, m.db, t.id)
		if err != nil {
			return err
		}
		if len(recipients) > 0 && m.app.MailTemplates != nil {
			content := gmail.Content{Key: key, Params: map[string]any{"gym": t.name, "date": t.endsAt.UTC().Format("2006-01-02")}}
			if _, err := m.app.MailTemplates.Send(ctx, m.app.Mail, m.app.MailTemplates.AppBrand(), content, recipients); err != nil {
				slog.Error("gyms: trial reminder failed", "gym", t.id, "error", err)
				continue
			}
		}
		err = pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `UPDATE gyms SET trial_notice = $2 WHERE id = $1`, t.id, notice); err != nil {
				return err
			}
			if notice != trialNoticeEnded {
				return nil
			}
			return publishTrial(ctx, tx, "", t.id, t.endsAt)
		})
		if err != nil {
			return err
		}
	}
	return nil
}

func gymAdmins(ctx context.Context, db *pgxpool.Pool, gymID string) ([]gmail.Recipient, error) {
	rows, err := db.Query(ctx, `SELECT u.email, u.language FROM memberships m JOIN roles r ON r.id = m.role JOIN users u ON u.id = m."user"
		WHERE m.gym = $1 AND r.name = 'admin' AND u.email <> ''`, gymID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (gmail.Recipient, error) {
		var r gmail.Recipient
		return r, row.Scan(&r.Address, &r.Language)
	})
}
