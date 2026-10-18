package authn

import (
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/secretbox"
)

// authMethods lists the sign-in methods; OTP is not offered, second factors are per account.
func (m *module) authMethods(w http.ResponseWriter, r *http.Request) error {
	rows, err := m.db.Query(r.Context(), `SELECT provider, display_name FROM oauth2_providers WHERE enabled AND client_id <> '' ORDER BY provider`)
	if err != nil {
		return err
	}
	type provider struct {
		Name        string `json:"name"`
		DisplayName string `json:"displayName"`
	}
	providers, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (provider, error) {
		var p provider
		return p, row.Scan(&p.Name, &p.DisplayName)
	})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"password": map[string]any{"enabled": true, "identityFields": []string{"email", "username"}},
		"oauth2":   map[string]any{"enabled": len(providers) > 0, "providers": providers},
		"mfa":      map[string]any{"enabled": false, "duration": 0},
		"otp":      map[string]any{"enabled": false, "duration": 0},
	})
	return nil
}

type identity struct {
	ID       string    `json:"id"`
	Provider string    `json:"provider"`
	Email    string    `json:"email"`
	Created  time.Time `json:"created"`
}

func (m *module) listIdentities(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	rows, err := m.db.Query(r.Context(), `SELECT id, provider, email, created FROM user_identities WHERE "user" = $1 ORDER BY created`, p.UserID)
	if err != nil {
		return err
	}
	items, err := pgx.CollectRows(rows, pgx.RowToStructByPos[identity])
	if err != nil {
		return err
	}
	user, err := findAccount(r.Context(), m.db, p.UserID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items, "hasPassword": user.PasswordHash != ""})
	return nil
}

// unlinkIdentity refuses to remove the last way into the account.
func (m *module) unlinkIdentity(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	p, err := auth.Require(ctx)
	if err != nil {
		return err
	}
	err = pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		var others int
		var hasPassword bool
		err := tx.QueryRow(ctx, `SELECT u.password_hash <> '',
			(SELECT count(*) FROM user_identities i WHERE i."user" = u.id AND i.id <> $2) + (SELECT count(*) FROM mfa_factors f WHERE f."user" = u.id AND f.kind = 'passkey')
			FROM users u WHERE u.id = $1 FOR UPDATE`, p.UserID, r.PathValue("id")).Scan(&hasPassword, &others)
		if err != nil {
			return err
		}
		if !hasPassword && others == 0 {
			return httpx.NewError(http.StatusConflict, "This is the only way into your account. Set a password first.")
		}
		tag, err := tx.Exec(ctx, `DELETE FROM user_identities WHERE id = $1 AND "user" = $2`, r.PathValue("id"), p.UserID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.ErrNotFound
		}
		return nil
	})
	if err != nil {
		return err
	}
	m.announceAccount(ctx, p.UserID, "identities")
	w.WriteHeader(http.StatusNoContent)
	return nil
}

type providerSettings struct {
	Provider        string `json:"provider"`
	Enabled         bool   `json:"enabled"`
	ClientID        string `json:"client_id"`
	ClientSecretSet bool   `json:"client_secret_set"`
	DisplayName     string `json:"display_name"`
	IssuerURL       string `json:"issuer_url"`
	Tenant          string `json:"tenant"`
	TeamID          string `json:"team_id"`
	KeyID           string `json:"key_id"`
	PrivateKeySet   bool   `json:"private_key_set"`
	RedirectURI     string `json:"redirect_uri"`
}

func (m *module) requirePlatformAdmin(r *http.Request, reauth bool) (auth.Principal, error) {
	p, err := auth.Require(r.Context())
	if err != nil {
		return p, err
	}
	if !p.PlatformAdmin {
		return p, httpx.ErrForbidden
	}
	if reauth {
		return p, auth.RequireRecentReauth(r.Context(), m.db, p)
	}
	return p, nil
}

