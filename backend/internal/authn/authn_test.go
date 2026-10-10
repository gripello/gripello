package authn

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"gripello/internal/platform"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/captcha"
	"gripello/internal/platform/events"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/testapp"
)

const testPassword = "pw12345678"

type fixture struct {
	t       *testing.T
	app     *platform.App
	handler http.Handler
	hash    string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	app := testapp.App(t)
	Register(app)
	hash, err := hashPassword(testPassword)
	if err != nil {
		t.Fatal(err)
	}
	return &fixture{t: t, app: app, handler: testapp.Handler(app), hash: hash}
}

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.app.DB.Exec(context.Background(), sql, args...); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
}

func (f *fixture) count(sql string, args ...any) int {
	f.t.Helper()
	var n int
	if err := f.app.DB.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return n
}

func (f *fixture) user(email string) string {
	f.t.Helper()
	id := ids.New()
	username := strings.Split(email, "@")[0]
	f.exec(`INSERT INTO users (id, email, username, password_hash, token_key, verified) VALUES ($1, $2, $3, $4, $5, true)`,
		id, email, username, f.hash, newTokenKey())
	return id
}

// legacyToken is a token from before sessions existed (no sid).
func (f *fixture) legacyToken(userID string) string {
	f.t.Helper()
	user, err := findAccount(context.Background(), f.app.DB, userID)
	if err != nil {
		f.t.Fatal(err)
	}
	token, err := f.app.Tokens.Sign(userID, user.TokenKey, "")
	if err != nil {
		f.t.Fatal(err)
	}
	return token
}

