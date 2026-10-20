package authn

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"image"
	stdpng "image/png"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// fakeIdP is an OpenID provider whose token endpoint signs an id_token for claims; the code carries the nonce.
type fakeIdP struct {
	server *httptest.Server
	key    *rsa.PrivateKey
	claims map[string]any
}

func newFakeIdP(t *testing.T) *fakeIdP {
	t.Helper()
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	idp := &fakeIdP{key: key, claims: map[string]any{"sub": "subject-1", "email": "climber@example.com", "email_verified": true, "given_name": "Kim"}}
	mux := http.NewServeMux()
	idp.server = httptest.NewServer(mux)
	t.Cleanup(idp.server.Close)
	issuer := idp.server.URL
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"issuer": issuer, "authorization_endpoint": issuer + "/authorize", "token_endpoint": issuer + "/token",
			"jwks_uri": issuer + "/jwks", "id_token_signing_alg_values_supported": []string{"RS256"}})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{"kty": "RSA", "kid": "k1", "alg": "RS256", "use": "sig",
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())}}})
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		claims := jwt.MapClaims{"iss": issuer, "aud": "client-1", "exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix(), "nonce": r.Form.Get("code")}
		for k, v := range idp.claims {
			claims[k] = v
		}
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
		token.Header["kid"] = "k1"
		signed, _ := token.SignedString(key)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"access_token": "at", "token_type": "Bearer", "id_token": signed, "expires_in": 3600})
	})
	return idp
}

func (f *fixture) enableOIDC(idp *fakeIdP) {
	f.t.Helper()
	f.exec(`INSERT INTO oauth2_providers (provider, enabled, client_id, display_name, issuer_url) VALUES ('oidc', true, 'client-1', 'Club login', $1)`, idp.server.URL)
}

