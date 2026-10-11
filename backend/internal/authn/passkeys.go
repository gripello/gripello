package authn

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/httpx"
)

var b64url = base64.RawURLEncoding

type passkeyUser struct {
	account
	factors []factor
}

func (u passkeyUser) WebAuthnID() []byte { return []byte(u.ID) }

func (u passkeyUser) WebAuthnName() string { return firstNonEmpty(u.Email, u.Username) }

func (u passkeyUser) WebAuthnDisplayName() string {
	return firstNonEmpty(u.Firstname+" "+u.Name, u.WebAuthnName())
}

func (u passkeyUser) WebAuthnCredentials() []webauthn.Credential {
	credentials := []webauthn.Credential{}
	for _, f := range u.factors {
		if credential, err := factorCredential(f); err == nil {
			credentials = append(credentials, credential)
		}
	}
	return credentials
}

func (m *module) passkeyUser(ctx context.Context, user account) (passkeyUser, error) {
	factors, err := listFactors(ctx, m.db, user.ID)
	return passkeyUser{account: user, factors: factors}, err
}

func factorCredential(f factor) (webauthn.Credential, error) {
	if f.Kind != methodPasskey {
		return webauthn.Credential{}, errors.New("not a passkey")
	}
	id, err := b64url.DecodeString(f.CredentialID)
	if err != nil {
		return webauthn.Credential{}, err
	}
	publicKey, err := b64url.DecodeString(f.PublicKey)
	if err != nil {
		return webauthn.Credential{}, err
	}
	aaguid, _ := hex.DecodeString(f.AAGUID)
	transports := []protocol.AuthenticatorTransport{}
	for _, t := range f.Transports {
		transports = append(transports, protocol.AuthenticatorTransport(t))
	}
	return webauthn.Credential{
		ID:              id,
		PublicKey:       publicKey,
		AttestationType: f.Attestation,
		Transport:       transports,
		Flags: webauthn.CredentialFlags{
			UserPresent:    true,
			UserVerified:   true,
			BackupEligible: f.BackupEligible,
			BackupState:    f.BackupState,
		},
		Authenticator: webauthn.Authenticator{AAGUID: aaguid, SignCount: uint32(f.SignCount)},
	}, nil
}

var errPasskeysUnavailable = httpx.NewError(http.StatusServiceUnavailable, "Passkeys are not available on this server.")

func (m *module) relyingParty() (*webauthn.WebAuthn, error) {
	rp, err := m.rp()
	if err != nil {
		return nil, errPasskeysUnavailable
	}
	return rp, nil
}

func (m *module) newRelyingParty() (*webauthn.WebAuthn, error) {
	rp, err := buildRelyingParty(m.appURL, m.appName)
	if err != nil {
		slog.Warn("authn: passkeys disabled, APP_URL must be a domain", "app_url", m.appURL, "error", err)
	}
	return rp, err
}

func buildRelyingParty(appURL, appName string) (*webauthn.WebAuthn, error) {
	origin, err := url.Parse(appURL)
	if err != nil || origin.Hostname() == "" {
		return nil, errors.New("APP_URL is not configured")
	}
	origins := []string{origin.Scheme + "://" + origin.Host}
	if origin.Hostname() == "localhost" {
		origins = append(origins, "http://localhost:3000")
	}
	return webauthn.New(&webauthn.Config{RPID: origin.Hostname(), RPDisplayName: appName, RPOrigins: origins})
}

// Ceremonies live in mfa_challenges, so the options and the answer may hit different replicas.
func (m *module) ceremonyResponse(w http.ResponseWriter, r *http.Request, session *webauthn.SessionData, userID string, options any) error {
	data, err := json.Marshal(session)
	if err != nil {
		return err
	}
	id, err := insertChallenge(r.Context(), m.db, "passkey", userID, "", data)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ceremony": id, "options": options})
	return nil
}

func (m *module) takeCeremony(ctx context.Context, id, userID string) (webauthn.SessionData, error) {
	var session webauthn.SessionData
	c, err := takeChallenge(ctx, m.db, "passkey", id)
	if isNoRows(err) || err == nil && c.User != userID {
		return session, errCeremonyExpired
	}
	if err != nil {
		return session, err
	}
	return session, json.Unmarshal(c.Data, &session)
}