func (f *fixture) send(method, path, token string, body any, headers ...string) (int, map[string]any) {
	f.t.Helper()
	payload, _ := json.Marshal(body)
	req := httptest.NewRequest(method, "/api"+path, strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0")
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	rec := httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	result := map[string]any{}
	json.Unmarshal(rec.Body.Bytes(), &result)
	return rec.Code, result
}

func (f *fixture) login(identity, password string) (int, map[string]any) {
	f.t.Helper()
	return f.send(http.MethodPost, "/auth/login", "", map[string]string{"identity": identity, "password": password})
}

func (f *fixture) loginToken(email string) string {
	f.t.Helper()
	status, body := f.login(email, testPassword)
	token, _ := body["token"].(string)
	if status != http.StatusOK || token == "" {
		f.t.Fatalf("login %s = %d %v", email, status, body)
	}
	return token
}

func sidOf(token string) string {
	var claims auth.Claims
	jwt.NewParser().ParseUnverified(token, &claims)
	return claims.SessionID
}

func (f *fixture) enableTOTP(token string) ([]byte, []any) {
	f.t.Helper()
	status, setup := f.send(http.MethodPost, "/me/totp/setup", token, map[string]string{"password": testPassword})
	if status != http.StatusOK {
		f.t.Fatalf("setup = %d %v", status, setup)
	}
	secret := setup["secret"].(string)
	key, _ := decodeTOTPSecret(secret)
	code := totpCode(key, time.Now().Unix()/totpPeriod, totpDigits)
	status, enabled := f.send(http.MethodPost, "/me/totp", token, map[string]string{"secret": secret, "code": code, "password": testPassword})
	if status != http.StatusOK {
		f.t.Fatalf("enable = %d %v", status, enabled)
	}
	return key, enabled["recoveryCodes"].([]any)
}

func TestTOTPMatchesRFC6238(t *testing.T) {
	key := []byte("12345678901234567890")
	vectors := map[int64]string{59: "94287082", 1111111109: "07081804", 1234567890: "89005924", 20000000000: "65353130"}
	for unix, want := range vectors {
		if got := totpCode(key, unix/totpPeriod, 8); got != want {
			t.Errorf("totp(%d) = %s, want %s", unix, got, want)
		}
	}
	now := time.Unix(1234567890, 0)
	current := now.Unix() / totpPeriod
	code := totpCode(key, current+1, totpDigits)
	if matchTOTP(key, code, now, 0) != current+1 {
		t.Error("next step not accepted")
	}
	if matchTOTP(key, code, now, current+1) != 0 {
		t.Error("used step accepted again")
	}
	if matchTOTP(key, totpCode(key, current+2, totpDigits), now, 0) != 0 {
		t.Error("code two steps ahead accepted")
	}
}

func TestPasswordLogin(t *testing.T) {
	f := newFixture(t)
	id := f.user("plain@example.com")

	status, body := f.login("PLAIN@example.com", testPassword)
	record, _ := body["record"].(map[string]any)
	if status != http.StatusOK || body["token"] == "" || record["id"] != id {
		t.Fatalf("login by email = %d %v", status, body)
	}
	if _, leaked := record["password_hash"]; leaked {
		t.Error("record leaks the password hash")
	}
	if status, _ := f.login("Plain", testPassword); status != http.StatusOK {
		t.Errorf("login by username = %d", status)
	}
	if status, body := f.login("plain@example.com", "wrong"); status != http.StatusBadRequest || body["message"] != "Failed to authenticate." {
		t.Errorf("wrong password = %d %v", status, body)
	}

	f.exec(`UPDATE users SET verified = false WHERE id = $1`, id)
	if status, body := f.login("plain@example.com", testPassword); status != http.StatusForbidden || !strings.Contains(body["message"].(string), "not verified") {
		t.Errorf("unverified = %d %v", status, body)
	}
	f.exec(`UPDATE users SET verified = true, suspended_until = now() + interval '1 day' WHERE id = $1`, id)
	if status, body := f.login("plain@example.com", testPassword); status != http.StatusForbidden || !strings.Contains(body["message"].(string), "suspended") {
		t.Errorf("suspended = %d %v", status, body)
	}
}

func TestLoginEmitsAuditEvents(t *testing.T) {
	f := newFixture(t)
	id := f.user("audited@example.com")
	f.loginToken("audited@example.com")
	f.login("audited@example.com", "wrong")
	f.login("ghost@example.com", "wrong")

	if n := f.count(`SELECT count(*) FROM events WHERE topic = 'audit' AND kind = $1 AND payload->>'user' = $2 AND payload->>'method' = 'password'`, KindLogin, id); n != 1 {
		t.Errorf("%d login events", n)
	}
	if n := f.count(`SELECT count(*) FROM events WHERE topic = 'audit' AND kind = $1`, KindLoginFailed); n != 2 {
		t.Errorf("%d failure events", n)
	}
	if n := f.count(`SELECT count(*) FROM events WHERE kind = $1 AND payload->>'label' = 'g***@example.com'`, KindLoginFailed); n != 1 {
		t.Error("unknown identity not masked")
	}
}

func TestTOTPSecondFactor(t *testing.T) {
	f := newFixture(t)
	f.user("totp@example.com")
	key, recovery := f.enableTOTP(f.loginToken("totp@example.com"))
	if len(recovery) != recoveryCodeCount {
		t.Fatalf("got %d recovery codes", len(recovery))
	}

	status, body := f.login("totp@example.com", testPassword)
	mfaID, _ := body["mfaId"].(string)
	if status != http.StatusUnauthorized || mfaID == "" {
		t.Fatalf("password step = %d %v", status, body)
	}
	if methods, _ := json.Marshal(body["methods"]); string(methods) != `["totp","recovery"]` {
		t.Errorf("methods = %s", methods)
	}
	if status, _ := f.send(http.MethodPost, "/auth/totp", "", map[string]string{"mfaId": mfaID, "code": "000000"}); status != http.StatusBadRequest {
		t.Errorf("wrong code = %d", status)
	}
	code := totpCode(key, time.Now().Unix()/totpPeriod+1, totpDigits)
	status, body = f.send(http.MethodPost, "/auth/totp", "", map[string]string{"mfaId": mfaID, "code": code})
	if status != http.StatusOK || body["token"] == "" {
		t.Fatalf("totp step = %d %v", status, body)
	}
	if status, _ := f.send(http.MethodPost, "/auth/totp", "", map[string]string{"mfaId": mfaID, "code": code}); status != http.StatusBadRequest {
		t.Errorf("reused mfaId = %d", status)
	}
}

func TestMFAChallengeExpires(t *testing.T) {
	f := newFixture(t)
	f.user("slow@example.com")
	key, _ := f.enableTOTP(f.loginToken("slow@example.com"))
	_, body := f.login("slow@example.com", testPassword)
	f.exec(`UPDATE mfa_challenges SET created = now() - interval '11 minutes'`)
	code := totpCode(key, time.Now().Unix()/totpPeriod+1, totpDigits)
	if status, body := f.send(http.MethodPost, "/auth/totp", "", map[string]string{"mfaId": body["mfaId"].(string), "code": code}); status != http.StatusBadRequest || !strings.Contains(body["message"].(string), "MFA session") {
		t.Errorf("expired challenge = %d %v", status, body)
	}
}

func TestRecoveryCodeIsSingleUse(t *testing.T) {
	f := newFixture(t)
	id := f.user("recover@example.com")
	_, recovery := f.enableTOTP(f.loginToken("recover@example.com"))
	code := strings.ToUpper(recovery[0].(string))

	for i, want := range []int{http.StatusOK, http.StatusBadRequest} {
		_, body := f.login("recover@example.com", testPassword)
		status, _ := f.send(http.MethodPost, "/auth/recovery", "", map[string]string{"mfaId": body["mfaId"].(string), "code": code})
		if status != want {
			t.Errorf("attempt %d = %d, want %d", i, status, want)
		}
	}
	if left := recoveryCodesLeft(context.Background(), f.app.DB, id); left != recoveryCodeCount-1 {
		t.Errorf("%d codes left", left)
	}
}

func TestRecoveryCodeKeptWhenSignInFails(t *testing.T) {
	f := newFixture(t)
	id := f.user("kept@example.com")
	_, recovery := f.enableTOTP(f.loginToken("kept@example.com"))
	_, body := f.login("kept@example.com", testPassword)
	f.exec(`UPDATE users SET suspended_until = now() + interval '1 hour' WHERE id = $1`, id)

	if status, res := f.send(http.MethodPost, "/auth/recovery", "", map[string]string{"mfaId": body["mfaId"].(string), "code": recovery[0].(string)}); status != http.StatusForbidden {
		t.Errorf("suspended sign-in = %d %v", status, res)
	}
	if left := recoveryCodesLeft(context.Background(), f.app.DB, id); left != recoveryCodeCount {
		t.Errorf("%d codes left after a failed sign-in", left)
	}
}

func TestDeletingLastFactorNeedsPasswordAndDropsRecoveryCodes(t *testing.T) {
	f := newFixture(t)
	id := f.user("off@example.com")
	token := f.loginToken("off@example.com")
	f.enableTOTP(token)
	factors, _ := listFactors(context.Background(), f.app.DB, id)

	if status, _ := f.send(http.MethodDelete, "/me/mfa/"+factors[0].ID, token, map[string]string{"password": "wrong"}); status != http.StatusBadRequest {
		t.Errorf("wrong password = %d", status)
	}
	if status, _ := f.send(http.MethodDelete, "/me/mfa/"+factors[0].ID, token, map[string]string{"password": testPassword}); status != http.StatusNoContent {
		t.Errorf("delete = %d", status)
	}
	if recoveryCodesLeft(context.Background(), f.app.DB, id) != 0 {
		t.Error("recovery codes kept")
	}
	if status, _ := f.login("off@example.com", testPassword); status != http.StatusOK {
		t.Errorf("login after disable = %d", status)
	}
}

func TestListFactorsAndRegenerateRecoveryCodes(t *testing.T) {
	f := newFixture(t)
	f.user("list@example.com")
	token := f.loginToken("list@example.com")
	if status, _ := f.send(http.MethodPost, "/me/recovery-codes", token, map[string]string{"password": testPassword}); status != http.StatusBadRequest {
		t.Errorf("codes without factors = %d", status)
	}
	f.enableTOTP(token)
	status, body := f.send(http.MethodGet, "/me/mfa", token, nil)
	factors, _ := body["factors"].([]any)
	if status != http.StatusOK || len(factors) != 1 || body["recoveryCodesLeft"] != float64(recoveryCodeCount) {
		t.Fatalf("list = %d %v", status, body)
	}
	if strings.Contains(mustJSON(body), "secret") {
		t.Error("factor list leaks the secret")
	}
	if status, body := f.send(http.MethodPost, "/me/recovery-codes", token, map[string]string{"password": testPassword}); status != http.StatusOK || len(body["recoveryCodes"].([]any)) != recoveryCodeCount {
		t.Errorf("regenerate = %d %v", status, body)
	}
}

func TestSessionsTrackAndRevokeLogins(t *testing.T) {
	f := newFixture(t)
	id := f.user("session@example.com")
	first, second := f.loginToken("session@example.com"), f.loginToken("session@example.com")
	sid := sidOf(first)
	if n := f.count(`SELECT count(*) FROM sessions WHERE id = $1 AND "user" = $2 AND user_agent LIKE '%Firefox%'`, sid, id); n != 1 {
		t.Fatalf("session %q not stored", sid)
	}

	status, refreshed := f.send(http.MethodPost, "/auth/refresh", first, nil)
	if status != http.StatusOK || sidOf(refreshed["token"].(string)) != sid {
		t.Errorf("refresh = %d %v", status, refreshed)
	}

	status, list := f.send(http.MethodGet, "/me/sessions", second, nil)
	if items, _ := list["items"].([]any); status != http.StatusOK || len(items) != 2 {
		t.Errorf("sessions = %d %v", status, list)
	}
	other := f.user("other@example.com")
	if status, _ := f.send(http.MethodDelete, "/me/sessions/"+sid, f.loginToken("other@example.com"), nil); status != http.StatusNotFound {
		t.Errorf("revoking someone else's session = %d", status)
	}
	if status, _ := f.send(http.MethodDelete, "/me/sessions/"+sid, second, nil); status != http.StatusNoContent {
		t.Fatalf("revoke = %d", status)
	}
	if status, _ := f.send(http.MethodPost, "/auth/refresh", first, nil); status != http.StatusUnauthorized {
		t.Errorf("revoked token refresh = %d", status)
	}
	f.loginToken("session@example.com")
	if status, _ := f.send(http.MethodPost, "/me/sessions/sign-out-others", second, nil); status != http.StatusNoContent {
		t.Errorf("sign out others = %d", status)
	}
	if n := f.count(`SELECT count(*) FROM sessions WHERE "user" = $1`, id); n != 1 {
		t.Errorf("%d sessions left", n)
	}
	if status, _ := f.send(http.MethodPost, "/auth/logout", second, nil); status != http.StatusNoContent {
		t.Errorf("logout = %d", status)
	}
	if n := f.count(`SELECT count(*) FROM sessions WHERE "user" = $1`, id); n != 0 {
		t.Errorf("%d sessions after logout", n)
	}
	if n := f.count(`SELECT count(*) FROM sessions WHERE "user" = $1`, other); n != 1 {
		t.Errorf("other user lost sessions: %d", n)
	}
}

func TestRevokedSessionsReachTheBus(t *testing.T) {
	f := newFixture(t)
	f.user("live@example.com")
	first, second := f.loginToken("live@example.com"), f.loginToken("live@example.com")
	var mu sync.Mutex
	var revoked []string
	f.app.Bus.Subscribe(TopicSessionRevoked, func(e events.Event) {
		var payload SessionRevoked
		json.Unmarshal(e.Payload, &payload)
		mu.Lock()
		revoked = append(revoked, payload.Session)
		mu.Unlock()
	})
	f.send(http.MethodDelete, "/me/sessions/"+sidOf(first), second, nil)
	testapp.WaitFor(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(revoked) == 1 && revoked[0] == sidOf(first)
	})
}

