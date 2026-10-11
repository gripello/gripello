package authn

import (
	"context"
	"strings"
	"sync"

	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/captcha"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/mail"
)

type module struct {
	db        *pgxpool.Pool
	tokens    auth.Issuer
	mail      platform.Mailer
	templates *mail.Templates
	appURL    string
	appName   string
	rp        func() (*webauthn.WebAuthn, error)
}

func Register(app *platform.App) {
	m := &module{db: app.DB, tokens: app.Tokens, mail: app.Mail, templates: app.MailTemplates,
		appURL: strings.TrimRight(app.Cfg.AppURL, "/"), appName: app.Cfg.AppName}
	m.rp = sync.OnceValues(m.newRelyingParty)

	app.Handle("GET /auth/methods", httpx.Handler(authMethods))
	app.Handle("POST /auth/login", httpx.Handler(m.login))
	app.Handle("POST /auth/totp", httpx.Handler(m.loginWithTOTP))
	app.Handle("POST /auth/recovery", httpx.Handler(m.loginWithRecoveryCode))
	app.Handle("POST /auth/passkey/options", httpx.Handler(m.passkeyLoginOptions))
	app.Handle("POST /auth/passkey", httpx.Handler(m.passkeyLogin))
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

	app.Cron.Add("loginLockoutCleanup", "41 * * * *", m.pruneLockouts)
	app.Cron.Add("sessionCleanup", "23 4 * * *", m.pruneSessions)
	app.Cron.Add("capNoncePrune", "41 * * * *", func(ctx context.Context) error { return captcha.PruneNonces(ctx, m.db) })
	app.Cron.Add("mfaChallengePrune", "*/10 * * * *", m.pruneChallenges)
}

func (m *module) pruneLockouts(ctx context.Context) error {
	_, err := m.db.Exec(ctx, `DELETE FROM login_lockouts WHERE window_start < now() - $1::interval AND (locked_until IS NULL OR locked_until < now())`, lockoutWindow.String())
	return err
}

// A session not refreshed within the token lifetime can't hold a valid token anymore.
func (m *module) pruneSessions(ctx context.Context) error {
	_, err := m.db.Exec(ctx, `DELETE FROM sessions WHERE last_seen < now() - $1::interval`, m.tokens.Duration.String())
	return err
}

func (m *module) pruneChallenges(ctx context.Context) error {
	_, err := m.db.Exec(ctx, `DELETE FROM mfa_challenges WHERE created < now() - $1::interval`, challengeTTL.String())
	return err
}
