package platformadmin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"

	"gripello/internal/platform"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/testapp"
)

type fixture struct {
	t                          *testing.T
	app                        *platform.App
	handler                    http.Handler
	tokenKeys                  map[string]string
	operator, otherOp, climber string
	gym                        string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	app := testapp.App(t)
	Register(app)
	f := &fixture{t: t, app: app, handler: testapp.Handler(app), tokenKeys: map[string]string{}}
	f.operator = f.user("op@example.com", true)
	f.otherOp = f.user("op2@example.com", true)
	f.climber = f.user("climber@example.com", false)
	f.gym = ids.New()
	f.exec(`INSERT INTO gyms (id, slug, name, active) VALUES ($1, 'north', 'North', true)`, f.gym)
	return f
}

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.app.DB.Exec(context.Background(), sql, args...); err != nil {
		f.t.Fatal(err)
	}
}

func (f *fixture) count(sql string, args ...any) int {
	f.t.Helper()
	var n int
	if err := f.app.DB.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		f.t.Fatal(err)
	}
	return n
}

func (f *fixture) user(email string, platformAdmin bool) string {
	id, key := ids.New(), ids.New()+ids.New()
	f.exec(`INSERT INTO users (id, email, token_key, username, firstname, platform_admin) VALUES ($1, $2, $3, $4, 'Alex', $5)`,
		id, email, key, strings.Split(email, "@")[0], platformAdmin)
	f.tokenKeys[id] = key
	return id
}

func (f *fixture) adminOf(user string) {
	role := ids.New()
	f.exec(`INSERT INTO roles (id, gym, name, permissions) VALUES ($1, $2, $3, '{}') ON CONFLICT DO NOTHING`, role, f.gym, "admin")
	f.exec(`INSERT INTO memberships (id, "user", gym, role) VALUES ($1, $2, $3, (SELECT id FROM roles WHERE gym = $3 AND name = 'admin'))`, ids.New(), user, f.gym)
}

func (f *fixture) session(user string) string {
	id := ids.New()
	f.exec(`INSERT INTO sessions (id, "user") VALUES ($1, $2)`, id, user)
	return id
}

func (f *fixture) callToken(method, url, body, token string, status int) map[string]any {
	f.t.Helper()
	request := httptest.NewRequest(method, "/api"+url, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", token)
	}
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, request)
	if recorder.Code != status {
		f.t.Fatalf("%s %s = %d, want %d: %s", method, url, recorder.Code, status, recorder.Body)
	}
	var out map[string]any
	json.Unmarshal(recorder.Body.Bytes(), &out)
	return out
}

func (f *fixture) token(user string) string {
	token, err := f.app.Tokens.Sign(user, f.tokenKeys[user], "")
	if err != nil {
		f.t.Fatal(err)
	}
	return token
}

func (f *fixture) call(method, url, body, caller string, status int) map[string]any {
	f.t.Helper()
	token := ""
	if caller != "" {
		token = f.token(caller)
	}
	return f.callToken(method, url, body, token, status)
}

func (f *fixture) lastEvent(kind string) map[string]any {
	f.t.Helper()
	var raw []byte
	if err := f.app.DB.QueryRow(context.Background(), `SELECT payload FROM events WHERE kind = $1 ORDER BY id DESC LIMIT 1`, kind).Scan(&raw); err != nil {
		f.t.Fatalf("no %s event: %v", kind, err)
	}
	var payload map[string]any
	json.Unmarshal(raw, &payload)
	return payload
}

func TestEverythingNeedsAPlatformAdmin(t *testing.T) {
	f := newFixture(t)
	for _, route := range []string{
		"GET /platform/users", "GET /platform/users/" + f.climber, "PATCH /platform/users/" + f.climber, "DELETE /platform/users/" + f.climber,
		"POST /platform/users/" + f.climber + "/suspension", "DELETE /platform/users/" + f.climber + "/suspension",
		"GET /platform/stats", "GET /platform/features", "PUT /platform/gyms/" + f.gym + "/features", "POST /platform/admins", "DELETE /platform/admins/" + f.climber,
	} {
		method, url, _ := strings.Cut(route, " ")
		f.call(method, url, `{}`, "", http.StatusUnauthorized)
		f.call(method, url, `{}`, f.climber, http.StatusForbidden)
	}
}