func TestLegacyTokenStartsSessionOnRefresh(t *testing.T) {
	f := newFixture(t)
	id := f.user("legacy@example.com")
	status, body := f.send(http.MethodPost, "/auth/refresh", f.legacyToken(id), nil)
	if status != http.StatusOK || sidOf(body["token"].(string)) == "" {
		t.Errorf("refresh = %d %v", status, body)
	}
}

func TestPasswordChangeEndsEverySession(t *testing.T) {
	f := newFixture(t)
	id := f.user("change@example.com")
	old, other := f.loginToken("change@example.com"), f.loginToken("change@example.com")

	status, body := f.send(http.MethodPost, "/me/password", old, map[string]string{"oldPassword": "wrong", "password": "another-pass-1", "passwordConfirm": "another-pass-1"})
	if status != http.StatusBadRequest || !strings.Contains(mustJSON(body), "validation_invalid_old_password") {
		t.Fatalf("wrong old password = %d %v", status, body)
	}
	status, body = f.send(http.MethodPost, "/me/password", old, map[string]string{"oldPassword": testPassword, "password": "another-pass-1", "passwordConfirm": "another-pass-1"})
	if status != http.StatusOK || body["token"] == "" {
		t.Fatalf("change = %d %v", status, body)
	}
	if status, _ := f.send(http.MethodGet, "/me/sessions", other, nil); status != http.StatusUnauthorized {
		t.Errorf("old session still valid = %d", status)
	}
	if n := f.count(`SELECT count(*) FROM sessions WHERE "user" = $1`, id); n != 1 {
		t.Errorf("%d sessions after the change", n)
	}
	if status, _ := f.login("change@example.com", "another-pass-1"); status != http.StatusOK {
		t.Errorf("login with the new password = %d", status)
	}
}

