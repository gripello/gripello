package hooks

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/security"
	"github.com/pocketbase/pocketbase/tools/subscriptions"
)

const testPassword = "pw12345678"

func send(t *testing.T, app *tests.TestApp, method, url, token string, body any) (int, map[string]any) {
	t.Helper()
	payload, _ := json.Marshal(body)
	request := httptest.NewRequest(method, url, strings.NewReader(string(payload)))
	request.Header.Set("content-type", "application/json")
	request.Header.Set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0")
	if token != "" {
		request.Header.Set("Authorization", token)
	}
	recorder := httptest.NewRecorder()
	handlerOf(t, app).ServeHTTP(recorder, request)
	result := map[string]any{}
	_ = json.Unmarshal(recorder.Body.Bytes(), &result)
	return recorder.Code, result
}

func passwordLogin(t *testing.T, app *tests.TestApp, identity, password string) (int, map[string]any) {
	t.Helper()
	return send(t, app, http.MethodPost, "/api/collections/users/auth-with-password", "", map[string]string{"identity": identity, "password": password})
}

func verifiedUser(t *testing.T, app *tests.TestApp, email string) *core.Record {
	t.Helper()
	return saveRecord(t, app, "users", map[string]any{"email": email, "password": testPassword, "verified": true})
}

func enableTOTP(t *testing.T, app *tests.TestApp, user *core.Record) ([]byte, []any) {
	t.Helper()
	token, _ := user.NewAuthToken()
	status, setup := send(t, app, http.MethodPost, "/api/account/totp/setup", token, map[string]string{"password": testPassword})
	if status != http.StatusOK {
		t.Fatalf("setup = %d %v", status, setup)
	}
	secret := setup["secret"].(string)
	key, _ := decodeTOTPSecret(secret)
	code := totpCode(key, time.Now().Unix()/totpPeriod-1, totpDigits)
	status, enabled := send(t, app, http.MethodPost, "/api/account/totp", token, map[string]string{"secret": secret, "code": code, "password": testPassword})
	if status != http.StatusOK {
		t.Fatalf("enable = %d %v", status, enabled)
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

func TestPasswordLoginWithoutFactorsSkipsMFA(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()
	verifiedUser(t, app, "plain@example.com")

	status, body := passwordLogin(t, app, "plain@example.com", testPassword)
	if status != http.StatusOK || body["token"] == "" {
		t.Fatalf("login = %d %v", status, body)
	}
}

func TestTOTPSecondFactor(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()
	user := verifiedUser(t, app, "totp@example.com")
	key, recovery := enableTOTP(t, app, user)
	if len(recovery) != recoveryCodeCount {
		t.Fatalf("got %d recovery codes", len(recovery))
	}

	status, body := passwordLogin(t, app, "totp@example.com", testPassword)
	mfaID, _ := body["mfaId"].(string)
	if status != http.StatusUnauthorized || mfaID == "" {
		t.Fatalf("password step = %d %v", status, body)
	}
	if methods, _ := json.Marshal(body["methods"]); string(methods) != `["totp","recovery"]` {
		t.Errorf("methods = %s", methods)
	}
	if status, _ := send(t, app, http.MethodPost, "/api/auth/totp", "", map[string]string{"mfaId": mfaID, "code": "000000"}); status != http.StatusBadRequest {
		t.Errorf("wrong code = %d", status)
	}
	code := totpCode(key, time.Now().Unix()/totpPeriod, totpDigits)
	status, body = send(t, app, http.MethodPost, "/api/auth/totp", "", map[string]string{"mfaId": mfaID, "code": code})
	if status != http.StatusOK || body["token"] == "" {
		t.Fatalf("totp step = %d %v", status, body)
	}
	if status, _ := send(t, app, http.MethodPost, "/api/auth/totp", "", map[string]string{"mfaId": mfaID, "code": code}); status != http.StatusBadRequest {
		t.Errorf("reused mfaId = %d", status)
	}
}

func TestRecoveryCodeIsSingleUse(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()
	user := verifiedUser(t, app, "recover@example.com")
	_, recovery := enableTOTP(t, app, user)
	code := strings.ToUpper(recovery[0].(string))

	for i, want := range []int{http.StatusOK, http.StatusBadRequest} {
		_, body := passwordLogin(t, app, "recover@example.com", testPassword)
		status, _ := send(t, app, http.MethodPost, "/api/auth/recovery", "", map[string]string{"mfaId": body["mfaId"].(string), "code": code})
		if status != want {
			t.Errorf("attempt %d = %d, want %d", i, status, want)
		}
	}
	if left := len(recoveryCodeHashes(app, user.Id)); left != recoveryCodeCount-1 {
		t.Errorf("%d codes left", left)
	}
}

func TestDeletingLastFactorNeedsPasswordAndDropsRecoveryCodes(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()
	user := verifiedUser(t, app, "off@example.com")
	enableTOTP(t, app, user)
	token, _ := user.NewAuthToken()
	factor := mfaFactors(app, user.Id)[0]

	if status, _ := send(t, app, http.MethodDelete, "/api/account/mfa/"+factor.Id, token, map[string]string{"password": "wrong"}); status != http.StatusBadRequest {
		t.Errorf("wrong password = %d", status)
	}
	if status, _ := send(t, app, http.MethodDelete, "/api/account/mfa/"+factor.Id, token, map[string]string{"password": testPassword}); status != http.StatusNoContent {
		t.Errorf("delete = %d", status)
	}
	if len(recoveryCodeHashes(app, user.Id)) != 0 {
		t.Error("recovery codes kept")
	}
	if status, _ := passwordLogin(t, app, "off@example.com", testPassword); status != http.StatusOK {
		t.Errorf("login after disable = %d", status)
	}
}

func TestSessionsTrackAndRevokeLogins(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()
	user := verifiedUser(t, app, "session@example.com")

	_, first := passwordLogin(t, app, "session@example.com", testPassword)
	_, second := passwordLogin(t, app, "session@example.com", testPassword)
	firstToken, secondToken := first["token"].(string), second["token"].(string)
	claims, _ := security.ParseUnverifiedJWT(firstToken)
	sid, _ := claims[sessionClaim].(string)
	session, err := app.FindRecordById("sessions", sid)
	if err != nil || session.GetString("user") != user.Id || !strings.Contains(session.GetString("user_agent"), "Firefox") {
		t.Fatalf("session %q not stored: %v", sid, err)
	}

	status, refreshed := send(t, app, http.MethodPost, "/api/collections/users/auth-refresh", firstToken, nil)
	refreshedClaims, _ := security.ParseUnverifiedJWT(refreshed["token"].(string))
	if status != http.StatusOK || refreshedClaims[sessionClaim] != sid {
		t.Errorf("refresh = %d, sid %v", status, refreshedClaims[sessionClaim])
	}

	if status, _ := send(t, app, http.MethodDelete, recordURL("sessions", sid), secondToken, nil); status != http.StatusNoContent {
		t.Fatalf("revoke = %d", status)
	}
	if status, _ := send(t, app, http.MethodPost, "/api/collections/users/auth-refresh", firstToken, nil); status != http.StatusUnauthorized {
		t.Errorf("revoked token refresh = %d", status)
	}
	if status, _ := send(t, app, http.MethodPost, "/api/account/sessions/sign-out-others", secondToken, nil); status != http.StatusNoContent {
		t.Errorf("sign out others = %d", status)
	}
	if total, _ := app.CountRecords("sessions", dbx.HashExp{"user": user.Id}); total != 1 {
		t.Errorf("%d sessions left", total)
	}

	user.SetPassword("another-password-1")
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
	if total, _ := app.CountRecords("sessions", dbx.HashExp{"user": user.Id}); total != 0 {
		t.Errorf("%d sessions survived the password change", total)
	}
}

func TestLegacyTokenStartsSessionOnRefresh(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()
	user := verifiedUser(t, app, "legacy@example.com")
	token, _ := user.NewAuthToken()

	status, body := send(t, app, http.MethodPost, "/api/collections/users/auth-refresh", token, nil)
	claims, _ := security.ParseUnverifiedJWT(body["token"].(string))
	if status != http.StatusOK || claims[sessionClaim] == nil {
		t.Errorf("refresh = %d, claims %v", status, claims)
	}
}

func TestLoginLockoutPerAccount(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()
	app.Settings().RateLimits.Enabled = false
	user := verifiedUser(t, app, "locked@example.com")

	for range lockoutMaxFailures {
		if status, _ := passwordLogin(t, app, "locked@example.com", "wrong"); status != http.StatusBadRequest {
			t.Fatalf("failure = %d", status)
		}
	}
	if status, _ := passwordLogin(t, app, "locked@example.com", testPassword); status != http.StatusTooManyRequests {
		t.Errorf("locked login = %d", status)
	}

	for range lockoutMaxFailures {
		passwordLogin(t, app, "nobody@example.com", "wrong")
	}
	if status, body := passwordLogin(t, app, "nobody@example.com", "wrong"); status != http.StatusTooManyRequests {
		t.Errorf("unknown identity = %d %v", status, body)
	}

	if _, err := app.DB().NewQuery("UPDATE login_lockouts SET locked_until = {:past}").Bind(dbx.Params{"past": cutoff(time.Minute)}).Execute(); err != nil {
		t.Fatal(err)
	}
	if status, _ := passwordLogin(t, app, "locked@example.com", testPassword); status != http.StatusOK {
		t.Errorf("login after lock expiry = %d", status)
	}
	if total, _ := app.CountRecords("login_lockouts", dbx.HashExp{"key": user.Id}); total != 0 {
		t.Error("lockout kept after success")
	}
}

func TestTOTPFailuresCountTowardLockout(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()
	user := verifiedUser(t, app, "guess@example.com")
	enableTOTP(t, app, user)

	_, body := passwordLogin(t, app, "guess@example.com", testPassword)
	mfaID := body["mfaId"].(string)
	for range lockoutMaxFailures {
		send(t, app, http.MethodPost, "/api/auth/totp", "", map[string]string{"mfaId": mfaID, "code": "000000"})
	}
	if status, _ := send(t, app, http.MethodPost, "/api/auth/totp", "", map[string]string{"mfaId": mfaID, "code": "000000"}); status != http.StatusTooManyRequests {
		t.Errorf("after %d guesses = %d", lockoutMaxFailures, status)
	}
}

func TestPasskeyLoginRejectsUnknownCredential(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()
	app.Settings().Meta.AppURL = "https://gripello.test"

	status, options := send(t, app, http.MethodPost, "/api/auth/passkey/options", "", nil)
	publicKey, _ := options["options"].(map[string]any)
	if status != http.StatusOK || publicKey["rpId"] != "gripello.test" || publicKey["challenge"] == "" {
		t.Fatalf("options = %d %v", status, options)
	}
	status, _ = send(t, app, http.MethodPost, "/api/auth/passkey", "", map[string]any{"ceremony": options["ceremony"], "credential": map[string]string{"id": "AAAA"}})
	if status != http.StatusBadRequest {
		t.Errorf("unknown credential = %d", status)
	}
	if status, _ := send(t, app, http.MethodPost, "/api/auth/passkey", "", map[string]any{"ceremony": options["ceremony"]}); status != http.StatusBadRequest {
		t.Errorf("reused ceremony = %d", status)
	}
}

func TestRevokedSessionDropsRealtimeAuth(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()
	user := verifiedUser(t, app, "live@example.com")
	_, first := passwordLogin(t, app, "live@example.com", testPassword)
	_, second := passwordLogin(t, app, "live@example.com", testPassword)
	sidOf := func(token string) string {
		claims, _ := security.ParseUnverifiedJWT(token)
		return claims[sessionClaim].(string)
	}
	revoked, kept := subscriptions.NewDefaultClient(), subscriptions.NewDefaultClient()
	for client, token := range map[subscriptions.Client]string{revoked: first["token"].(string), kept: second["token"].(string)} {
		client.Set(apis.RealtimeClientAuthKey, user)
		client.Set(realtimeSessionKey, sidOf(token))
		app.SubscriptionsBroker().Register(client)
		defer app.SubscriptionsBroker().Unregister(client.Id())
	}

	if status, _ := send(t, app, http.MethodDelete, recordURL("sessions", sidOf(first["token"].(string))), second["token"].(string), nil); status != http.StatusNoContent {
		t.Fatalf("revoke = %d", status)
	}
	if revoked.Get(apis.RealtimeClientAuthKey) != nil {
		t.Error("revoked connection kept its auth")
	}
	if kept.Get(apis.RealtimeClientAuthKey) == nil {
		t.Error("other connection lost its auth")
	}
}

func TestRenameOwnFactorOnly(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()
	owner := verifiedUser(t, app, "named@example.com")
	stranger := verifiedUser(t, app, "stranger@example.com")
	enableTOTP(t, app, owner)
	factor := mfaFactors(app, owner.Id)[0]
	ownerToken, _ := owner.NewAuthToken()
	strangerToken, _ := stranger.NewAuthToken()

	if status, _ := send(t, app, http.MethodPatch, "/api/account/mfa/"+factor.Id, strangerToken, map[string]string{"name": "Mine"}); status != http.StatusNotFound {
		t.Errorf("stranger rename = %d", status)
	}
	status, body := send(t, app, http.MethodPatch, "/api/account/mfa/"+factor.Id, ownerToken, map[string]string{"name": "  Work phone  "})
	if status != http.StatusOK || body["name"] != "Work phone" {
		t.Errorf("rename = %d %v", status, body)
	}
}

func TestSecondFactorMethodsFollowTheAccount(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()
	user := verifiedUser(t, app, "methods@example.com")
	saveRecord(t, app, "mfa_factors", map[string]any{"user": user.Id, "kind": "passkey", "credential_id": "cred"})
	if got := secondFactorMethods(app, user.Id); strings.Join(got, ",") != "passkey" {
		t.Errorf("passkey only = %v", got)
	}
	enableTOTP(t, app, user)
	if got := secondFactorMethods(app, user.Id); strings.Join(got, ",") != "totp,passkey,recovery" {
		t.Errorf("all factors = %v", got)
	}
}

func TestDisplayIPCompressesIPv6(t *testing.T) {
	for raw, want := range map[string]string{"0000:0000:0000:0000:0000:0000:0000:0001": "::1", "10.0.0.1": "10.0.0.1", "garbage": "garbage"} {
		if got := displayIP(raw); got != want {
			t.Errorf("displayIP(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestAddingFactorsNeedsPassword(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()
	app.Settings().Meta.AppURL = "https://gripello.test"
	user := verifiedUser(t, app, "hijack@example.com")
	token, _ := user.NewAuthToken()

	for _, url := range []string{"/api/account/totp/setup", "/api/account/totp", "/api/account/passkeys/options"} {
		if status, _ := send(t, app, http.MethodPost, url, token, map[string]string{"password": "wrong"}); status != http.StatusBadRequest {
			t.Errorf("%s with wrong password = %d", url, status)
		}
	}
	if status, _ := send(t, app, http.MethodPost, "/api/account/passkeys/options", token, map[string]string{"password": testPassword}); status != http.StatusOK {
		t.Errorf("passkey options with password = %d", status)
	}
}

func TestParallelFailuresStillLock(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()
	var wg sync.WaitGroup
	for range lockoutMaxFailures {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := countLoginFailure(app, "parallel"); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if !isLockedOut(app, "parallel") {
		t.Error("parallel failures were not all counted")
	}
}

func TestTOTPStepClaimedOnce(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()
	user := verifiedUser(t, app, "replay@example.com")
	enableTOTP(t, app, user)
	factor := mfaFactors(app, user.Id)[0]
	step := int64(factor.GetInt("last_step")) + 1

	var claimed atomic.Int32
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if claimTOTPStep(app, factor.Id, step) {
				claimed.Add(1)
			}
		}()
	}
	wg.Wait()
	if claimed.Load() != 1 {
		t.Errorf("step claimed %d times", claimed.Load())
	}
}

func TestRecoveryCodeKeptWhenSignInFails(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()
	user := verifiedUser(t, app, "kept@example.com")
	_, recovery := enableTOTP(t, app, user)
	_, body := passwordLogin(t, app, "kept@example.com", testPassword)

	fresh, err := app.FindRecordById("users", user.Id)
	if err != nil {
		t.Fatal(err)
	}
	fresh.Set("suspended_until", time.Now().Add(time.Hour))
	if err := app.Save(fresh); err != nil {
		t.Fatal(err)
	}
	if status, res := send(t, app, http.MethodPost, "/api/auth/recovery", "", map[string]string{"mfaId": body["mfaId"].(string), "code": recovery[0].(string)}); status != http.StatusForbidden {
		t.Errorf("suspended sign-in = %d %v", status, res)
	}
	if left := len(recoveryCodeHashes(app, user.Id)); left != recoveryCodeCount {
		t.Errorf("%d codes left after a failed sign-in", left)
	}
}

func TestPasskeyCeremoniesAreCapped(t *testing.T) {
	saved := ceremonies
	ceremonies = &passkeyCeremonies{sessions: map[string]passkeyCeremony{}}
	defer func() { ceremonies = saved }()
	for range passkeyCeremonyMax {
		if _, ok := ceremonies.put(&webauthn.SessionData{}, ""); !ok {
			t.Fatal("refused below the cap")
		}
	}
	if _, ok := ceremonies.put(&webauthn.SessionData{}, ""); ok {
		t.Error("accepted above the cap")
	}
}
