package authn

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/captcha"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/lockout"
	"gripello/internal/platform/mail"
	"gripello/internal/platform/ratelimit"
)

type module struct {
	db           *pgxpool.Pool
	tokens       auth.Issuer
	mail         platform.Mailer
	templates    *mail.Templates
	appURL       string
	appName      string
	rp           func() (*webauthn.WebAuthn, error)
	httpClient   *http.Client
	blob         platform.BlobStore
	emailChanges *ratelimit.Limiter
}

const emailChangeRequestsPerHour = 3

func Register(app *platform.App) {
	m := &module{db: app.DB, tokens: app.Tokens, mail: app.Mail, templates: app.MailTemplates, blob: app.Blob,
		appURL: strings.TrimRight(app.Cfg.AppURL, "/"), appName: app.Cfg.AppName}
	m.rp = sync.OnceValues(m.newRelyingParty)
	m.emailChanges = ratelimit.New(emailChangeRequestsPerHour, time.Hour)
	m.httpClient = &http.Client{Timeout: 15 * time.Second}

	app.Handle("GET /auth/methods", httpx.Handler(m.authMethods))
	app.Handle("POST /auth/login", httpx.Handler(m.login))
	app.Handle("POST /auth/totp", httpx.Handler(m.loginWithTOTP))
	app.Handle("POST /auth/recovery", httpx.Handler(m.loginWithRecoveryCode))
	app.Handle("POST /auth/passkey/options", httpx.Handler(m.passkeyLoginOptions))
	app.Handle("POST /auth/passkey", httpx.Handler(m.passkeyLogin))
	app.Handle("POST /auth/oauth2/{provider}/start", httpx.Handler(m.oauth2Start))
	app.Handle("GET /auth/oauth2/{provider}/callback", httpx.Handler(m.oauth2Callback))
	app.Handle("POST /auth/oauth2/{provider}/callback", httpx.Handler(m.oauth2Callback))
	app.Handle("POST /auth/oauth2/finish", httpx.Handler(m.oauth2Finish))
	app.Handle("POST /auth/oauth2/link", httpx.Handler(m.oauth2FinishLink))
	app.Handle("GET /me/identities", httpx.Handler(m.listIdentities))
	app.Handle("DELETE /me/identities/{id}", httpx.Handler(m.unlinkIdentity))
	app.Handle("GET /platform/oauth2", httpx.Handler(m.listProviderSettings))
	app.Handle("PUT /platform/oauth2/{provider}", httpx.Handler(m.saveProviderSettings))
	app.Handle("POST /auth/refresh", httpx.Handler(m.refresh))
	app.Handle("POST /auth/logout", httpx.Handler(m.logout))
	app.Handle("POST /auth/register", httpx.Handler(m.register))
	app.Handle("POST /auth/password-reset/request", httpx.Handler(m.requestPasswordReset))
	app.Handle("POST /auth/password-reset/confirm", httpx.Handler(m.confirmPasswordReset))
	app.Handle("POST /auth/verification/request", httpx.Handler(m.requestVerification))
	app.Handle("POST /auth/verification/confirm", httpx.Handler(m.confirmVerification))
	app.Handle("POST /auth/email-change/request", httpx.Handler(m.requestEmailChange))
	app.Handle("POST /auth/email-change/confirm", httpx.Handler(m.confirmEmailChange))

	app.Handle("POST /me/password", httpx.Handler(m.changePassword))
	app.Handle("POST /me/reauthenticate", httpx.Handler(m.reauthenticate))
	app.Handle("DELETE /platform/users/{id}/mfa", httpx.Handler(m.adminResetMFA))
	app.Handle("GET /platform/users/{id}/sessions", httpx.Handler(m.adminListSessions))
	app.Handle("DELETE /platform/users/{id}/sessions", httpx.Handler(m.adminRevokeSessions))
	app.Handle("DELETE /platform/users/{id}/lockout", httpx.Handler(m.adminClearLockout))
	app.Handle("POST /platform/users/{id}/password", httpx.Handler(m.adminSetPassword))
	app.Handle("GET /me/mfa", httpx.Handler(m.listMFAFactors))
	app.Handle("PATCH /me/mfa/{id}", httpx.Handler(m.renameMFAFactor))
	app.Handle("DELETE /me/mfa/{id}", httpx.Handler(m.deleteMFAFactor))
	app.Handle("POST /me/totp/setup", httpx.Handler(m.totpSetup))
	app.Handle("POST /me/totp", httpx.Handler(m.totpEnable))
	app.Handle("POST /me/recovery-codes", httpx.Handler(m.regenerateRecoveryCodes))
	app.Handle("POST /me/passkeys/options", httpx.Handler(m.passkeyRegistrationOptions))
	app.Handle("POST /me/passkeys", httpx.Handler(m.passkeyRegister))
	app.Handle("GET /me/sessions", httpx.Handler(m.listSessions))
	app.Handle("DELETE /me/sessions/{id}", httpx.Handler(m.revokeSession))
	app.Handle("POST /me/sessions/sign-out-others", httpx.Handler(m.signOutOtherSessions))

	app.Cron.Add("loginLockoutCleanup", "41 * * * *", func(ctx context.Context) error { return lockout.Prune(ctx, m.db) })
	app.Cron.Add("sessionCleanup", "23 4 * * *", m.pruneSessions)
	app.Cron.Add("capNoncePrune", "41 * * * *", func(ctx context.Context) error { return captcha.PruneNonces(ctx, m.db) })
	app.Cron.Add("mfaChallengePrune", "*/10 * * * *", m.pruneChallenges)
	app.Cron.Add("unverifiedAccountCleanup", "53 3 * * *", m.pruneUnverifiedAccounts)
}

