package authn

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/go-webauthn/webauthn/protocol/webauthncbor"
	"github.com/go-webauthn/webauthn/protocol/webauthncose"

	"gripello/internal/platform/lockout"
)

const (
	flagUserPresent  = 0x01
	flagUserVerified = 0x04
	flagAttested     = 0x40
	testOrigin       = "http://localhost:3000"
)

type softwareAuthenticator struct {
	t            *testing.T
	key          *ecdsa.PrivateKey
	credentialID []byte
	userHandle   []byte
	signCount    uint32
}

func newSoftwareAuthenticator(t *testing.T) *softwareAuthenticator {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	id := make([]byte, 16)
	rand.Read(id)
	return &softwareAuthenticator{t: t, key: key, credentialID: id}
}

func authenticatorData(flags byte, signCount uint32, attested []byte) []byte {
	rpIDHash := sha256.Sum256([]byte("localhost"))
	data := append(rpIDHash[:], flags)
	data = binary.BigEndian.AppendUint32(data, signCount)
	return append(data, attested...)
}

func clientData(kind string, options map[string]any) []byte {
	raw, _ := json.Marshal(map[string]any{"type": kind, "challenge": options["challenge"], "origin": testOrigin})
	return raw
}

func (a *softwareAuthenticator) attestation(options map[string]any) map[string]any {
	a.t.Helper()
	user, _ := options["user"].(map[string]any)
	userHandle, err := b64url.DecodeString(user["id"].(string))
	if err != nil {
		a.t.Fatal(err)
	}
	a.userHandle = userHandle
	publicKey, err := webauthncbor.Marshal(webauthncose.EC2PublicKeyData{
		PublicKeyData: webauthncose.PublicKeyData{KeyType: int64(webauthncose.EllipticKey), Algorithm: int64(webauthncose.AlgES256)},
		Curve:         int64(webauthncose.P256),
		XCoord:        a.key.X.FillBytes(make([]byte, 32)),
		YCoord:        a.key.Y.FillBytes(make([]byte, 32)),
	})
	if err != nil {
		a.t.Fatal(err)
	}
	attested := make([]byte, 16)
	attested = binary.BigEndian.AppendUint16(attested, uint16(len(a.credentialID)))
	attested = append(append(attested, a.credentialID...), publicKey...)
	object, err := webauthncbor.Marshal(map[string]any{
		"fmt":      "none",
		"attStmt":  map[string]any{},
		"authData": authenticatorData(flagUserPresent|flagUserVerified|flagAttested, a.signCount, attested),
	})
	if err != nil {
		a.t.Fatal(err)
	}
	return map[string]any{
		"id": b64url.EncodeToString(a.credentialID), "rawId": b64url.EncodeToString(a.credentialID), "type": "public-key",
		"response": map[string]string{
			"clientDataJSON":    b64url.EncodeToString(clientData("webauthn.create", options)),
			"attestationObject": b64url.EncodeToString(object),
		},
	}
}

func (a *softwareAuthenticator) assertion(options map[string]any) map[string]any {
	a.t.Helper()
	a.signCount++
	data := authenticatorData(flagUserPresent|flagUserVerified, a.signCount, nil)
	client := clientData("webauthn.get", options)
	clientHash := sha256.Sum256(client)
	digest := sha256.Sum256(append(append([]byte{}, data...), clientHash[:]...))
	signature, err := ecdsa.SignASN1(rand.Reader, a.key, digest[:])
	if err != nil {
		a.t.Fatal(err)
	}
	return map[string]any{
		"id": b64url.EncodeToString(a.credentialID), "rawId": b64url.EncodeToString(a.credentialID), "type": "public-key",
		"response": map[string]string{
			"clientDataJSON":    b64url.EncodeToString(client),
			"authenticatorData": b64url.EncodeToString(data),
			"signature":         b64url.EncodeToString(signature),
			"userHandle":        b64url.EncodeToString(a.userHandle),
		},
	}
}

func (f *fixture) registerPasskey(token string, a *softwareAuthenticator) map[string]any {
	f.t.Helper()
	status, options := f.send(http.MethodPost, "/me/passkeys/options", token, map[string]string{"password": testPassword})
	if status != http.StatusOK {
		f.t.Fatalf("registration options = %d %v", status, options)
	}
	status, saved := f.send(http.MethodPost, "/me/passkeys", token, map[string]any{
		"ceremony": options["ceremony"], "credential": a.attestation(options["options"].(map[string]any)), "name": "Laptop",
	})
	if status != http.StatusOK {
		f.t.Fatalf("register = %d %v", status, saved)
	}
	return saved
}

