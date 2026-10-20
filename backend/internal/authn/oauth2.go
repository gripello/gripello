package authn

import (
	"context"
	"crypto/subtle"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"golang.org/x/oauth2"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/blocklist"
	"gripello/internal/platform/db"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/lockout"
	platformmail "gripello/internal/platform/mail"
	"gripello/internal/platform/secretbox"
)

var oauth2Providers = []string{"google", "apple", "microsoft", "oidc"}

const flowCookie = "gripello_oauth2"

// The native apps run the provider round trip in the system browser (Google blocks embedded WebViews); the callback
// hands the ticket back through the app's URL scheme and the app's WebView, which holds the flow cookie, redeems it.
const nativeAppScheme = "app.gripello:"

// safeRedirect allows same-origin paths only; "//host" and "/\host" would leave the site.
var safeRedirect = regexp.MustCompile(`^/[^/\\]`)

type providerConfig struct {
	Provider     string
	Enabled      bool
	ClientID     string
	ClientSecret string
	DisplayName  string
	IssuerURL    string
	Tenant       string
	TeamID       string
	KeyID        string
	PrivateKey   string
	Updated      time.Time
}

func loadProvider(ctx context.Context, q db.Querier, secret, provider string) (providerConfig, error) {
	var c providerConfig
	var sealedSecret, sealedKey string
	err := q.QueryRow(ctx, `SELECT provider, enabled, client_id, client_secret, display_name, issuer_url, tenant, team_id, key_id, private_key, updated
		FROM oauth2_providers WHERE provider = $1`, provider).
		Scan(&c.Provider, &c.Enabled, &c.ClientID, &sealedSecret, &c.DisplayName, &c.IssuerURL, &c.Tenant, &c.TeamID, &c.KeyID, &sealedKey, &c.Updated)
	if err != nil {
		return c, err
	}
	if c.ClientSecret, err = secretbox.Open(secret, sealedSecret); err != nil {
		slog.Warn("authn: stored OAuth2 client secret is unreadable", "provider", provider)
	}
	if c.PrivateKey, err = secretbox.Open(secret, sealedKey); err != nil {
		slog.Warn("authn: stored Apple private key is unreadable", "provider", provider)
	}
	return c, nil
}

// issuer is the OpenID issuer the provider's id_tokens are verified against.
func (c providerConfig) issuer() string {
	switch c.Provider {
	case "google":
		return "https://accounts.google.com"
	case "apple":
		return "https://appleid.apple.com"
	case "microsoft":
		return "https://login.microsoftonline.com/" + c.tenant() + "/v2.0"
	}
	// Kept exactly as configured: go-oidc compares it with the discovered issuer, some of which end in "/" (Auth0).
	return c.IssuerURL
}

func (c providerConfig) tenant() string {
	if c.Tenant == "" {
		return "common"
	}
	return c.Tenant
}

// multiTenant Microsoft endpoints publish a templated issuer, so the tid claim is checked by hand.
func (c providerConfig) multiTenant() bool {
	return c.Provider == "microsoft" && slices.Contains([]string{"common", "organizations", "consumers"}, c.tenant())
}

func microsoftIssuerMatches(iss, tid string) bool {
	return tid != "" && iss == "https://login.microsoftonline.com/"+tid+"/v2.0"
}

// appleClientSecret is the ES256 JWT Apple wants instead of a static secret.
func appleClientSecret(c providerConfig, now time.Time) (string, error) {
	block, _ := pem.Decode([]byte(c.PrivateKey))
	if block == nil {
		return "", errors.New("apple: private key is not PEM")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return "", fmt.Errorf("apple: private key: %w", err)
	}
	token := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.RegisteredClaims{
		Issuer: c.TeamID, Subject: c.ClientID, Audience: jwt.ClaimStrings{"https://appleid.apple.com"},
		IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(5 * time.Minute)),
	})
	token.Header["kid"] = c.KeyID
	return token.SignedString(key)
}

type cachedProvider struct {
	updated  time.Time
	provider *oidc.Provider
}

// discovered keeps one discovery document (and its cached JWKS) per provider until the settings change.
var discovered sync.Map