func (f *fixture) raw(method, path, token string, body any, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	payload, _ := json.Marshal(body)
	req := httptest.NewRequest(method, "/api"+path, strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	for _, c := range cookies {
		if c != nil {
			req.AddCookie(c)
		}
	}
	rec := httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	return rec
}

type oauthFlow struct {
	state, nonce string
	cookie       *http.Cookie
}

func (f *fixture) startOAuth(token string, body map[string]any) oauthFlow {
	f.t.Helper()
	rec := f.raw(http.MethodPost, "/auth/oauth2/oidc/start", token, body)
	if rec.Code != http.StatusOK {
		f.t.Fatalf("start = %d %s", rec.Code, rec.Body)
	}
	var out struct{ URL string }
	json.Unmarshal(rec.Body.Bytes(), &out)
	authURL, _ := url.Parse(out.URL)
	q := authURL.Query()
	if q.Get("code_challenge_method") != "S256" || q.Get("redirect_uri") != "http://localhost:3000/api/auth/oauth2/oidc/callback" {
		f.t.Errorf("authorization url = %s", out.URL)
	}
	return oauthFlow{state: q.Get("state"), nonce: q.Get("nonce"), cookie: rec.Result().Cookies()[0]}
}

// callback answers the redirect target the provider sends the browser to.
func (f *fixture) callback(flow oauthFlow) *url.URL {
	f.t.Helper()
	rec := f.raw(http.MethodGet, "/auth/oauth2/oidc/callback?state="+url.QueryEscape(flow.state)+"&code="+url.QueryEscape(flow.nonce), "", nil)
	if rec.Code != http.StatusFound {
		f.t.Fatalf("callback = %d %s", rec.Code, rec.Body)
	}
	target, _ := url.Parse(rec.Header().Get("Location"))
	return target
}

func (f *fixture) finish(ticket string, cookie *http.Cookie) (int, map[string]any) {
	rec := f.raw(http.MethodPost, "/auth/oauth2/finish", "", map[string]string{"ticket": ticket}, cookie)
	body := map[string]any{}
	json.Unmarshal(rec.Body.Bytes(), &body)
	return rec.Code, body
}

func TestOAuth2LinksAVerifiedAccountByVerifiedEmail(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	idp := newFakeIdP(t)
	f.enableOIDC(idp)
	climber := f.user("climber@example.com")
	idp.claims["email"] = "Climber@EXAMPLE.com"

	flow := f.startOAuth("", map[string]any{"redirect": "/kletterhalle/routes"})
	target := f.callback(flow)
	if target.Path != "/auth/login" || target.Query().Get("redirect") != "/kletterhalle/routes" || target.Query().Get("oauth2") == "" {
		t.Fatalf("callback target = %s", target)
	}
	if status, _ := f.finish(target.Query().Get("oauth2"), nil); status != http.StatusBadRequest {
		t.Errorf("finish without the flow cookie = %d", status)
	}
	flow = f.startOAuth("", map[string]any{})
	target = f.callback(flow)
	status, body := f.finish(target.Query().Get("oauth2"), flow.cookie)
	record, _ := body["record"].(map[string]any)
	if status != http.StatusOK || record["id"] != climber {
		t.Fatalf("finish = %d %v", status, body)
	}
	if status, _ := f.finish(target.Query().Get("oauth2"), flow.cookie); status != http.StatusBadRequest {
		t.Errorf("ticket reused = %d", status)
	}
	if rec := f.raw(http.MethodGet, "/auth/oauth2/oidc/callback?state="+flow.state+"&code="+flow.nonce, "", nil); !strings.Contains(rec.Header().Get("Location"), "oauth2Error=failed") {
		t.Errorf("state reused: %s", rec.Header().Get("Location"))
	}
	if n := f.count(`SELECT count(*) FROM user_identities WHERE "user" = $1 AND provider = 'oidc' AND subject = 'subject-1' AND email = 'climber@example.com'`, climber); n != 1 {
		t.Errorf("%d identities linked with the normalised e-mail", n)
	}
	if n := f.count(`SELECT count(*) FROM sessions WHERE "user" = $1 AND method = 'oauth2:oidc'`, climber); n != 1 {
		t.Errorf("%d oauth2 sessions", n)
	}
}

func TestOAuth2NeverLinksUnverifiedAddresses(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	idp := newFakeIdP(t)
	f.enableOIDC(idp)
	climber := f.user("climber@example.com")
	f.exec(`UPDATE users SET verified = false WHERE id = $1`, climber)
	if target := f.callback(f.startOAuth("", map[string]any{})); target.Query().Get("oauth2Error") != "account_exists" {
		t.Errorf("unverified local account: %s", target)
	}
	f.exec(`UPDATE users SET verified = true WHERE id = $1`, climber)
	idp.claims["email_verified"] = false
	f.exec(`INSERT INTO settings (id, allow_registration) VALUES ('platformsetting', true) ON CONFLICT (id) DO UPDATE SET allow_registration = true`)
	if target := f.callback(f.startOAuth("", map[string]any{})); target.Query().Get("oauth2Error") != "email_unverified" {
		t.Errorf("unverified provider email: %s", target)
	}
	if n := f.count(`SELECT count(*) FROM user_identities`); n != 0 {
		t.Errorf("%d identities linked", n)
	}
}

func TestOAuth2CreatesAccountsOnlyWhenRegistrationIsOpen(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	idp := newFakeIdP(t)
	f.enableOIDC(idp)
	idp.claims["email"] = "new@example.com"
	if target := f.callback(f.startOAuth("", map[string]any{})); target.Query().Get("oauth2Error") != "registration_disabled" {
		t.Fatalf("closed registration: %s", target)
	}
	f.exec(`INSERT INTO settings (id, allow_registration) VALUES ('platformsetting', true) ON CONFLICT (id) DO UPDATE SET allow_registration = true`)
	flow := f.startOAuth("", map[string]any{"persistent": false})
	target := f.callback(flow)
	if target.Query().Get("persistent") != "0" {
		t.Errorf("an unchecked remember me got lost: %s", target)
	}
	status, body := f.finish(target.Query().Get("oauth2"), flow.cookie)
	record, _ := body["record"].(map[string]any)
	if status != http.StatusOK || record["email"] != "new@example.com" || record["firstname"] != "Kim" || record["verified"] != true {
		t.Fatalf("new account = %d %v", status, body)
	}
	if status, body := f.login("new@example.com", ""); status == http.StatusOK {
		t.Errorf("empty password signs in: %v", body)
	}
}

func TestOAuth2HandsTheNativeAppItsTicketThroughTheAppScheme(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	idp := newFakeIdP(t)
	f.enableOIDC(idp)
	f.exec(`INSERT INTO settings (id, allow_registration) VALUES ('platformsetting', true) ON CONFLICT (id) DO UPDATE SET allow_registration = true`)
	idp.claims["email"] = "app@example.com"
	flow := f.startOAuth("", map[string]any{"native": true})
	target := f.callback(flow)
	if target.Scheme != "app.gripello" || target.Path != "/auth/login" || target.Query().Get("oauth2") == "" {
		t.Fatalf("native callback target = %s", target)
	}
	// Whoever catches the app scheme still lacks the flow cookie of the app's WebView.
	if status, _ := f.finish(target.Query().Get("oauth2"), &http.Cookie{Name: flowCookie, Value: "guess"}); status == http.StatusOK {
		t.Fatal("ticket redeemed without the flow cookie")
	}
	flow = f.startOAuth("", map[string]any{"native": true})
	if status, body := f.finish(f.callback(flow).Query().Get("oauth2"), flow.cookie); status != http.StatusOK {
		t.Fatalf("finish = %d %v", status, body)
	}
	flow = f.startOAuth("", map[string]any{"native": true})
	rec := f.raw(http.MethodGet, "/auth/oauth2/oidc/callback?state="+url.QueryEscape(flow.state)+"&error=access_denied", "", nil)
	if target, _ := url.Parse(rec.Header().Get("Location")); target.Scheme != "app.gripello" || target.Query().Get("oauth2Error") != "failed" {
		t.Errorf("a cancelled native sign-in must return to the app: %s", target)
	}
}

func TestOAuth2RespectsSecondFactorAndSuspension(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	idp := newFakeIdP(t)
	f.enableOIDC(idp)
	climber := f.user("climber@example.com")
	f.enableTOTP(f.loginToken("climber@example.com"))
	flow := f.startOAuth("", map[string]any{})
	if status, body := f.finish(f.callback(flow).Query().Get("oauth2"), flow.cookie); status != http.StatusUnauthorized || body["mfaId"] == nil {
		t.Errorf("with TOTP = %d %v", status, body)
	}
	f.exec(`UPDATE users SET suspended_until = now() + interval '1 day' WHERE id = $1`, climber)
	flow = f.startOAuth("", map[string]any{})
	if status, _ := f.finish(f.callback(flow).Query().Get("oauth2"), flow.cookie); status == http.StatusOK || status == http.StatusUnauthorized {
		t.Errorf("suspended account = %d", status)
	}
}

func TestOAuth2LinkingAndUnlinking(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	idp := newFakeIdP(t)
	f.enableOIDC(idp)
	climber := f.user("other@example.com")
	token := f.loginToken("other@example.com")
	if rec := f.raw(http.MethodPost, "/auth/oauth2/oidc/start", token, map[string]any{"link": true}); rec.Code != http.StatusForbidden {
		t.Fatalf("link without a fresh password = %d", rec.Code)
	}
	if status, body := f.send(http.MethodPost, "/me/reauthenticate", token, map[string]string{"password": testPassword}); status != http.StatusNoContent {
		t.Fatalf("reauthenticate = %d %v", status, body)
	}
	flow := f.startOAuth(token, map[string]any{"link": true})
	target := f.callback(flow)
	ticket := target.Query().Get("oauth2Link")
	if target.Path != "/account/settings" || ticket == "" {
		t.Fatalf("link target = %s", target)
	}
	if n := f.count(`SELECT count(*) FROM user_identities WHERE "user" = $1`, climber); n != 0 {
		t.Fatalf("the callback linked by itself (%d identities)", n)
	}
	// Another browser (no flow cookie) or the login finish can't use a link ticket.
	if rec := f.raw(http.MethodPost, "/auth/oauth2/link", token, map[string]string{"ticket": ticket}); rec.Code != http.StatusUnauthorized && rec.Code != http.StatusBadRequest {
		t.Fatalf("link without the flow cookie = %d", rec.Code)
	}
	flow = f.startOAuth(token, map[string]any{"link": true})
	ticket = f.callback(flow).Query().Get("oauth2Link")
	if status, _ := f.finish(ticket, flow.cookie); status == http.StatusOK {
		t.Fatal("a link ticket signed in")
	}
	flow = f.startOAuth(token, map[string]any{"link": true})
	ticket = f.callback(flow).Query().Get("oauth2Link")
	if rec := f.raw(http.MethodPost, "/auth/oauth2/link", token, map[string]string{"ticket": ticket}, flow.cookie); rec.Code != http.StatusNoContent {
		t.Fatalf("link = %d %s", rec.Code, rec.Body)
	}
	status, body := f.send(http.MethodGet, "/me/identities", token, nil)
	items, _ := body["items"].([]any)
	if status != http.StatusOK || len(items) != 1 || body["hasPassword"] != true {
		t.Fatalf("identities = %d %v", status, body)
	}
	id := items[0].(map[string]any)["id"].(string)
	f.exec(`UPDATE users SET password_hash = '' WHERE id = $1`, climber)
	if status, _ := f.send(http.MethodDelete, "/me/identities/"+id, token, nil); status != http.StatusConflict {
		t.Errorf("unlinking the last way in = %d", status)
	}
	f.exec(`UPDATE users SET password_hash = $2 WHERE id = $1`, climber, f.hash)
	if status, _ := f.send(http.MethodDelete, "/me/identities/"+id, token, nil); status != http.StatusNoContent {
		t.Errorf("unlink = %d", status)
	}
	if status, _ := f.send(http.MethodPost, "/auth/oauth2/oidc/start", "", map[string]any{"link": true}); status != http.StatusUnauthorized {
		t.Errorf("guest link = %d", status)
	}
}

func TestOAuth2DropsUnsafeRedirectsAndHiddenProviders(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	idp := newFakeIdP(t)
	f.enableOIDC(idp)
	f.user("climber@example.com")
	for _, redirect := range []string{"//evil.example", "/\\evil.example", "https://evil.example"} {
		if target := f.callback(f.startOAuth("", map[string]any{"redirect": redirect})); target.Query().Get("redirect") != "" {
			t.Errorf("%q kept as %s", redirect, target)
		}
	}
	f.exec(`UPDATE oauth2_providers SET enabled = false`)
	if status, _ := f.send(http.MethodPost, "/auth/oauth2/oidc/start", "", map[string]any{}); status != http.StatusNotFound {
		t.Errorf("disabled provider = %d", status)
	}
	if status, _ := f.send(http.MethodPost, "/auth/oauth2/github/start", "", map[string]any{}); status != http.StatusNotFound {
		t.Errorf("unknown provider = %d", status)
	}
}

func TestProviderSettingsKeepSecretsAndListEnabledProviders(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	admin := f.platformAdmin("root@example.com", true)
	settings := map[string]any{"enabled": true, "client_id": "g-client", "client_secret": "g-secret"}
	if status, _ := f.send(http.MethodPut, "/platform/oauth2/google", f.platformAdmin("lazy@example.com", false), settings); status != http.StatusForbidden {
		t.Errorf("without a fresh password = %d", status)
	}
	if status, _ := f.send(http.MethodPut, "/platform/oauth2/oidc", admin, map[string]any{"enabled": true, "client_id": "c", "issuer_url": "http://insecure.example"}); status != http.StatusBadRequest {
		t.Errorf("http issuer = %d", status)
	}
	status, body := f.send(http.MethodPut, "/platform/oauth2/google", admin, settings)
	if status != http.StatusOK || strings.Contains(mustJSON(body), "g-secret") {
		t.Fatalf("save = %d %v", status, body)
	}
	if n := f.count(`SELECT count(*) FROM oauth2_providers WHERE client_secret LIKE '%g-secret%' OR client_secret = ''`); n != 0 {
		t.Error("client secret not sealed")
	}
	f.send(http.MethodPut, "/platform/oauth2/google", admin, map[string]any{"enabled": true, "client_id": "g-client"})
	_, body = f.send(http.MethodGet, "/platform/oauth2", admin, nil)
	if !strings.Contains(mustJSON(body), `"client_secret_set":true`) {
		t.Errorf("leaving the secret out cleared it: %v", body)
	}
	_, methods := f.send(http.MethodGet, "/auth/methods", "", nil)
	if !strings.Contains(mustJSON(methods), `"name":"google"`) {
		t.Errorf("auth methods = %v", methods)
	}
}

func TestAppleClientSecretAndMicrosoftIssuer(t *testing.T) {
	t.Parallel()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	der, _ := x509.MarshalPKCS8PrivateKey(key)
	c := providerConfig{Provider: "apple", ClientID: "app.gripello", TeamID: "TEAM", KeyID: "KEY", PrivateKey: string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))}
	signed, err := appleClientSecret(c, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := jwt.Parse(signed, func(*jwt.Token) (any, error) { return &key.PublicKey, nil })
	claims := parsed.Claims.(jwt.MapClaims)
	if err != nil || parsed.Header["kid"] != "KEY" || claims["iss"] != "TEAM" || claims["sub"] != "app.gripello" {
		t.Errorf("apple secret = %v %v %v", err, parsed.Header, claims)
	}
	if !microsoftIssuerMatches("https://login.microsoftonline.com/t1/v2.0", "t1") || microsoftIssuerMatches("https://login.microsoftonline.com/t2/v2.0", "t1") || microsoftIssuerMatches("x", "") {
		t.Error("microsoft issuer check")
	}
	if !(providerConfig{Provider: "microsoft"}).multiTenant() || (providerConfig{Provider: "microsoft", Tenant: "c00762ff"}).multiTenant() {
		t.Error("multi-tenant detection")
	}
}

