package hooks

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

const (
	passkeyCeremonyTTL = 10 * time.Minute
	passkeyCeremonyMax = 10000
)

var b64url = base64.RawURLEncoding

// ponytail: in-memory ceremonies, single PocketBase instance; move to a collection if it ever scales out
type passkeyCeremonies struct {
	mu       sync.Mutex
	sessions map[string]passkeyCeremony
}

type passkeyCeremony struct {
	data    webauthn.SessionData
	userID  string
	expires time.Time
}

var ceremonies = &passkeyCeremonies{sessions: map[string]passkeyCeremony{}}

func (c *passkeyCeremonies) put(data *webauthn.SessionData, userID string) (string, bool) {
	raw := make([]byte, 16)
	_, _ = rand.Read(raw)
	id := hex.EncodeToString(raw)
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	for key, ceremony := range c.sessions {
		if now.After(ceremony.expires) {
			delete(c.sessions, key)
		}
	}
	if len(c.sessions) >= passkeyCeremonyMax {
		return "", false
	}
	c.sessions[id] = passkeyCeremony{data: *data, userID: userID, expires: now.Add(passkeyCeremonyTTL)}
	return id, true
}

func ceremonyResponse(e *core.RequestEvent, session *webauthn.SessionData, userID string, options any) error {
	id, ok := ceremonies.put(session, userID)
	if !ok {
		return router.NewApiError(http.StatusServiceUnavailable, "Too many passkey requests. Try again later.", nil)
	}
	return e.JSON(http.StatusOK, map[string]any{"ceremony": id, "options": options})
}

func (c *passkeyCeremonies) take(id, userID string) (webauthn.SessionData, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	ceremony, ok := c.sessions[id]
	delete(c.sessions, id)
	if !ok || time.Now().After(ceremony.expires) || ceremony.userID != userID {
		return webauthn.SessionData{}, false
	}
	return ceremony.data, true
}

type passkeyUser struct {
	record  *core.Record
	factors []*core.Record
}

func (u passkeyUser) WebAuthnID() []byte { return []byte(u.record.Id) }

func (u passkeyUser) WebAuthnName() string {
	return firstNonEmpty(u.record.Email(), u.record.GetString("username"))
}

func (u passkeyUser) WebAuthnDisplayName() string {
	return firstNonEmpty(u.record.GetString("firstname")+" "+u.record.GetString("name"), u.WebAuthnName())
}

func (u passkeyUser) WebAuthnCredentials() []webauthn.Credential {
	credentials := []webauthn.Credential{}
	for _, factor := range u.factors {
		if credential, err := factorCredential(factor); err == nil {
			credentials = append(credentials, credential)
		}
	}
	return credentials
}

func newPasskeyUser(app core.App, record *core.Record) passkeyUser {
	return passkeyUser{record: record, factors: mfaFactors(app, record.Id)}
}

func factorCredential(factor *core.Record) (webauthn.Credential, error) {
	if factor.GetString("kind") != mfaMethodPasskey {
		return webauthn.Credential{}, errors.New("not a passkey")
	}
	id, err := b64url.DecodeString(factor.GetString("credential_id"))
	if err != nil {
		return webauthn.Credential{}, err
	}
	publicKey, err := b64url.DecodeString(factor.GetString("public_key"))
	if err != nil {
		return webauthn.Credential{}, err
	}
	aaguid, _ := hex.DecodeString(factor.GetString("aaguid"))
	transports := []protocol.AuthenticatorTransport{}
	_ = factor.UnmarshalJSONField("transports", &transports)
	return webauthn.Credential{
		ID:              id,
		PublicKey:       publicKey,
		AttestationType: factor.GetString("attestation_type"),
		Transport:       transports,
		Flags: webauthn.CredentialFlags{
			UserPresent:    true,
			UserVerified:   true,
			BackupEligible: factor.GetBool("backup_eligible"),
			BackupState:    factor.GetBool("backup_state"),
		},
		Authenticator: webauthn.Authenticator{AAGUID: aaguid, SignCount: uint32(factor.GetInt("sign_count"))},
	}, nil
}

func relyingParty(app core.App) (*webauthn.WebAuthn, error) {
	origin, err := url.Parse(appURL(app))
	if err != nil || origin.Hostname() == "" {
		return nil, errors.New("app URL is not configured")
	}
	origins := []string{origin.Scheme + "://" + origin.Host}
	if origin.Hostname() == "localhost" {
		origins = append(origins, "http://localhost:3000")
	}
	return webauthn.New(&webauthn.Config{
		RPID:          origin.Hostname(),
		RPDisplayName: app.Settings().Meta.AppName,
		RPOrigins:     origins,
	})
}

func registerPasskeys(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		signedIn := apis.RequireAuth("users")
		se.Router.POST("/api/account/passkeys/options", passkeyRegistrationOptions).Bind(signedIn)
		se.Router.POST("/api/account/passkeys", passkeyRegister).Bind(signedIn)
		se.Router.POST("/api/auth/passkey/options", passkeyLoginOptions)
		se.Router.POST("/api/auth/passkey", passkeyLogin)
		return se.Next()
	})
}