func (m *module) oidcProvider(ctx context.Context, c providerConfig) (*oidc.Provider, error) {
	if cached, ok := discovered.Load(c.Provider); ok && cached.(cachedProvider).updated.Equal(c.Updated) {
		return cached.(cachedProvider).provider, nil
	}
	discoveryCtx := ctx
	if c.multiTenant() {
		discoveryCtx = oidc.InsecureIssuerURLContext(ctx, c.issuer())
	}
	p, err := oidc.NewProvider(oidc.ClientContext(discoveryCtx, m.httpClient), c.issuer())
	if err != nil {
		return nil, err
	}
	discovered.Store(c.Provider, cachedProvider{updated: c.Updated, provider: p})
	return p, nil
}

func (m *module) oauth2Config(ctx context.Context, c providerConfig) (*oauth2.Config, *oidc.Provider, error) {
	p, err := m.oidcProvider(ctx, c)
	if err != nil {
		return nil, nil, err
	}
	secret := c.ClientSecret
	scopes := []string{oidc.ScopeOpenID, "email", "profile"}
	if c.Provider == "apple" {
		if secret, err = appleClientSecret(c, time.Now()); err != nil {
			return nil, nil, err
		}
		scopes = []string{oidc.ScopeOpenID, "name", "email"}
	}
	if c.Provider == "microsoft" {
		scopes = append(scopes, "User.Read")
	}
	return &oauth2.Config{
		ClientID: c.ClientID, ClientSecret: secret, Endpoint: p.Endpoint(), Scopes: scopes,
		RedirectURL: m.appURL + "/api/auth/oauth2/" + c.Provider + "/callback",
	}, p, nil
}

type oauthState struct {
	Verifier string `json:"verifier"`
	Nonce    string `json:"nonce"`
	FlowHash string `json:"flow_hash"`
	Redirect string `json:"redirect"`
	Link     bool   `json:"link"`
	// SessionOnly carries an unchecked "Remember me" across the provider redirect.
	SessionOnly bool `json:"session_only,omitempty"`
	Native      bool `json:"native,omitempty"`
}

// oauth2Start stores state, PKCE verifier and nonce, binds the flow to this browser with a cookie and returns the provider URL.
func (m *module) oauth2Start(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Redirect   string `json:"redirect"`
		Link       bool   `json:"link"`
		Persistent *bool  `json:"persistent"`
		Native     bool   `json:"native"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	ctx := r.Context()
	c, err := loadProvider(ctx, m.db, m.tokens.Secret, r.PathValue("provider"))
	if isNoRows(err) || err == nil && !c.Enabled {
		return httpx.ErrNotFound
	}
	if err != nil {
		return err
	}
	linkUser := ""
	if body.Link {
		p, err := auth.Require(ctx)
		if err != nil {
			return err
		}
		linkUser = p.UserID
		// A stolen session must not be able to add a way in that survives a password reset.
		var hasPassword bool
		if err := m.db.QueryRow(ctx, `SELECT password_hash <> '' FROM users WHERE id = $1`, p.UserID).Scan(&hasPassword); err != nil {
			return err
		}
		if hasPassword {
			if err := auth.RequireRecentReauth(ctx, m.db, p); err != nil {
				return err
			}
		}
	}
	if !safeRedirect.MatchString(body.Redirect) {
		body.Redirect = ""
	}
	cfg, _, err := m.oauth2Config(ctx, c)
	if err != nil {
		slog.Error("authn: OAuth2 provider unavailable", "provider", c.Provider, "error", err)
		return httpx.NewError(http.StatusBadGateway, "The sign-in provider is not reachable.")
	}
	flow := ids.Secret(32)
	state := oauthState{Verifier: oauth2.GenerateVerifier(), Nonce: ids.Secret(32), FlowHash: ids.Hash(flow), Redirect: body.Redirect, Link: body.Link,
		SessionOnly: body.Persistent != nil && !*body.Persistent, Native: body.Native}
	data, _ := json.Marshal(state)
	stateID, err := insertChallenge(ctx, m.db, "oauth2_state", linkUser, c.Provider, data)
	if err != nil {
		return err
	}
	options := []oauth2.AuthCodeOption{oauth2.S256ChallengeOption(state.Verifier), oidc.Nonce(state.Nonce)}
	if c.Provider == "apple" {
		options = append(options, oauth2.SetAuthURLParam("response_mode", "form_post"))
	}
	http.SetCookie(w, &http.Cookie{Name: flowCookie, Value: flow, Path: "/api/auth/oauth2", MaxAge: int(challengeTTL.Seconds()),
		HttpOnly: true, Secure: strings.HasPrefix(m.appURL, "https://"), SameSite: http.SameSiteLaxMode})
	return httpx.Respond(w, http.StatusOK, map[string]string{"url": cfg.AuthCodeURL(stateID, options...)}, nil)
}

type identityClaims struct {
	Subject       string          `json:"sub"`
	Email         string          `json:"email"`
	EmailVerified json.RawMessage `json:"email_verified"`
	GivenName     string          `json:"given_name"`
	FamilyName    string          `json:"family_name"`
	Name          string          `json:"name"`
	Nonce         string          `json:"nonce"`
	TenantID      string          `json:"tid"`
	// Optional Microsoft claim: the email domain is verified by its owner.
	EmailDomainOwnerVerified json.RawMessage `json:"xms_edov"`
	Picture                  string          `json:"picture"`
	accessToken              string
}

// verified accepts Apple's "true" string as well as a JSON boolean.
func (c identityClaims) verified() bool {
	return jsonTrue(c.EmailVerified)
}

func jsonTrue(raw json.RawMessage) bool {
	return strings.Trim(string(raw), `"`) == "true"
}