func (f *fixture) passkeyLogin(credential func(map[string]any) map[string]any, mfaID string) (int, map[string]any) {
	f.t.Helper()
	status, options := f.send(http.MethodPost, "/auth/passkey/options", "", nil)
	if status != http.StatusOK {
		f.t.Fatalf("login options = %d %v", status, options)
	}
	body := map[string]any{"ceremony": options["ceremony"], "credential": credential(options["options"].(map[string]any))}
	if mfaID != "" {
		body["mfaId"] = mfaID
	}
	return f.send(http.MethodPost, "/auth/passkey", "", body)
}

func TestPasskeyRegistrationAndSignIn(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	id := f.user("passkey@example.com")
	a := newSoftwareAuthenticator(t)
	saved := f.registerPasskey(f.loginToken("passkey@example.com"), a)
	if factor, _ := saved["factor"].(map[string]any); factor["kind"] != methodPasskey || factor["name"] != "Laptop" {
		t.Errorf("saved factor = %v", saved)
	}
	if codes, _ := saved["recoveryCodes"].([]any); len(codes) != recoveryCodeCount {
		t.Errorf("first factor recovery codes = %v", saved["recoveryCodes"])
	}

	status, body := f.passkeyLogin(a.assertion, "")
	token, _ := body["token"].(string)
	if status != http.StatusOK || token == "" {
		t.Fatalf("passkey alone = %d %v", status, body)
	}
	if n := f.count(`SELECT count(*) FROM sessions WHERE id = $1 AND "user" = $2 AND method = 'passkey'`, sidOf(token), id); n != 1 {
		t.Errorf("passkey session rows = %d", n)
	}
	if n := f.count(`SELECT count(*) FROM mfa_factors WHERE "user" = $1 AND sign_count = 1 AND last_used IS NOT NULL`, id); n != 1 {
		t.Errorf("sign count not stored")
	}

	status, body = f.login("passkey@example.com", testPassword)
	mfaID, _ := body["mfaId"].(string)
	if status != http.StatusUnauthorized || mfaID == "" {
		t.Fatalf("password with a passkey = %d %v", status, body)
	}
	if status, body := f.passkeyLogin(a.assertion, mfaID); status != http.StatusOK || body["token"] == nil {
		t.Errorf("passkey as second step = %d %v", status, body)
	}
}

func TestPasskeySignInRefusesForgeries(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	f.user("forged@example.com")
	a := newSoftwareAuthenticator(t)
	f.registerPasskey(f.loginToken("forged@example.com"), a)

	wrongSignature := func(options map[string]any) map[string]any {
		credential := a.assertion(options)
		other := newSoftwareAuthenticator(t)
		other.credentialID, other.userHandle = a.credentialID, a.userHandle
		credential["response"].(map[string]string)["signature"] = other.assertion(options)["response"].(map[string]string)["signature"]
		return credential
	}
	unknownCredential := func(options map[string]any) map[string]any {
		other := newSoftwareAuthenticator(t)
		other.userHandle = a.userHandle
		return other.assertion(options)
	}
	cloned := func(options map[string]any) map[string]any {
		a.signCount = 0
		return a.assertion(options)
	}
	if status, _ := f.passkeyLogin(a.assertion, ""); status != http.StatusOK {
		t.Fatalf("genuine passkey = %d", status)
	}
	a.signCount = 5
	if status, _ := f.passkeyLogin(a.assertion, ""); status != http.StatusOK {
		t.Fatalf("genuine passkey with a higher count = %d", status)
	}
	for name, credential := range map[string]func(map[string]any) map[string]any{
		"wrong signature": wrongSignature, "unknown credential": unknownCredential, "lower sign count": cloned,
	} {
		if status, body := f.passkeyLogin(credential, ""); status != http.StatusBadRequest || body["token"] != nil {
			t.Errorf("%s = %d %v", name, status, body)
		}
	}
}

func TestPasskeySignInIgnoresTheLockout(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	id := f.user("locked-passkey@example.com")
	a := newSoftwareAuthenticator(t)
	f.registerPasskey(f.loginToken("locked-passkey@example.com"), a)
	for range lockout.MaxFailures {
		f.login("locked-passkey@example.com", "wrong")
	}
	if !lockout.IsLocked(context.Background(), f.app.DB, id) {
		t.Fatal("account not locked")
	}
	if status, body := f.passkeyLogin(a.assertion, ""); status != http.StatusOK || body["token"] == nil {
		t.Errorf("passkey while locked = %d %v", status, body)
	}
}