func TestLoginLockoutPerAccount(t *testing.T) {
	f := newFixture(t)
	id := f.user("locked@example.com")

	for range lockoutMaxFailures {
		if status, _ := f.login("locked@example.com", "wrong"); status != http.StatusBadRequest {
			t.Fatalf("failure = %d", status)
		}
	}
	if status, _ := f.login("locked@example.com", testPassword); status != http.StatusTooManyRequests {
		t.Errorf("locked login = %d", status)
	}

	for range lockoutMaxFailures {
		f.login("nobody@example.com", "wrong")
	}
	if status, body := f.login("nobody@example.com", "wrong"); status != http.StatusTooManyRequests {
		t.Errorf("unknown identity = %d %v", status, body)
	}

	f.exec(`UPDATE login_lockouts SET locked_until = now() - interval '1 minute'`)
	if status, _ := f.login("locked@example.com", testPassword); status != http.StatusOK {
		t.Errorf("login after lock expiry = %d", status)
	}
	if n := f.count(`SELECT count(*) FROM login_lockouts WHERE key = $1`, id); n != 0 {
		t.Error("lockout kept after success")
	}
}

func TestTOTPFailuresCountTowardLockout(t *testing.T) {
	f := newFixture(t)
	f.user("guess@example.com")
	f.enableTOTP(f.loginToken("guess@example.com"))

	_, body := f.login("guess@example.com", testPassword)
	mfaID := body["mfaId"].(string)
	for range lockoutMaxFailures {
		f.send(http.MethodPost, "/auth/totp", "", map[string]string{"mfaId": mfaID, "code": "000000"})
	}
	if status, _ := f.send(http.MethodPost, "/auth/totp", "", map[string]string{"mfaId": mfaID, "code": "000000"}); status != http.StatusTooManyRequests {
		t.Errorf("after %d guesses = %d", lockoutMaxFailures, status)
	}
}

func TestParallelFailuresStillLock(t *testing.T) {
	f := newFixture(t)
	var wg sync.WaitGroup
	for range lockoutMaxFailures {
		wg.Go(func() {
			if _, err := countLoginFailure(context.Background(), f.app.DB, "parallel"); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if !isLockedOut(context.Background(), f.app.DB, "parallel") {
		t.Error("parallel failures were not all counted")
	}
}

func TestTOTPStepClaimedOnce(t *testing.T) {
	f := newFixture(t)
	id := f.user("replay@example.com")
	f.enableTOTP(f.loginToken("replay@example.com"))
	factors, _ := listFactors(context.Background(), f.app.DB, id)
	step := factors[0].LastStep + 1

	var claimed atomic.Int32
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			if claimTOTPStep(context.Background(), f.app.DB, factors[0].ID, step) {
				claimed.Add(1)
			}
		})
	}
	wg.Wait()
	if claimed.Load() != 1 {
		t.Errorf("step claimed %d times", claimed.Load())
	}
}