func (m *module) passkeyRegistrationOptions(w http.ResponseWriter, r *http.Request) error {
	user, err := m.requirePassword(r)
	if err != nil {
		return err
	}
	rp, err := m.relyingParty()
	if err != nil {
		return err
	}
	pu, err := m.passkeyUser(r.Context(), user)
	if err != nil {
		return err
	}
	exclusions := []protocol.CredentialDescriptor{}
	for _, credential := range pu.WebAuthnCredentials() {
		exclusions = append(exclusions, credential.Descriptor())
	}
	creation, session, err := rp.BeginRegistration(pu,
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementRequired),
		webauthn.WithExclusions(exclusions),
	)
	if err != nil {
		return err
	}
	return m.ceremonyResponse(w, r, session, user.ID, creation.Response)
}

func (m *module) passkeyRegister(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	var body struct {
		Ceremony   string          `json:"ceremony"`
		Credential json.RawMessage `json:"credential"`
		Name       string          `json:"name"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	session, err := m.takeCeremony(r.Context(), body.Ceremony, p.UserID)
	if err != nil {
		return err
	}
	rp, err := m.relyingParty()
	if err != nil {
		return err
	}
	user, err := findAccount(r.Context(), m.db, p.UserID)
	if err != nil {
		return err
	}
	pu, err := m.passkeyUser(r.Context(), user)
	if err != nil {
		return err
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes(body.Credential)
	if err != nil {
		return httpx.NewError(http.StatusBadRequest, "Invalid passkey.")
	}
	credential, err := rp.CreateCredential(pu, session, parsed)
	if err != nil {
		return httpx.NewError(http.StatusBadRequest, "Invalid passkey.")
	}
	transports := []string{}
	for _, t := range credential.Transport {
		transports = append(transports, string(t))
	}
	return m.saveFactor(w, r, user, factor{
		Kind:           methodPasskey,
		Name:           truncateRunes(body.Name, 60),
		CredentialID:   b64url.EncodeToString(credential.ID),
		PublicKey:      b64url.EncodeToString(credential.PublicKey),
		SignCount:      int64(credential.Authenticator.SignCount),
		AAGUID:         hex.EncodeToString(credential.Authenticator.AAGUID),
		Transports:     transports,
		BackupEligible: credential.Flags.BackupEligible,
		BackupState:    credential.Flags.BackupState,
		Attestation:    credential.AttestationType,
	}, "passkey_added")
}

func (m *module) passkeyLoginOptions(w http.ResponseWriter, r *http.Request) error {
	rp, err := m.relyingParty()
	if err != nil {
		return err
	}
	assertion, session, err := rp.BeginDiscoverableLogin(webauthn.WithUserVerification(protocol.VerificationRequired))
	if err != nil {
		return err
	}
	return m.ceremonyResponse(w, r, session, "", assertion.Response)
}

// passkeyLogin is a full login on its own, or the second step when mfaId is sent; it ignores the lockout.
func (m *module) passkeyLogin(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Ceremony   string          `json:"ceremony"`
		Credential json.RawMessage `json:"credential"`
		MFAID      string          `json:"mfaId"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	ctx := r.Context()
	session, err := m.takeCeremony(ctx, body.Ceremony, "")
	if err != nil {
		return err
	}
	rp, err := m.relyingParty()
	if err != nil {
		return err
	}
	parsed, err := protocol.ParseCredentialRequestResponseBytes(body.Credential)
	if err != nil {
		return errFailedAuth
	}
	var found factor
	var user passkeyUser
	credential, err := rp.ValidateDiscoverableLogin(func(rawID, userHandle []byte) (webauthn.User, error) {
		f, err := findPasskey(ctx, m.db, b64url.EncodeToString(rawID))
		if err != nil || f.User != string(userHandle) {
			return nil, errors.New("unknown passkey")
		}
		a, err := findAccount(ctx, m.db, f.User)
		if err != nil {
			return nil, err
		}
		found = f
		user, err = m.passkeyUser(ctx, a)
		return user, err
	}, session, parsed)
	if err != nil {
		return errFailedAuth
	}
	if credential.Authenticator.CloneWarning {
		m.audit(ctx, AuthEvent{Action: "passkey_clone_rejected", User: user.ID, Label: user.label(), IP: clientIP(r)})
		return errFailedAuth
	}
	if _, err := m.db.Exec(ctx, `UPDATE mfa_factors SET sign_count = $2, backup_state = $3, last_used = now() WHERE id = $1`,
		found.ID, int64(credential.Authenticator.SignCount), credential.Flags.BackupState); err != nil {
		return err
	}
	return m.signIn(w, r, user.account, methodPasskey, body.MFAID)
}