func TestListAndGetUsers(t *testing.T) {
	f := newFixture(t)
	f.adminOf(f.climber)
	f.exec(`UPDATE users SET verified = true WHERE id <> $1`, f.climber)
	f.exec(`UPDATE users SET suspended_until = now() + interval '1 day' WHERE id = $1`, f.climber)
	total := func(body map[string]any) int { return int(body["total"].(float64)) }
	for query, want := range map[string]int{
		"":                       3,
		"q=CLIMBER":              1,
		"q=example.com":          3,
		"filter=platform_admins": 2,
		"filter=unverified":      1,
		"filter=suspended":       1,
		"limit=2&page=2":         3,
	} {
		if got := total(f.call(http.MethodGet, "/platform/users?"+query, "", f.operator, http.StatusOK)); got != want {
			t.Errorf("%q: total = %d, want %d", query, got, want)
		}
	}
	if items := f.call(http.MethodGet, "/platform/users?limit=2&page=2", "", f.operator, http.StatusOK)["items"].([]any); len(items) != 1 {
		t.Errorf("page 2 has %d items", len(items))
	}
	all := f.call(http.MethodGet, "/platform/users?limit=0", "", f.operator, http.StatusOK)
	emails := []string{}
	for _, item := range all["items"].([]any) {
		emails = append(emails, item.(map[string]any)["email"].(string))
	}
	if len(emails) != 3 || emails[0] != "climber@example.com" || all["limit"] != 0.0 {
		t.Errorf("unpaged list = %v (limit %v), want all three by email", emails, all["limit"])
	}
	f.call(http.MethodGet, "/platform/users?filter=nope", "", f.operator, http.StatusBadRequest)
	user := f.call(http.MethodGet, "/platform/users/"+f.climber, "", f.operator, http.StatusOK)
	if user["email"] != "climber@example.com" || user["token_key"] != nil || user["password_hash"] != nil {
		t.Errorf("user = %v", user)
	}
	if memberships := user["memberships"].([]any); len(memberships) != 1 || memberships[0].(map[string]any)["gym"] != f.gym {
		t.Errorf("memberships = %v", memberships)
	}
	f.call(http.MethodGet, "/platform/users/missing", "", f.operator, http.StatusNotFound)
}

func TestPlatformAdminsEditProfilesButNotSettingsOrOtherAdmins(t *testing.T) {
	f := newFixture(t)
	for _, field := range []string{"notification_prefs", "followed_walls", "leaderboard_hidden", "follow_policy", "reviews_anonymous", "ticks_private", "platform_admin"} {
		f.call(http.MethodPatch, "/platform/users/"+f.climber, `{"`+field+`": true}`, f.operator, http.StatusForbidden)
	}
	f.call(http.MethodPatch, "/platform/users/"+f.otherOp, `{"firstname": "X"}`, f.operator, http.StatusForbidden)
	f.call(http.MethodPatch, "/platform/users/"+f.operator, `{"firstname": "Me"}`, f.operator, http.StatusOK)
	f.call(http.MethodPatch, "/platform/users/"+f.climber, `{"username": "op"}`, f.operator, http.StatusBadRequest)
	f.call(http.MethodPatch, "/platform/users/"+f.climber, `{"email": "not-an-email"}`, f.operator, http.StatusBadRequest)
	f.call(http.MethodPatch, "/platform/users/"+f.climber, `{"email": "op2@example.com"}`, f.operator, http.StatusBadRequest)
	f.call(http.MethodPatch, "/platform/users/"+f.climber, `{"avatar": "x.png"}`, f.operator, http.StatusBadRequest)
	oldToken := f.token(f.climber)
	session := f.session(f.climber)
	user := f.call(http.MethodPatch, "/platform/users/"+f.climber,
		`{"username": "renamed", "firstname": " Kim ", "name": "Lee", "verified": true, "email": "Kim@Example.com"}`, f.operator, http.StatusOK)
	if user["username"] != "renamed" || user["firstname"] != "Kim" || user["verified"] != true || user["email"] != "kim@example.com" {
		t.Errorf("user = %v", user)
	}
	event := f.lastEvent("user.updated")
	changed := []string{}
	for _, field := range event["changed"].([]any) {
		changed = append(changed, field.(string))
	}
	if event["actor"] != f.operator || !slices.Equal(changed, []string{"email", "firstname", "name", "username", "verified"}) ||
		event["record"].(map[string]any)["token_key"] != nil {
		t.Errorf("event = %v", event)
	}
	f.callToken(http.MethodGet, "/platform/users", "", oldToken, http.StatusUnauthorized)
	if e := f.lastEvent("session.revoked"); e["session"] != session {
		t.Errorf("session.revoked = %v", e)
	}
	mails := testapp.Mails(f.app)
	if len(mails) != 1 || mails[0].To[0] != "climber@example.com" || !strings.Contains(mails[0].Text, "kim@example.com") {
		t.Errorf("e-mail change notice = %+v", mails)
	}
}