// listProviderSettings returns every provider, configured or not, without secrets.
func (m *module) listProviderSettings(w http.ResponseWriter, r *http.Request) error {
	if _, err := m.requirePlatformAdmin(r, false); err != nil {
		return err
	}
	items := make([]providerSettings, 0, len(oauth2Providers))
	for _, name := range oauth2Providers {
		c, err := loadProvider(r.Context(), m.db, m.tokens.Secret, name)
		if err != nil && !isNoRows(err) {
			return err
		}
		items = append(items, providerSettings{Provider: name, Enabled: c.Enabled, ClientID: c.ClientID, ClientSecretSet: c.ClientSecret != "",
			DisplayName: c.DisplayName, IssuerURL: c.IssuerURL, Tenant: c.Tenant, TeamID: c.TeamID, KeyID: c.KeyID, PrivateKeySet: c.PrivateKey != "",
			RedirectURI: m.appURL + "/api/auth/oauth2/" + name + "/callback"})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	return nil
}

// saveProviderSettings upserts one provider; client_secret and private_key left out keep the stored values.
func (m *module) saveProviderSettings(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Enabled      bool    `json:"enabled"`
		ClientID     string  `json:"client_id"`
		ClientSecret *string `json:"client_secret"`
		DisplayName  string  `json:"display_name"`
		IssuerURL    string  `json:"issuer_url"`
		Tenant       string  `json:"tenant"`
		TeamID       string  `json:"team_id"`
		KeyID        string  `json:"key_id"`
		PrivateKey   *string `json:"private_key"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	provider := r.PathValue("provider")
	if !slices.Contains(oauth2Providers, provider) {
		return httpx.ErrNotFound
	}
	p, err := m.requirePlatformAdmin(r, true)
	if err != nil {
		return err
	}
	invalid := httpx.NewError(http.StatusBadRequest, "Failed to validate.")
	body.ClientID, body.IssuerURL = strings.TrimSpace(body.ClientID), strings.TrimSpace(body.IssuerURL)
	if body.Enabled && body.ClientID == "" {
		invalid.Field("client_id", "validation_required", "Cannot be blank.")
	}
	if provider == "oidc" && body.Enabled {
		if parsed, err := url.Parse(body.IssuerURL); err != nil || parsed.Scheme != "https" || parsed.Host == "" {
			invalid.Field("issuer_url", "validation_invalid_url", "Must be an https URL.")
		}
		if strings.TrimSpace(body.DisplayName) == "" {
			invalid.Field("display_name", "validation_required", "Cannot be blank.")
		}
	}
	if len(invalid.Data) > 0 {
		return invalid
	}
	ctx := r.Context()
	err = pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO oauth2_providers (provider) VALUES ($1) ON CONFLICT DO NOTHING`, provider); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE oauth2_providers SET enabled = $2, client_id = $3, display_name = $4, issuer_url = $5, tenant = $6,
			team_id = $7, key_id = $8, updated = now() WHERE provider = $1`, provider, body.Enabled, body.ClientID, strings.TrimSpace(body.DisplayName),
			body.IssuerURL, strings.TrimSpace(body.Tenant), strings.TrimSpace(body.TeamID), strings.TrimSpace(body.KeyID)); err != nil {
			return err
		}
		for column, value := range map[string]*string{"client_secret": body.ClientSecret, "private_key": body.PrivateKey} {
			if value == nil {
				continue
			}
			sealed, err := secretbox.Seal(m.tokens.Secret, strings.TrimSpace(*value))
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE oauth2_providers SET `+column+` = $2 WHERE provider = $1`, provider, sealed); err != nil {
				return err
			}
		}
		return events.PublishAs(ctx, tx, p.UserID, "platform", "oauth2_provider.updated", map[string]any{"id": provider}, events.Audience{PlatformAdmins: true})
	})
	if err != nil {
		return err
	}
	return m.listProviderSettings(w, r)
}