// microsoftConsumers is the tenant of personal Microsoft accounts, whose addresses Microsoft verifies.
const microsoftConsumers = "9188040d-6c67-4c5b-b112-36a304b66dad"

// newAccountEmailVerified decides whether an address may become a new verified account. Microsoft sends no email_verified:
// a single-tenant setup trusts its own directory, personal accounts are verified by Microsoft, and other tenants need xms_edov.
// Existing accounts are still never linked by a Microsoft address (nOAuth).
func newAccountEmailVerified(c providerConfig, claims identityClaims) bool {
	if c.Provider != "microsoft" {
		return claims.verified()
	}
	return !c.multiTenant() || claims.TenantID == microsoftConsumers || jsonTrue(claims.EmailDomainOwnerVerified)
}

type oauthError string

func (e oauthError) Error() string { return string(e) }

// oauth2Callback verifies the provider's answer and hands the browser a one-time ticket; it never signs in by itself.
func (m *module) oauth2Callback(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	provider := r.PathValue("provider")
	appURL := m.appURL
	errorPage := appURL + "/auth/login?"
	fail := func(code string, err error) error {
		if err != nil {
			slog.Warn("authn: OAuth2 sign-in failed", "provider", provider, "code", code, "error", err)
		}
		http.Redirect(w, r, errorPage+"oauth2Error="+url.QueryEscape(code), http.StatusFound)
		return nil
	}
	state, err := takeChallenge(ctx, m.db, "oauth2_state", r.FormValue("state"))
	if err != nil || state.Method != provider {
		return fail("failed", err)
	}
	var s oauthState
	json.Unmarshal(state.Data, &s)
	if s.Native {
		appURL = nativeAppScheme
	}
	errorPage = appURL + "/auth/login?"
	if s.Link {
		errorPage = appURL + "/account/settings?tab=security&"
	}
	if r.FormValue("error") != "" {
		return fail("failed", nil)
	}
	c, err := loadProvider(ctx, m.db, m.tokens.Secret, provider)
	if err != nil || !c.Enabled {
		return fail("failed", err)
	}
	claims, err := m.exchange(ctx, c, r.FormValue("code"), s)
	if err != nil {
		return fail("failed", err)
	}
	if c.Provider == "apple" {
		var user struct {
			Name struct {
				FirstName string `json:"firstName"`
				LastName  string `json:"lastName"`
			} `json:"name"`
		}
		if json.Unmarshal([]byte(r.FormValue("user")), &user) == nil {
			claims.GivenName, claims.FamilyName = user.Name.FirstName, user.Name.LastName
		}
	}
	if s.Link {
		// Linking finishes in the browser that started it (flow cookie), so a provider URL sent to someone else can't link their identity.
		data, _ := json.Marshal(linkTicket{FlowHash: s.FlowHash, Link: true, Subject: claims.Subject, Email: claims.Email})
		ticket, err := insertChallenge(ctx, m.db, "oauth2", state.User, c.Provider, data)
		if err != nil {
			return fail("failed", err)
		}
		http.Redirect(w, r, appURL+"/account/settings?tab=security&oauth2Link="+url.QueryEscape(ticket), http.StatusFound)
		return nil
	}
	userID, err := m.resolveIdentity(r, c, claims)
	var code oauthError
	if errors.As(err, &code) {
		return fail(string(code), nil)
	}
	if err != nil {
		return fail("failed", err)
	}
	data, _ := json.Marshal(linkTicket{FlowHash: s.FlowHash})
	ticket, err := insertChallenge(ctx, m.db, "oauth2", userID, c.Provider, data)
	if err != nil {
		return fail("failed", err)
	}
	target := appURL + "/auth/login?oauth2=" + url.QueryEscape(ticket)
	if s.Redirect != "" {
		target += "&redirect=" + url.QueryEscape(s.Redirect)
	}
	if s.SessionOnly {
		target += "&persistent=0"
	}
	http.Redirect(w, r, target, http.StatusFound)
	return nil
}