func TestDeleteUser(t *testing.T) {
	f := newFixture(t)
	f.call(http.MethodDelete, "/platform/users/"+f.otherOp, "", f.operator, http.StatusForbidden)
	f.adminOf(f.climber)
	f.call(http.MethodDelete, "/platform/users/"+f.climber, "", f.operator, http.StatusBadRequest)
	f.adminOf(f.operator)
	session := f.session(f.climber)
	f.call(http.MethodDelete, "/platform/users/"+f.climber, "", f.operator, http.StatusNoContent)
	if n := f.count(`SELECT count(*) FROM users WHERE id = $1`, f.climber); n != 0 {
		t.Error("user still exists")
	}
	if e := f.lastEvent("user.deleted"); e["id"] != f.climber || e["actor"] != f.operator {
		t.Errorf("user.deleted = %v", e)
	}
	if e := f.lastEvent("session.revoked"); e["session"] != session {
		t.Errorf("session.revoked = %v", e)
	}
	f.assertActors(f.operator)
	f.call(http.MethodDelete, "/platform/users/"+f.climber, "", f.operator, http.StatusNotFound)
}

func TestSuspension(t *testing.T) {
	f := newFixture(t)
	f.call(http.MethodPost, "/platform/users/"+f.operator+"/suspension", `{"permanent": true}`, f.operator, http.StatusForbidden)
	f.call(http.MethodPost, "/platform/users/"+f.otherOp+"/suspension", `{"permanent": true}`, f.operator, http.StatusForbidden)
	f.call(http.MethodPost, "/platform/users/"+f.climber+"/suspension", `{"until": "2000-01-01 00:00:00.000Z"}`, f.operator, http.StatusBadRequest)
	f.call(http.MethodPost, "/platform/users/"+f.climber+"/suspension", `{"until": "soon"}`, f.operator, http.StatusBadRequest)

	oldToken := f.token(f.climber)
	f.callToken(http.MethodGet, "/platform/users", "", oldToken, http.StatusForbidden)
	session := f.session(f.climber)
	f.call(http.MethodPost, "/platform/users/"+f.climber+"/suspension", `{"permanent": true, "reason": " spam "}`, f.operator, http.StatusNoContent)
	var until, reason string
	f.app.DB.QueryRow(context.Background(), `SELECT to_char(suspended_until AT TIME ZONE 'UTC', 'YYYY-MM-DD'), suspension_reason FROM users WHERE id = $1`, f.climber).Scan(&until, &reason)
	if until != "9999-12-31" || reason != "spam" {
		t.Errorf("suspension = %s %q", until, reason)
	}
	f.callToken(http.MethodGet, "/platform/users", "", oldToken, http.StatusUnauthorized)
	if n := f.count(`SELECT count(*) FROM sessions WHERE "user" = $1`, f.climber); n != 0 {
		t.Errorf("%d sessions left", n)
	}
	if e := f.lastEvent("session.revoked"); e["session"] != session || e["user"] != f.climber {
		t.Errorf("session.revoked = %v", e)
	}
	if e := f.lastEvent("user.updated"); e["actor"] != f.operator {
		t.Errorf("user.updated = %v", e)
	}
	f.assertActors(f.operator)
	mails := testapp.Mails(f.app)
	if len(mails) != 1 || mails[0].To[0] != "climber@example.com" || !strings.Contains(mails[0].Text, "spam") {
		t.Errorf("mails = %+v", mails)
	}

	f.call(http.MethodPost, "/platform/users/"+f.climber+"/suspension", `{"until": "2999-01-01T10:00:00Z"}`, f.operator, http.StatusNoContent)
	f.call(http.MethodDelete, "/platform/users/"+f.climber+"/suspension", "", f.operator, http.StatusNoContent)
	if n := f.count(`SELECT count(*) FROM users WHERE id = $1 AND suspended_until IS NULL AND suspension_reason = ''`, f.climber); n != 1 {
		t.Error("suspension not lifted")
	}
}