func TestOAuth2CopiesTheProviderPictureIntoNewAccounts(t *testing.T) {
	var png bytes.Buffer
	stdpng.Encode(&png, image.NewRGBA(image.Rect(0, 0, 4, 4)))
	pictures := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Write(png.Bytes())
	}))
	defer pictures.Close()
	original := avatarClient
	avatarClient = pictures.Client()
	t.Cleanup(func() { avatarClient = original })

	f := newFixture(t)
	idp := newFakeIdP(t)
	f.enableOIDC(idp)
	f.exec(`INSERT INTO settings (id, allow_registration) VALUES ('platformsetting', true) ON CONFLICT (id) DO UPDATE SET allow_registration = true`)
	idp.claims["email"], idp.claims["picture"] = "pictured@example.com", pictures.URL+"/me.png"
	flow := f.startOAuth("", map[string]any{})
	status, body := f.finish(f.callback(flow).Query().Get("oauth2"), flow.cookie)
	record, _ := body["record"].(map[string]any)
	if avatar, _ := record["avatar"].(string); status != http.StatusOK || !strings.HasPrefix(avatar, "avatar_") || !strings.HasSuffix(avatar, ".png") {
		t.Fatalf("new account = %d %v", status, body)
	}
}

func TestAvatarDownloadsStayOffTheInternalNetwork(t *testing.T) {
	t.Parallel()
	for address, allowed := range map[string]bool{"142.250.185.65:443": true, "127.0.0.1:443": false, "10.0.0.5:443": false, "192.168.178.100:443": false,
		"169.254.169.254:80": false, "[::1]:443": false, "[::ffff:127.0.0.1]:443": false, "[fd00::1]:443": false} {
		if err := publicHostsOnly("tcp", address, nil); (err == nil) != allowed {
			t.Errorf("%s allowed = %v", address, err == nil)
		}
	}
}

func TestMicrosoftAddressesOnlyBecomeAccountsWhenTrusted(t *testing.T) {
	t.Parallel()
	single := providerConfig{Provider: "microsoft", Tenant: "c00762ff-ede4-460b-b5d2-842f353c10f6"}
	common := providerConfig{Provider: "microsoft", Tenant: "common"}
	for name, tc := range map[string]struct {
		c      providerConfig
		claims identityClaims
		want   bool
	}{
		"own tenant":            {single, identityClaims{TenantID: single.Tenant}, true},
		"personal account":      {common, identityClaims{TenantID: microsoftConsumers}, true},
		"foreign tenant":        {common, identityClaims{TenantID: "other"}, false},
		"foreign tenant, edov":  {common, identityClaims{TenantID: "other", EmailDomainOwnerVerified: json.RawMessage(`true`)}, true},
		"google without verify": {providerConfig{Provider: "google"}, identityClaims{}, false},
		"apple string true":     {providerConfig{Provider: "apple"}, identityClaims{EmailVerified: json.RawMessage(`"true"`)}, true},
	} {
		if got := newAccountEmailVerified(tc.c, tc.claims); got != tc.want {
			t.Errorf("%s = %v, want %v", name, got, tc.want)
		}
	}
}