func passkeyRegistrationOptions(e *core.RequestEvent) error {
	if err := requirePassword(e); err != nil {
		return err
	}
	rp, err := relyingParty(e.App)
	if err != nil {
		return e.InternalServerError("", err)
	}
	user := newPasskeyUser(e.App, e.Auth)
	exclusions := []protocol.CredentialDescriptor{}
	for _, credential := range user.WebAuthnCredentials() {
		exclusions = append(exclusions, credential.Descriptor())
	}
	creation, session, err := rp.BeginRegistration(user,
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementRequired),
		webauthn.WithExclusions(exclusions),
	)
	if err != nil {
		return e.InternalServerError("", err)
	}
	return ceremonyResponse(e, session, e.Auth.Id, creation.Response)
}

func passkeyRegister(e *core.RequestEvent) error {
	var body struct {
		Ceremony   string          `json:"ceremony"`
		Credential json.RawMessage `json:"credential"`
		Name       string          `json:"name"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("", err)
	}
	session, ok := ceremonies.take(body.Ceremony, e.Auth.Id)
	if !ok {
		return e.BadRequestError("The passkey request expired.", nil)
	}
	rp, err := relyingParty(e.App)
	if err != nil {
		return e.InternalServerError("", err)
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes(body.Credential)
	if err != nil {
		return e.BadRequestError("Invalid passkey.", err)
	}
	credential, err := rp.CreateCredential(newPasskeyUser(e.App, e.Auth), session, parsed)
	if err != nil {
		return e.BadRequestError("Invalid passkey.", err)
	}
	factor, err := newFactor(e.App, e.Auth.Id, mfaMethodPasskey)
	if err != nil {
		return e.InternalServerError("", err)
	}
	factor.Set("name", truncateRunes(body.Name, 60))
	factor.Set("credential_id", b64url.EncodeToString(credential.ID))
	factor.Set("public_key", b64url.EncodeToString(credential.PublicKey))
	factor.Set("sign_count", credential.Authenticator.SignCount)
	factor.Set("aaguid", hex.EncodeToString(credential.Authenticator.AAGUID))
	factor.Set("transports", credential.Transport)
	factor.Set("backup_eligible", credential.Flags.BackupEligible)
	factor.Set("backup_state", credential.Flags.BackupState)
	factor.Set("attestation_type", credential.AttestationType)
	factor.Set("user_handle", b64url.EncodeToString([]byte(e.Auth.Id)))
	return saveFactor(e, factor, "passkey_added")
}

func passkeyLoginOptions(e *core.RequestEvent) error {
	rp, err := relyingParty(e.App)
	if err != nil {
		return e.InternalServerError("", err)
	}
	assertion, session, err := rp.BeginDiscoverableLogin(webauthn.WithUserVerification(protocol.VerificationRequired))
	if err != nil {
		return e.InternalServerError("", err)
	}
	return ceremonyResponse(e, session, "", assertion.Response)
}

func passkeyLogin(e *core.RequestEvent) error {
	var body struct {
		Ceremony   string          `json:"ceremony"`
		Credential json.RawMessage `json:"credential"`
		MFAID      string          `json:"mfaId"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("", err)
	}
	session, ok := ceremonies.take(body.Ceremony, "")
	if !ok {
		return e.BadRequestError("The passkey request expired.", nil)
	}
	rp, err := relyingParty(e.App)
	if err != nil {
		return e.InternalServerError("", err)
	}
	parsed, err := protocol.ParseCredentialRequestResponseBytes(body.Credential)
	if err != nil {
		return e.BadRequestError("Failed to authenticate.", err)
	}
	var factor *core.Record
	var user passkeyUser
	credential, err := rp.ValidateDiscoverableLogin(func(rawID, userHandle []byte) (webauthn.User, error) {
		found, err := e.App.FindFirstRecordByData("mfa_factors", "credential_id", b64url.EncodeToString(rawID))
		if err != nil || found.GetString("kind") != mfaMethodPasskey || found.GetString("user") != string(userHandle) {
			return nil, errors.New("unknown passkey")
		}
		record, err := e.App.FindRecordById("users", found.GetString("user"))
		if err != nil {
			return nil, err
		}
		factor = found
		user = newPasskeyUser(e.App, record)
		return user, nil
	}, session, parsed)
	if err != nil {
		return e.BadRequestError("Failed to authenticate.", err)
	}
	if credential.Authenticator.CloneWarning {
		writeAuthEvent(e, nil, user.record, "passkey_clone_rejected", "")
		return e.BadRequestError("Failed to authenticate.", errors.New("passkey signature counter went backwards"))
	}
	factor.Set("sign_count", credential.Authenticator.SignCount)
	factor.Set("backup_state", credential.Flags.BackupState)
	factor.Set("last_used", time.Now())
	if err := e.App.Save(factor); err != nil {
		return e.InternalServerError("", err)
	}
	if body.MFAID == "" {
		e.Set(passkeyLoginFlag, true)
	}
	return apis.RecordAuthResponse(e, user.record, mfaMethodPasskey, nil)
}