func TestStats(t *testing.T) {
	f := newFixture(t)
	f.adminOf(f.climber)
	f.exec(`INSERT INTO gyms (id, slug, name, active) VALUES ($1, 'south', 'South', false)`, ids.New())
	body := f.call(http.MethodGet, "/platform/stats", "", f.operator, http.StatusOK)
	totals := body["totals"].(map[string]any)
	if totals["gyms"] != 2.0 || totals["active_gyms"] != 1.0 || totals["members"] != 1.0 || totals["users"] != 3.0 || totals["routes"] != 0.0 {
		t.Errorf("totals = %v", totals)
	}
	if gyms := body["gyms"].([]any); len(gyms) != 2 || gyms[0].(map[string]any)["slug"] != "north" {
		t.Errorf("gyms = %v", gyms)
	}
}

func TestFeatureFlagsMirrorTheFrontendRegistry(t *testing.T) {
	source, err := os.ReadFile("../../../shared/utils/featureFlags.ts")
	if err != nil {
		t.Fatal(err)
	}
	list := regexp.MustCompile(`FEATURE_FLAGS = \[([^\]]*)\]`).FindSubmatch(source)
	registry := []string{}
	for _, match := range regexp.MustCompile(`'([a-z_]+)'`).FindAllSubmatch(list[1], -1) {
		registry = append(registry, string(match[1]))
	}
	if !slices.Equal(featureFlags, registry) {
		t.Errorf("featureFlags = %v, frontend registry %v", featureFlags, registry)
	}
}

func TestSetFeatures(t *testing.T) {
	f := newFixture(t)
	if flags := f.call(http.MethodGet, "/platform/features", "", f.operator, http.StatusOK)["flags"].([]any); len(flags) != len(featureFlags) {
		t.Errorf("flags = %v", flags)
	}
	f.call(http.MethodPut, "/platform/gyms/"+f.gym+"/features", `{"teleport": true}`, f.operator, http.StatusBadRequest)
	f.call(http.MethodPut, "/platform/gyms/"+f.gym+"/features", `{"beta_videos": 1}`, f.operator, http.StatusBadRequest)
	f.call(http.MethodPut, "/platform/gyms/missing/features", `{"beta_videos": true}`, f.operator, http.StatusNotFound)
	gym := f.call(http.MethodPut, "/platform/gyms/"+f.gym+"/features", `{"beta_videos": true}`, f.operator, http.StatusOK)
	if gym["features"].(map[string]any)["beta_videos"] != true {
		t.Errorf("gym = %v", gym)
	}
	e := f.lastEvent("gym.updated")
	if record := e["record"].(map[string]any); record["id"] != f.gym || record["features"].(map[string]any)["beta_videos"] != true || e["changed"].([]any)[0] != "features" {
		t.Errorf("gym.updated = %v", e)
	}
	f.assertActors(f.operator)
}

func TestPlatformAdminGrants(t *testing.T) {
	f := newFixture(t)
	f.call(http.MethodPost, "/platform/admins", `{"user": "missing"}`, f.operator, http.StatusNotFound)
	if user := f.call(http.MethodPost, "/platform/admins", `{"user": "`+f.climber+`"}`, f.operator, http.StatusOK); user["platform_admin"] != true {
		t.Errorf("user = %v", user)
	}
	if e := f.lastEvent("user.updated"); e["changed"].([]any)[0] != "platform_admin" || e["actor"] != f.operator {
		t.Errorf("user.updated = %v", e)
	}
	f.assertActors(f.operator)
	f.call(http.MethodGet, "/platform/stats", "", f.climber, http.StatusOK)
	f.call(http.MethodDelete, "/platform/admins/"+f.operator, "", f.operator, http.StatusBadRequest)
	f.call(http.MethodDelete, "/platform/admins/"+f.climber, "", f.operator, http.StatusForbidden)
	f.call(http.MethodDelete, "/platform/admins/"+f.otherOp, "", f.operator, http.StatusForbidden)
	f.call(http.MethodDelete, "/platform/admins/missing", "", f.operator, http.StatusNotFound)
	f.call(http.MethodGet, "/platform/stats", "", f.otherOp, http.StatusOK)
}

func (f *fixture) assertActors(actor string) {
	f.t.Helper()
	if n := f.count(`SELECT count(*) FROM events WHERE actor IS DISTINCT FROM $1`, actor); n != 0 {
		f.t.Errorf("%d events without actor %s", n, actor)
	}
}