func (m *module) exchange(ctx context.Context, c providerConfig, code string, s oauthState) (identityClaims, error) {
	var claims identityClaims
	cfg, p, err := m.oauth2Config(ctx, c)
	if err != nil {
		return claims, err
	}
	token, err := cfg.Exchange(oidc.ClientContext(ctx, m.httpClient), code, oauth2.VerifierOption(s.Verifier))
	if err != nil {
		return claims, err
	}
	raw, ok := token.Extra("id_token").(string)
	if !ok {
		return claims, errors.New("no id_token in the token response")
	}
	idToken, err := p.Verifier(&oidc.Config{ClientID: c.ClientID, SkipIssuerCheck: c.multiTenant()}).Verify(ctx, raw)
	if err != nil {
		return claims, err
	}
	if err := idToken.Claims(&claims); err != nil {
		return claims, err
	}
	claims.accessToken = token.AccessToken
	if subtle.ConstantTimeCompare([]byte(claims.Nonce), []byte(s.Nonce)) != 1 {
		return claims, errors.New("nonce mismatch")
	}
	if c.multiTenant() && !microsoftIssuerMatches(idToken.Issuer, claims.TenantID) {
		return claims, errors.New("issuer does not match the tenant")
	}
	if claims.Subject == "" {
		return claims, errors.New("id_token without subject")
	}
	return claims, nil
}

// resolveIdentity finds or links the account of a provider identity, or creates one when registration is open.
// Email linking needs a provider-verified address and a verified local account, and never happens for Microsoft,
// whose email claim is not verified (nOAuth).
func (m *module) resolveIdentity(r *http.Request, c providerConfig, claims identityClaims) (string, error) {
	ctx := r.Context()
	provider := c.Provider
	var owner string
	err := m.db.QueryRow(ctx, `SELECT "user" FROM user_identities WHERE provider = $1 AND subject = $2`, provider, claims.Subject).Scan(&owner)
	if err == nil {
		return owner, nil
	}
	if !isNoRows(err) {
		return "", err
	}
	email := platformmail.NormalizeAddress(claims.Email)
	if email != "" && claims.verified() && provider != "microsoft" {
		existing, err := findAccountByEmail(ctx, m.db, email)
		if err == nil {
			if !existing.Verified {
				return "", oauthError("account_exists")
			}
			return existing.ID, m.insertIdentity(ctx, m.db, existing.ID, provider, claims)
		}
		if !isNoRows(err) {
			return "", err
		}
	}
	var allowed bool
	if err := m.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM settings WHERE allow_registration)`).Scan(&allowed); err != nil {
		return "", err
	}
	if !allowed {
		return "", oauthError("registration_disabled")
	}
	// New accounts need an address the provider verified: without one they could never pass checkAccess.
	if !platformmail.ValidAddress(email) || !newAccountEmailVerified(c, claims) {
		return "", oauthError("email_unverified")
	}
	if blocked, err := blocklist.EmailBlocked(ctx, m.db, email); err != nil || blocked {
		return "", oauthError("email_blocked")
	}
	if taken, err := emailTaken(ctx, m.db, email, ""); err != nil || taken {
		return "", oauthError("account_exists")
	}
	firstname, name := claims.GivenName, claims.FamilyName
	if firstname == "" && name == "" {
		firstname = claims.Name
	}
	if protected, err := blocklist.NameProtected(ctx, m.db, firstname+" "+name); err != nil {
		return "", err
	} else if protected {
		firstname, name = "", ""
	}
	userID := ids.New()
	err = pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO users (id, email, username, firstname, name, verified, password_hash, token_key) VALUES ($1, $2, $3, $4, $5, true, '', $6)`,
			userID, email, m.generateUsername(r), strings.TrimSpace(firstname), strings.TrimSpace(name), newTokenKey()); err != nil {
			return err
		}
		return m.insertIdentity(ctx, tx, userID, provider, claims)
	})
	if err == nil {
		m.importAvatar(ctx, provider, userID, claims)
	}
	return userID, err
}