// A session not refreshed within the token lifetime can't hold a valid token anymore.
func (m *module) pruneSessions(ctx context.Context) error {
	_, err := m.db.Exec(ctx, `DELETE FROM sessions WHERE last_seen < now() - $1::interval`, m.tokens.Duration.String())
	return err
}

// emptySignupSQL (alias u) matches a sign-up that was never verified, never signed in and holds no data: the only accounts a retry may claim or the prune may delete.
const emptySignupSQL = `NOT u.verified AND u.verified_at IS NULL AND NOT u.platform_admin
	AND NOT EXISTS (SELECT 1 FROM sessions WHERE "user" = u.id) AND NOT EXISTS (SELECT 1 FROM user_identities WHERE "user" = u.id)
	AND NOT EXISTS (SELECT 1 FROM memberships WHERE "user" = u.id) AND NOT EXISTS (SELECT 1 FROM ticks WHERE "user" = u.id)
	AND NOT EXISTS (SELECT 1 FROM ratings WHERE "user" = u.id) AND NOT EXISTS (SELECT 1 FROM beta_videos WHERE "user" = u.id)
	AND NOT EXISTS (SELECT 1 FROM competition_entries WHERE "user" = u.id)
	AND NOT EXISTS (SELECT 1 FROM follows WHERE follower = u.id OR followee = u.id)`

// Sign-ups never confirmed within unverifiedAccountTTL are deleted; anything ever verified, signed in or holding data stays.
func (m *module) pruneUnverifiedAccounts(ctx context.Context) error {
	return pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `DELETE FROM users WHERE id IN (SELECT id FROM users u
			WHERE `+emptySignupSQL+` AND u.created < now() - $1::interval
			ORDER BY created LIMIT 500) RETURNING id`, unverifiedAccountTTL.String())
		if err != nil {
			return err
		}
		deleted, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		for _, id := range deleted {
			if err := events.Publish(ctx, tx, "user:"+id, "user.deleted", map[string]string{"id": id}, events.Audience{Users: []string{id}}); err != nil {
				return err
			}
		}
		return nil
	})
}

func (m *module) pruneChallenges(ctx context.Context) error {
	_, err := m.db.Exec(ctx, `DELETE FROM mfa_challenges WHERE created < now() - $1::interval`, challengeTTL.String())
	return err
}