func TestPasskeysUnavailableWhenAppURLIsAnIPAddress(t *testing.T) {
	app := testapp.App(t)
	app.Cfg.AppURL = "https://192.168.1.10:8443"
	Register(app)
	f := &fixture{t: t, app: app, handler: testapp.Handler(app)}
	status, body := f.send(http.MethodPost, "/auth/passkey/options", "", nil)
	if status != http.StatusServiceUnavailable || !strings.Contains(body["message"].(string), "not available") {
		t.Fatalf("options = %d %v", status, body)
	}
}

func TestPasskeyLoginRejectsUnknownCredential(t *testing.T) {
	f := newFixture(t)
	status, options := f.send(http.MethodPost, "/auth/passkey/options", "", nil)
	publicKey, _ := options["options"].(map[string]any)
	if status != http.StatusOK || publicKey["rpId"] != "localhost" || publicKey["challenge"] == "" {
		t.Fatalf("options = %d %v", status, options)
	}
	status, _ = f.send(http.MethodPost, "/auth/passkey", "", map[string]any{"ceremony": options["ceremony"], "credential": map[string]string{"id": "AAAA"}})
	if status != http.StatusBadRequest {
		t.Errorf("unknown credential = %d", status)
	}
	if status, body := f.send(http.MethodPost, "/auth/passkey", "", map[string]any{"ceremony": options["ceremony"]}); status != http.StatusBadRequest || !strings.Contains(body["message"].(string), "expired") {
		t.Errorf("reused ceremony = %d %v", status, body)
	}
}

func TestRenameOwnFactorOnly(t *testing.T) {
	f := newFixture(t)
	owner := f.user("named@example.com")
	f.user("stranger@example.com")
	ownerToken := f.loginToken("named@example.com")
	f.enableTOTP(ownerToken)
	factors, _ := listFactors(context.Background(), f.app.DB, owner)

	if status, _ := f.send(http.MethodPatch, "/me/mfa/"+factors[0].ID, f.loginToken("stranger@example.com"), map[string]string{"name": "Mine"}); status != http.StatusNotFound {
		t.Errorf("stranger rename = %d", status)
	}
	status, body := f.send(http.MethodPatch, "/me/mfa/"+factors[0].ID, ownerToken, map[string]string{"name": "  Work phone  "})
	if status != http.StatusOK || body["name"] != "Work phone" {
		t.Errorf("rename = %d %v", status, body)
	}
}

func TestSecondFactorMethodsFollowTheAccount(t *testing.T) {
	f := newFixture(t)
	id := f.user("methods@example.com")
	ctx := context.Background()
	f.exec(`INSERT INTO mfa_factors (id, "user", kind, credential_id) VALUES ($1, $2, 'passkey', 'cred')`, ids.New(), id)
	m := &module{db: f.app.DB}
	if got, _ := m.secondFactorMethods(ctx, id); strings.Join(got, ",") != "passkey" {
		t.Errorf("passkey only = %v", got)
	}
	f.enableTOTP(f.legacyToken(id))
	if got, _ := m.secondFactorMethods(ctx, id); strings.Join(got, ",") != "totp,passkey,recovery" {
		t.Errorf("all factors = %v", got)
	}
}

func TestAddingFactorsNeedsPassword(t *testing.T) {
	f := newFixture(t)
	f.user("hijack@example.com")
	token := f.loginToken("hijack@example.com")
	for _, path := range []string{"/me/totp/setup", "/me/totp", "/me/passkeys/options"} {
		if status, _ := f.send(http.MethodPost, path, token, map[string]string{"password": "wrong"}); status != http.StatusBadRequest {
			t.Errorf("%s with wrong password = %d", path, status)
		}
	}
	if status, _ := f.send(http.MethodPost, "/me/passkeys/options", token, map[string]string{"password": testPassword}); status != http.StatusOK {
		t.Errorf("passkey options with password = %d", status)
	}
}