func (m *module) insertIdentity(ctx context.Context, q db.Querier, userID, provider string, claims identityClaims) error {
	_, err := q.Exec(ctx, `INSERT INTO user_identities (id, "user", provider, subject, email) VALUES ($1, $2, $3, $4, $5)`,
		ids.New(), userID, provider, claims.Subject, platformmail.NormalizeAddress(claims.Email))
	if db.IsUnique(err, "user_identities") {
		return oauthError("already_linked")
	}
	return err
}

// oauth2Finish signs in with the ticket, but only in the browser that started the flow (blocks login CSRF).
func (m *module) oauth2Finish(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Ticket string `json:"ticket"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	ctx := r.Context()
	cookie, err := r.Cookie(flowCookie)
	if err != nil {
		return errFailedAuth
	}
	http.SetCookie(w, &http.Cookie{Name: flowCookie, Path: "/api/auth/oauth2", MaxAge: -1, HttpOnly: true,
		Secure: strings.HasPrefix(m.appURL, "https://"), SameSite: http.SameSiteLaxMode})
	ticket, err := takeChallenge(ctx, m.db, "oauth2", body.Ticket)
	if isNoRows(err) {
		return errFailedAuth
	}
	if err != nil {
		return err
	}
	var data linkTicket
	json.Unmarshal(ticket.Data, &data)
	if data.Link || subtle.ConstantTimeCompare([]byte(ids.Hash(cookie.Value)), []byte(data.FlowHash)) != 1 {
		return errFailedAuth
	}
	user, err := findAccount(ctx, m.db, ticket.User)
	if err != nil {
		return errFailedAuth
	}
	if lockout.IsLocked(ctx, m.db, user.ID) {
		return lockout.ErrLocked
	}
	if err := checkAccess(user); err != nil {
		return err
	}
	return m.firstFactorDone(w, r, user, "oauth2:"+ticket.Method)
}

type linkTicket struct {
	FlowHash string `json:"flow_hash"`
	Link     bool   `json:"link,omitempty"`
	Subject  string `json:"subject,omitempty"`
	Email    string `json:"email,omitempty"`
}

// oauth2FinishLink links the identity of a link ticket to the signed-in account that started the flow in this browser.
func (m *module) oauth2FinishLink(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	var body struct {
		Ticket string `json:"ticket"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	ctx := r.Context()
	cookie, err := r.Cookie(flowCookie)
	if err != nil {
		return errFailedAuth
	}
	http.SetCookie(w, &http.Cookie{Name: flowCookie, Path: "/api/auth/oauth2", MaxAge: -1, HttpOnly: true,
		Secure: strings.HasPrefix(m.appURL, "https://"), SameSite: http.SameSiteLaxMode})
	ticket, err := takeChallenge(ctx, m.db, "oauth2", body.Ticket)
	if isNoRows(err) {
		return errFailedAuth
	}
	if err != nil {
		return err
	}
	var data linkTicket
	json.Unmarshal(ticket.Data, &data)
	if !data.Link || ticket.User != p.UserID || subtle.ConstantTimeCompare([]byte(ids.Hash(cookie.Value)), []byte(data.FlowHash)) != 1 {
		return errFailedAuth
	}
	var owner string
	err = m.db.QueryRow(ctx, `SELECT "user" FROM user_identities WHERE provider = $1 AND subject = $2`, ticket.Method, data.Subject).Scan(&owner)
	if err == nil && owner != p.UserID {
		return httpx.NewError(http.StatusConflict, "This sign-in is already linked to another account.").Field("ticket", "already_linked", "Already linked to another account.")
	}
	if err == nil {
		return httpx.NoContent(w, nil)
	}
	if !isNoRows(err) {
		return err
	}
	var code oauthError
	if err := m.insertIdentity(ctx, m.db, p.UserID, ticket.Method, identityClaims{Subject: data.Subject, Email: data.Email}); errors.As(err, &code) {
		return httpx.NewError(http.StatusConflict, "This provider is already linked.").Field("ticket", string(code), "Already linked.")
	} else if err != nil {
		return err
	}
	m.announceAccount(ctx, p.UserID, "identities")
	return httpx.NoContent(w, nil)
}