func TestDisplayIPCompressesIPv6(t *testing.T) {
	for raw, want := range map[string]string{"0000:0000:0000:0000:0000:0000:0000:0001": "::1", "10.0.0.1": "10.0.0.1", "garbage": "garbage"} {
		if got := displayIP(raw); got != want {
			t.Errorf("displayIP(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestTruncateRunes(t *testing.T) {
	if got := truncateRunes("äöü", 2); got != "äö" {
		t.Fatalf("truncateRunes() = %q", got)
	}
	if got := truncateRunes("ab", 5); got != "ab" {
		t.Fatalf("truncateRunes() = %q", got)
	}
}

func capToken(secret, scope, jti string) string {
	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"scope": scope, "jti": jti, "exp": time.Now().Add(time.Minute).Unix()}).SignedString([]byte(secret))
	return token
}

func TestCaptchaGuardsLogin(t *testing.T) {
	f := newFixture(t)
	f.user("cap@example.com")
	t.Setenv("CAP_SECRET", "cap-secret")
	body := map[string]string{"identity": "cap@example.com", "password": testPassword}

	if status, res := f.send(http.MethodPost, "/auth/login", "", body); status != http.StatusBadRequest || !strings.Contains(res["message"].(string), "required") {
		t.Errorf("without token = %d %v", status, res)
	}
	if status, _ := f.send(http.MethodPost, "/auth/login", "", body, captcha.Header, capToken("cap-secret", "register", "a")); status != http.StatusBadRequest {
		t.Errorf("wrong scope = %d", status)
	}
	if status, _ := f.send(http.MethodPost, "/auth/login", "", body, captcha.Header, capToken("other", "login", "b")); status != http.StatusBadRequest {
		t.Errorf("wrong secret = %d", status)
	}
	token := capToken("cap-secret", "login", "c")
	if status, _ := f.send(http.MethodPost, "/auth/login", "", body, captcha.Header, token); status != http.StatusOK {
		t.Errorf("valid token = %d", status)
	}
	if status, res := f.send(http.MethodPost, "/auth/login", "", body, captcha.Header, token); status != http.StatusBadRequest || !strings.Contains(res["message"].(string), "already used") {
		t.Errorf("reused token = %d %v", status, res)
	}
}

var tokenInLink = regexp.MustCompile(`/auth/confirm-[a-z-]+/([A-Za-z0-9_.\-]+)`)

func (f *fixture) lastMailToken() (string, string) {
	f.t.Helper()
	mails := testapp.Mails(f.app)
	if len(mails) == 0 {
		f.t.Fatal("no mail sent")
	}
	last := mails[len(mails)-1]
	match := tokenInLink.FindStringSubmatch(last.Text)
	if match == nil {
		f.t.Fatalf("no link in %q", last.Text)
	}
	return match[1], last.To[0]
}

func TestPasswordResetFlow(t *testing.T) {
	f := newFixture(t)
	id := f.user("reset@example.com")
	f.exec(`UPDATE users SET language = 'es', firstname = 'Rita' WHERE id = $1`, id)
	session := f.loginToken("reset@example.com")
	for range lockoutMaxFailures {
		f.login("reset@example.com", "wrong")
	}

	if status, _ := f.send(http.MethodPost, "/auth/password-reset/request", "", map[string]string{"email": "nobody@example.com"}); status != http.StatusNoContent {
		t.Errorf("unknown email = %d", status)
	}
	if len(testapp.Mails(f.app)) != 0 {
		t.Fatal("mail sent for an unknown address")
	}
	if status, _ := f.send(http.MethodPost, "/auth/password-reset/request", "", map[string]string{"email": "reset@example.com"}); status != http.StatusNoContent {
		t.Fatalf("request = %d", status)
	}
	mails := testapp.Mails(f.app)
	if !strings.HasPrefix(mails[0].Subject, "Restablece tu contraseña") || !strings.Contains(mails[0].HTML, "http://localhost:3000/auth/confirm-password-reset/") {
		t.Errorf("mail = %q %s", mails[0].Subject, mails[0].Text)
	}
	token, _ := f.lastMailToken()

	if status, body := f.send(http.MethodPost, "/auth/password-reset/confirm", "", map[string]string{"token": token, "password": "short", "passwordConfirm": "short"}); status != http.StatusBadRequest || !strings.Contains(mustJSON(body), "validation_length_out_of_range") {
		t.Errorf("short password = %d %v", status, body)
	}
	if status, body := f.send(http.MethodPost, "/auth/password-reset/confirm", "", map[string]string{"token": token + "x", "password": "new-password-1", "passwordConfirm": "new-password-1"}); status != http.StatusBadRequest || !strings.Contains(mustJSON(body), "validation_invalid_token") {
		t.Errorf("tampered token = %d %v", status, body)
	}
	if status, _ := f.send(http.MethodPost, "/auth/password-reset/confirm", "", map[string]string{"token": token, "password": "new-password-1", "passwordConfirm": "new-password-1"}); status != http.StatusNoContent {
		t.Fatalf("confirm = %d", status)
	}
	if status, _ := f.send(http.MethodPost, "/auth/password-reset/confirm", "", map[string]string{"token": token, "password": "new-password-2", "passwordConfirm": "new-password-2"}); status != http.StatusBadRequest {
		t.Errorf("reused reset token = %d", status)
	}
	if status, _ := f.send(http.MethodGet, "/me/sessions", session, nil); status != http.StatusUnauthorized {
		t.Errorf("session survived the reset = %d", status)
	}
	if status, _ := f.login("reset@example.com", "new-password-1"); status != http.StatusOK {
		t.Errorf("login after reset (lockout cleared) = %d", status)
	}
}

func TestVerificationFlow(t *testing.T) {
	f := newFixture(t)
	id := f.user("verify@example.com")
	f.exec(`UPDATE users SET verified = false WHERE id = $1`, id)

	if status, _ := f.send(http.MethodPost, "/auth/verification/request", "", map[string]string{"email": "verify@example.com"}); status != http.StatusNoContent {
		t.Fatalf("request = %d", status)
	}
	token, to := f.lastMailToken()
	if to != "verify@example.com" {
		t.Errorf("sent to %s", to)
	}
	if status, _ := f.send(http.MethodPost, "/auth/verification/confirm", "", map[string]string{"token": token}); status != http.StatusNoContent {
		t.Fatalf("confirm = %d", status)
	}
	if status, _ := f.login("verify@example.com", testPassword); status != http.StatusOK {
		t.Errorf("login after verification = %d", status)
	}
	f.send(http.MethodPost, "/auth/verification/request", "", map[string]string{"email": "verify@example.com"})
	if len(testapp.Mails(f.app)) != 1 {
		t.Error("verified account got another verification mail")
	}
	t.Setenv("CAP_SECRET", "cap-secret")
	if status, _ := f.send(http.MethodPost, "/auth/verification/request", "", map[string]string{"email": "verify@example.com"}); status != http.StatusBadRequest {
		t.Errorf("request without captcha = %d", status)
	}
	if status, _ := f.send(http.MethodPost, "/auth/verification/request", "", map[string]string{"email": "verify@example.com"}, captcha.Header, capToken("cap-secret", "verification", "v1")); status != http.StatusNoContent {
		t.Errorf("request with captcha = %d", status)
	}
}

func TestUnknownIdentitiesCostABcryptRound(t *testing.T) {
	if cost, err := bcrypt.Cost(unknownAccountHash()); err != nil || cost != 10 {
		t.Fatalf("dummy hash cost = %d, %v", cost, err)
	}
	start := time.Now()
	if checkPassword("", "anything") {
		t.Fatal("an empty hash matched")
	}
	if time.Since(start) < time.Millisecond {
		t.Error("an unknown identity skipped bcrypt")
	}
}

func TestEmailChangeFlow(t *testing.T) {
	f := newFixture(t)
	id := f.user("before@example.com")
	f.user("taken@example.com")
	token := f.loginToken("before@example.com")

	if status, _ := f.send(http.MethodPost, "/auth/email-change/request", token, map[string]string{"newEmail": "taken@example.com"}); status != http.StatusNoContent {
		t.Errorf("taken email = %d", status)
	}
	if mails := testapp.Mails(f.app); len(mails) != 1 || mails[0].To[0] != "taken@example.com" || !strings.HasPrefix(mails[0].Subject, "You already have an account") {
		t.Errorf("taken address owner was not told: %v", mails)
	}
	if status, _ := f.send(http.MethodPost, "/auth/email-change/request", "", map[string]string{"newEmail": "after@example.com"}); status != http.StatusUnauthorized {
		t.Errorf("guest request = %d", status)
	}
	if status, _ := f.send(http.MethodPost, "/auth/email-change/request", token, map[string]string{"newEmail": "after@example.com"}); status != http.StatusNoContent {
		t.Fatalf("request = %d", status)
	}
	mailToken, to := f.lastMailToken()
	if to != "after@example.com" {
		t.Errorf("sent to %s", to)
	}
	if status, body := f.send(http.MethodPost, "/auth/email-change/confirm", "", map[string]string{"token": mailToken, "password": "wrong"}); status != http.StatusBadRequest || !strings.Contains(mustJSON(body), "validation_invalid_password") {
		t.Errorf("wrong password = %d %v", status, body)
	}
	if status, _ := f.send(http.MethodPost, "/auth/email-change/confirm", "", map[string]string{"token": mailToken, "password": testPassword}); status != http.StatusNoContent {
		t.Fatalf("confirm = %d", status)
	}
	if n := f.count(`SELECT count(*) FROM users WHERE id = $1 AND email = 'after@example.com'`, id); n != 1 {
		t.Error("email not changed")
	}
	if status, _ := f.send(http.MethodGet, "/me/sessions", token, nil); status != http.StatusUnauthorized {
		t.Errorf("session survived the email change = %d", status)
	}
}

func TestRegistration(t *testing.T) {
	f := newFixture(t)
	f.user("existing@example.com")
	body := map[string]string{"email": "new@example.com", "username": "newbie", "password": testPassword, "passwordConfirm": testPassword, "firstname": "Nia", "language": "de"}

	if status, _ := f.send(http.MethodPost, "/auth/register", "", body); status != http.StatusForbidden {
		t.Errorf("registration while disabled = %d", status)
	}
	f.exec(`INSERT INTO settings (id, allow_registration) VALUES ('platformsetting', true)`)

	invalid := map[string]string{"email": "not-an-email", "username": "x", "password": "short", "passwordConfirm": "other", "language": "xx"}
	status, res := f.send(http.MethodPost, "/auth/register", "", invalid)
	for _, code := range []string{`"email":{"code":"validation_is_email"`, `"username":{"code":"validation_length_out_of_range"`, `"password":{"code":"validation_length_out_of_range"`, `"passwordConfirm":{"code":"validation_values_mismatch"`, `"language":{"code":"validation_invalid_value"`} {
		if status != http.StatusBadRequest || !strings.Contains(mustJSON(res), code) {
			t.Errorf("invalid registration = %d, missing %s in %v", status, code, res)
		}
	}

	status, res = f.send(http.MethodPost, "/auth/register", "", body)
	if status != http.StatusAccepted || f.count(`SELECT count(*) FROM users WHERE username = 'newbie' AND email = 'new@example.com' AND NOT verified`) != 1 {
		t.Fatalf("register = %d %v", status, res)
	}
	mails := testapp.Mails(f.app)
	if len(mails) != 1 || mails[0].To[0] != "new@example.com" || !strings.Contains(mails[0].Text, "/auth/confirm-verification/") {
		t.Errorf("verification mail = %v", mails)
	}
	taken := map[string]string{"email": "existing@example.com", "password": testPassword, "passwordConfirm": testPassword}
	if status, _ := f.send(http.MethodPost, "/auth/register", "", taken); status != http.StatusAccepted {
		t.Errorf("taken address = %d, want the same answer as a free one", status)
	}
	if mails := testapp.Mails(f.app); len(mails) != 2 || mails[1].To[0] != "existing@example.com" || !strings.HasPrefix(mails[1].Subject, "You already have an account") {
		t.Errorf("owner of the taken address was not told: %v", mails)
	}
	if status, _ := f.login("new@example.com", testPassword); status != http.StatusForbidden {
		t.Errorf("unverified login = %d", status)
	}

	status, _ = f.send(http.MethodPost, "/auth/register", "", map[string]string{"email": "auto@example.com", "password": testPassword, "passwordConfirm": testPassword})
	if status != http.StatusAccepted || f.count(`SELECT count(*) FROM users WHERE email = 'auto@example.com' AND username ~ '^users\d{6}$'`) != 1 {
		t.Errorf("generated username = %d", status)
	}

	t.Setenv("CAP_SECRET", "cap-secret")
	body["email"], body["username"] = "capped@example.com", "capped"
	if status, _ := f.send(http.MethodPost, "/auth/register", "", body); status != http.StatusBadRequest {
		t.Errorf("registration without captcha = %d", status)
	}
	if status, _ := f.send(http.MethodPost, "/auth/register", "", body, captcha.Header, capToken("cap-secret", "register", "r1")); status != http.StatusAccepted {
		t.Errorf("registration with captcha = %d", status)
	}
}

func TestCleanupJobsKeepLiveRows(t *testing.T) {
	f := newFixture(t)
	f.exec(`INSERT INTO login_lockouts (id, key, failures, window_start) VALUES ($1, 'old', 3, now() - interval '1 hour'), ($2, 'fresh', 3, now())`, ids.New(), ids.New())
	f.exec(`INSERT INTO login_lockouts (id, key, window_start, locked_until) VALUES ($1, 'locked', now() - interval '1 hour', now() + interval '5 minutes')`, ids.New())
	id := f.user("idle@example.com")
	f.exec(`INSERT INTO sessions (id, "user", last_seen) VALUES ($1, $3, now() - interval '30 days'), ($2, $3, now())`, ids.New(), ids.New(), id)
	f.exec(`INSERT INTO mfa_challenges (id, kind, created) VALUES ('stale', 'passkey', now() - interval '11 minutes'), ('live', 'passkey', now())`)
	m := &module{db: f.app.DB, tokens: f.app.Tokens}
	ctx := context.Background()
	for _, prune := range []func(context.Context) error{m.pruneLockouts, m.pruneSessions, m.pruneChallenges} {
		if err := prune(ctx); err != nil {
			t.Fatal(err)
		}
	}
	for table, want := range map[string]int{"login_lockouts": 2, "sessions": 1, "mfa_challenges": 1} {
		if n := f.count(`SELECT count(*) FROM ` + table); n != want {
			t.Errorf("%d rows left in %s, want %d", n, table, want)
		}
	}
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func TestAuthMethods(t *testing.T) {
	f := newFixture(t)
	status, body := f.send(http.MethodGet, "/auth/methods", "", nil)
	if status != http.StatusOK || mustJSON(body["password"]) != `{"enabled":true,"identityFields":["email","username"]}` || mustJSON(body["oauth2"]) != `{"enabled":false,"providers":[]}` {
		t.Errorf("methods = %d %v", status, body)
	}
}

func TestPasswordResetRequestNeedsCaptchaForGuests(t *testing.T) {
	f := newFixture(t)
	f.user("cap-reset@example.com")
	t.Setenv("CAP_SECRET", "cap-secret")
	body := map[string]string{"email": "cap-reset@example.com"}
	if status, _ := f.send(http.MethodPost, "/auth/password-reset/request", "", body); status != http.StatusBadRequest {
		t.Errorf("without captcha = %d", status)
	}
	if status, _ := f.send(http.MethodPost, "/auth/password-reset/request", "", body, captcha.Header, capToken("cap-secret", "password-reset", "p1")); status != http.StatusNoContent {
		t.Errorf("with captcha = %d", status)
	}
}
