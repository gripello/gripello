package platformadmin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform"
	"gripello/internal/platform/blocklist"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/logbuf"
	"gripello/internal/platform/metrics"
	"gripello/internal/platform/replicas"
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
	token := testapp.Token(f.t, f.app, user, f.tokenKeys[user])
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

// lastActor reads the actor from the event envelope; payloads never carry it to clients.
func (f *fixture) lastActor(kind string) string {
	f.t.Helper()
	var actor string
	if err := f.app.DB.QueryRow(context.Background(), `SELECT actor FROM events WHERE kind = $1 ORDER BY id DESC LIMIT 1`, kind).Scan(&actor); err != nil {
		f.t.Fatalf("no %s event: %v", kind, err)
	}
	return actor
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
		"GET /platform/blocklists", "PUT /platform/blocklists", "POST /platform/blocklists/emails", "GET /platform/users/" + f.climber + "/block-suggestions", "PUT /platform/blocklists/sources/mailchecker", "POST /platform/blocklists/sources/mailchecker/sync", "GET /platform/blocklists/sources/mailchecker/domains", "POST /platform/blocklists/check",
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
	f.exec(`UPDATE users SET firstname = 'Kira', name = 'Stone' WHERE id = $1`, f.climber)
	total := func(body map[string]any) int { return int(body["total"].(float64)) }
	for query, want := range map[string]int{
		"":                       3,
		"q=CLIMBER":              1,
		"q=example.com":          3,
		"q=kira+stone":           1,
		"q=kira+nobody":          0,
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
	f.call(http.MethodPatch, "/platform/users/"+f.climber, `{"email": "kim@example.com"}`, f.operator, http.StatusForbidden)
	f.call(http.MethodPatch, "/platform/users/"+f.climber, `{"email": "climber@example.com"}`, f.operator, http.StatusOK)
	oldToken := f.token(f.climber)
	session := f.session(f.climber)
	user := f.callToken(http.MethodPatch, "/platform/users/"+f.climber,
		`{"username": "renamed", "firstname": " Kim ", "name": "Lee", "verified": true, "email": "Kim@Example.com"}`, f.reauthToken(f.operator), http.StatusOK)
	if user["username"] != "renamed" || user["firstname"] != "Kim" || user["verified"] != true || user["email"] != "kim@example.com" {
		t.Errorf("user = %v", user)
	}
	event := f.lastEvent("user.updated")
	changed := []string{}
	for _, field := range event["changed"].([]any) {
		changed = append(changed, field.(string))
	}
	if f.lastActor("user.updated") != f.operator || event["actor"] != nil || !slices.Equal(changed, []string{"email", "firstname", "name", "username", "verified"}) ||
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
	op := f.reauthToken(f.operator)
	f.callToken(http.MethodDelete, "/platform/users/"+f.otherOp, "", op, http.StatusForbidden)
	f.callToken(http.MethodDelete, "/platform/users/"+f.operator, "", op, http.StatusForbidden)
	f.call(http.MethodDelete, "/platform/users/"+f.climber, "", f.operator, http.StatusForbidden)
	f.adminOf(f.climber)
	f.callToken(http.MethodDelete, "/platform/users/"+f.climber, "", op, http.StatusBadRequest)
	f.adminOf(f.operator)
	session := f.session(f.climber)
	f.callToken(http.MethodDelete, "/platform/users/"+f.climber, "", op, http.StatusNoContent)
	if n := f.count(`SELECT count(*) FROM users WHERE id = $1`, f.climber); n != 0 {
		t.Error("user still exists")
	}
	if e := f.lastEvent("user.deleted"); e["id"] != f.climber || e["actor"] != nil || f.lastActor("user.deleted") != f.operator {
		t.Errorf("user.deleted = %v", e)
	}
	if e := f.lastEvent("session.revoked"); e["session"] != session {
		t.Errorf("session.revoked = %v", e)
	}
	f.assertActors(f.operator)
	f.callToken(http.MethodDelete, "/platform/users/"+f.climber, "", op, http.StatusNotFound)
}

func TestConcurrentDeletesKeepAGymAdmin(t *testing.T) {
	f := newFixture(t)
	second := f.user("second@example.com", false)
	f.adminOf(f.climber)
	f.adminOf(second)
	op := f.reauthToken(f.operator)
	statuses := make(chan int, 2)
	for _, user := range []string{f.climber, second} {
		go func() {
			request := httptest.NewRequest(http.MethodDelete, "/api/platform/users/"+user, nil)
			request.Header.Set("Authorization", op)
			recorder := httptest.NewRecorder()
			f.handler.ServeHTTP(recorder, request)
			statuses <- recorder.Code
		}()
	}
	got := []int{<-statuses, <-statuses}
	slices.Sort(got)
	if !slices.Equal(got, []int{http.StatusNoContent, http.StatusBadRequest}) {
		t.Errorf("statuses = %v", got)
	}
	if n := f.count(`SELECT count(*) FROM memberships m JOIN roles r ON r.id = m.role WHERE m.gym = $1 AND r.name = 'admin'`, f.gym); n != 1 {
		t.Errorf("%d admins left", n)
	}
}

func TestSuspension(t *testing.T) {
	f := newFixture(t)
	f.call(http.MethodPost, "/platform/users/"+f.operator+"/suspension", `{"permanent": true}`, f.operator, http.StatusForbidden)
	f.call(http.MethodPost, "/platform/users/"+f.otherOp+"/suspension", `{"permanent": true}`, f.operator, http.StatusForbidden)
	f.call(http.MethodPost, "/platform/users/"+f.climber+"/suspension", `{"permanent": true}`, f.operator, http.StatusForbidden)
	op := f.reauthToken(f.operator)
	f.callToken(http.MethodPost, "/platform/users/"+f.climber+"/suspension", `{"until": "2000-01-01 00:00:00.000Z"}`, op, http.StatusBadRequest)
	f.callToken(http.MethodPost, "/platform/users/"+f.climber+"/suspension", `{"until": "soon"}`, op, http.StatusBadRequest)

	oldToken := f.token(f.climber)
	f.callToken(http.MethodGet, "/platform/users", "", oldToken, http.StatusForbidden)
	session := f.session(f.climber)
	f.callToken(http.MethodPost, "/platform/users/"+f.climber+"/suspension", `{"permanent": true, "reason": " spam "}`, op, http.StatusNoContent)
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
	if e := f.lastEvent("user.updated"); e["actor"] != nil || f.lastActor("user.updated") != f.operator {
		t.Errorf("user.updated = %v", e)
	}
	f.assertActors(f.operator)
	mails := testapp.Mails(f.app)
	if len(mails) != 1 || mails[0].To[0] != "climber@example.com" || !strings.Contains(mails[0].Text, "spam") {
		t.Errorf("mails = %+v", mails)
	}

	f.callToken(http.MethodPost, "/platform/users/"+f.climber+"/suspension", `{"until": "2999-01-01T10:00:00Z"}`, op, http.StatusNoContent)
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
	f.call(http.MethodPut, "/platform/gyms/"+f.gym+"/features", `{"beta_links": 1}`, f.operator, http.StatusBadRequest)
	f.call(http.MethodPut, "/platform/gyms/missing/features", `{"beta_links": true}`, f.operator, http.StatusNotFound)
	gym := f.call(http.MethodPut, "/platform/gyms/"+f.gym+"/features", `{"beta_links": true}`, f.operator, http.StatusOK)
	if gym["features"].(map[string]any)["beta_links"] != true {
		t.Errorf("gym = %v", gym)
	}
	e := f.lastEvent("gym.updated")
	if record := e["record"].(map[string]any); record["id"] != f.gym || record["features"].(map[string]any)["beta_links"] != true || e["changed"].([]any)[0] != "features" {
		t.Errorf("gym.updated = %v", e)
	}
	f.assertActors(f.operator)
}

// reauthToken signs a token whose session confirmed the password just now.
func (f *fixture) reauthToken(user string) string {
	f.t.Helper()
	sid := f.session(user)
	f.exec(`UPDATE sessions SET reauthenticated_at = now() WHERE id = $1`, sid)
	token, err := f.app.Tokens.Sign(user, f.tokenKeys[user], sid)
	if err != nil {
		f.t.Fatal(err)
	}
	return token
}

func TestPlatformAdminGrants(t *testing.T) {
	f := newFixture(t)
	op := f.reauthToken(f.operator)
	f.call(http.MethodPost, "/platform/admins", `{"user": "`+f.climber+`"}`, f.operator, http.StatusForbidden)
	f.callToken(http.MethodPost, "/platform/admins", `{"user": "missing"}`, op, http.StatusNotFound)
	if user := f.callToken(http.MethodPost, "/platform/admins", `{"user": "`+f.climber+`"}`, op, http.StatusOK); user["platform_admin"] != true {
		t.Errorf("user = %v", user)
	}
	if e := f.lastEvent("user.updated"); e["changed"].([]any)[0] != "platform_admin" || f.lastActor("user.updated") != f.operator {
		t.Errorf("user.updated = %v", e)
	}
	if mails := testapp.Mails(f.app); len(mails) != 1 || mails[0].To[0] != "climber@example.com" {
		t.Errorf("grant notice = %+v", mails)
	}
	f.call(http.MethodGet, "/platform/stats", "", f.climber, http.StatusOK)
	f.callToken(http.MethodDelete, "/platform/admins/"+f.operator, "", op, http.StatusBadRequest)
	f.call(http.MethodDelete, "/platform/admins/"+f.otherOp, "", f.operator, http.StatusForbidden)
	f.callToken(http.MethodDelete, "/platform/admins/missing", "", op, http.StatusNotFound)
	f.callToken(http.MethodDelete, "/platform/admins/"+f.otherOp, "", op, http.StatusNoContent)
	f.call(http.MethodGet, "/platform/stats", "", f.otherOp, http.StatusForbidden)
	f.callToken(http.MethodDelete, "/platform/admins/"+f.otherOp, "", op, http.StatusBadRequest)
	if mails := testapp.Mails(f.app); len(mails) != 2 || mails[1].To[0] != "op2@example.com" {
		t.Errorf("revoke notice = %+v", mails)
	}
	f.assertActors(f.operator)
}

func TestARevokedAdminCanNoLongerRevoke(t *testing.T) {
	f := newFixture(t)
	other := f.reauthToken(f.otherOp)
	f.callToken(http.MethodDelete, "/platform/admins/"+f.otherOp, "", f.reauthToken(f.operator), http.StatusNoContent)
	f.callToken(http.MethodDelete, "/platform/admins/"+f.operator, "", other, http.StatusForbidden)
	if n := f.count(`SELECT count(*) FROM users WHERE platform_admin`); n != 1 {
		t.Errorf("%d platform admins left", n)
	}
}

func (f *fixture) assertActors(actor string) {
	f.t.Helper()
	if n := f.count(`SELECT count(*) FROM events WHERE actor IS DISTINCT FROM $1`, actor); n != 0 {
		f.t.Errorf("%d events without actor %s", n, actor)
	}
}

func TestMailSettingsAreSealedAndNeverReturned(t *testing.T) {
	f := newFixture(t)
	op := f.reauthToken(f.operator)
	if got := f.call(http.MethodGet, "/platform/mail", "", f.operator, http.StatusOK); got["source"] != "none" {
		t.Errorf("unconfigured = %v", got)
	}
	f.call(http.MethodGet, "/platform/mail", "", f.climber, http.StatusForbidden)
	settings := `{"smtp_host":"smtp.example.com","smtp_port":465,"smtp_username":"mailer","smtp_password":"hunter2","smtp_tls":true,"sender_address":"no-reply@example.com","sender_name":"Hall"}`
	f.call(http.MethodPut, "/platform/mail", settings, f.operator, http.StatusForbidden)
	f.callToken(http.MethodPut, "/platform/mail", `{"smtp_host":"smtp.example.com","smtp_port":0,"sender_address":"nope"}`, op, http.StatusBadRequest)
	got := f.callToken(http.MethodPut, "/platform/mail", settings, op, http.StatusOK)
	if got["source"] != "database" || got["smtp_password_set"] != true || got["smtp_password"] != nil || got["smtp_port"] != float64(465) {
		t.Errorf("saved = %v", got)
	}
	if n := f.count(`SELECT count(*) FROM platform_config WHERE smtp_password = '' OR smtp_password LIKE '%hunter2%'`); n != 0 {
		t.Error("SMTP password not sealed")
	}
	f.callToken(http.MethodPut, "/platform/mail", strings.Replace(settings, `"smtp_password":"hunter2",`, "", 1), op, http.StatusOK)
	if got := f.call(http.MethodGet, "/platform/mail", "", f.operator, http.StatusOK); got["smtp_password_set"] != true {
		t.Errorf("leaving the password out cleared it: %v", got)
	}
	if n := f.count(`SELECT count(*) FROM events WHERE topic = 'platform' AND kind = 'platform_config.updated'`); n != 1 {
		t.Errorf("%d config events, want 1 (the unchanged save publishes nothing)", n)
	}
}

func TestTestMailGoesToTheCallerAndIsLimited(t *testing.T) {
	f := newFixture(t)
	for range 5 {
		f.call(http.MethodPost, "/platform/mail/test", "", f.operator, http.StatusNoContent)
	}
	f.call(http.MethodPost, "/platform/mail/test", "", f.operator, http.StatusTooManyRequests)
	mails := testapp.Mails(f.app)
	if len(mails) != 5 || mails[0].To[0] != "op@example.com" || !strings.Contains(mails[0].Subject, "Test") {
		t.Errorf("test mails = %d, first %+v", len(mails), mails[0])
	}
}

func TestLogLevelIsStoredAndAnnounced(t *testing.T) {
	f := newFixture(t)
	f.exec(`INSERT INTO server_logs (time, replica, severity, level, message) VALUES (now(), 'app-1', 0, 'INFO', 'started'), (now(), 'app-2', 8, 'ERROR', 'boom')`)
	got := f.call(http.MethodGet, "/platform/logs?level=warn", "", f.operator, http.StatusOK)
	if items := got["items"].([]any); len(items) != 1 || items[0].(map[string]any)["replica"] != "app-2" || got["replicas"] == nil {
		t.Errorf("logs = %v", got)
	}
	f.call(http.MethodGet, "/platform/logs?level=loud", "", f.operator, http.StatusBadRequest)
	f.call(http.MethodGet, "/platform/logs", "", f.climber, http.StatusForbidden)
	f.call(http.MethodPut, "/platform/logs/level", `{"level":"trace"}`, f.operator, http.StatusBadRequest)
	f.call(http.MethodPut, "/platform/logs/level", `{"level":"debug"}`, f.operator, http.StatusOK)
	if n := f.count(`SELECT count(*) FROM platform_config WHERE log_level = 'debug'`); n != 1 {
		t.Error("level not stored")
	}
	if e := f.lastEvent("platform_config.updated"); e["changed"].([]any)[0] != "log_level" {
		t.Errorf("event = %v", e)
	}
}

func TestTrafficSumsRequestsPerEndpoint(t *testing.T) {
	f := newFixture(t)
	rec := metrics.New(f.app.DB)
	for i := range 20 {
		status := http.StatusOK
		if i == 0 {
			status = http.StatusBadGateway
		}
		rec.Record("GET", "GET /api/gyms/{gym}", status, time.Duration(i+1)*time.Millisecond, "203.0.113.7")
	}
	rec.Record("POST", "POST /api/auth/login", http.StatusUnauthorized, 300*time.Millisecond, "198.51.100.1")
	if err := rec.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	f.call("GET", "/platform/traffic", "", f.climber, http.StatusForbidden)
	out := f.call("GET", "/platform/traffic?range=1h", "", f.operator, http.StatusOK)
	totals := out["totals"].(map[string]any)
	if totals["requests"] != 21.0 || totals["server_errors"] != 1.0 || totals["client_errors"] != 1.0 {
		t.Errorf("totals = %v", totals)
	}
	if series := out["series"].([]any); len(series) != 12 {
		t.Errorf("1h series has %d points, want 12", len(series))
	}
	endpoints := out["endpoints"].([]any)
	top := endpoints[0].(map[string]any)
	if top["pattern"] != "/api/gyms/{gym}" || top["requests"] != 20.0 || top["p95_ms"] != 25.0 {
		t.Errorf("top endpoint = %v", top)
	}
	if out["visitors_per_day"] != 2.0 {
		t.Errorf("visitors = %v", out["visitors_per_day"])
	}
	replicas.Beat(context.Background(), f.app.DB, replicas.Replica{Name: "app-1", Role: "all", Started: time.Now(), RealtimeClients: 2})
	replicas.Beat(context.Background(), f.app.DB, replicas.Replica{Name: "app-2", Role: "api", Started: time.Now(), RealtimeClients: 3})
	replicas.Beat(context.Background(), f.app.DB, replicas.Replica{Name: "app-gone", Role: "api", Started: time.Now(), RealtimeClients: 5})
	f.exec(`UPDATE replicas SET last_seen = now() - interval '5 minutes' WHERE name = 'app-gone'`)
	out = f.call("GET", "/platform/traffic?range=1h", "", f.operator, http.StatusOK)
	if servers := out["system"].(map[string]any)["replicas"].([]any); len(servers) != 3 || servers[0].(map[string]any)["realtime_clients"] != 2.0 {
		t.Errorf("replicas = %v", servers)
	}
	if online := out["people"].(map[string]any)["online"]; online != 5.0 {
		t.Errorf("online = %v, want the clients of every online replica", online)
	}
	f.call("GET", "/platform/system", "", f.climber, http.StatusForbidden)
	if servers := f.call("GET", "/platform/system", "", f.operator, http.StatusOK)["replicas"].([]any); len(servers) != 3 {
		t.Errorf("system replicas = %v", servers)
	}
}

func TestIssuesGroupLogsAndAlertPlatformAdminsOnce(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	buf := logbuf.New(io.Discard)
	log := slog.New(buf)
	for _, id := range []string{"a1b2c3d4e5f6g7h", "z9y8x7w6v5u4t3s"} {
		log.Error("request failed", "route", "GET /api/routes/{id}", "user", id, "error", fmt.Errorf("load route %s: boom", id))
	}
	log.Info("started")
	buf.Flush(ctx, f.app.DB, "app-1")

	f.call("GET", "/platform/issues", "", f.climber, http.StatusForbidden)
	items := f.call("GET", "/platform/issues?range=1h", "", f.operator, http.StatusOK)["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("issues = %v, want both failures grouped into one", items)
	}
	issue := items[0].(map[string]any)
	if issue["count"] != 2.0 || issue["users"] != 2.0 || issue["level"] != "ERROR" {
		t.Errorf("issue = %v", issue)
	}
	occurrences := f.call("GET", "/platform/issues/"+issue["fingerprint"].(string), "", f.operator, http.StatusOK)["items"].([]any)
	if len(occurrences) != 2 {
		t.Errorf("occurrences = %v", occurrences)
	}

	m := &module{app: f.app}
	for range 2 {
		if err := m.alertIssues(ctx); err != nil {
			t.Fatal(err)
		}
	}
	var alerts int
	f.app.DB.QueryRow(ctx, `SELECT count(*) FROM events WHERE topic = 'notify' AND payload->>'type' = 'platform_issue'`).Scan(&alerts)
	if alerts != 1 {
		t.Errorf("%d platform_issue alerts, want one per issue and cooldown", alerts)
	}
}

func TestBrowserErrorsAreLoggedWithoutTheQuery(t *testing.T) {
	f := newFixture(t)
	var out bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&out, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	f.call("POST", "/client-errors", `{"kind":"vue","message":"x is undefined","stack":"at Foo.vue:3","route":"/e2e/routes?q=ada@example.com","version":"1.2.0"}`, "", http.StatusNoContent)
	f.call("POST", "/client-errors", `{"kind":"other","message":"x"}`, "", http.StatusBadRequest)
	line := out.String()
	if !strings.Contains(line, `msg="client error"`) || !strings.Contains(line, "route=/e2e/routes") || strings.Contains(line, "ada@example.com") {
		t.Errorf("client error log = %s", line)
	}
}

func TestBrowserErrorsAlertOnlyAsABurstAcrossClimbers(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	buf := logbuf.New(io.Discard)
	log := slog.New(buf)
	for i := range 20 {
		log.Error("client error", "source", "client", "kind", "window", "route", "/", "user", "", "error", fmt.Sprintf("spam %c", 'a'+i))
	}
	for range 12 {
		log.Error("client error", "source", "client", "kind", "vue", "route", "/:gym/routes", "user", "u1", "error", "one climber only")
	}
	for i := range 12 {
		log.Error("client error", "source", "client", "kind", "vue", "route", "/:gym/map", "user", fmt.Sprintf("u%d", i%3), "error", "x is undefined")
	}
	buf.Flush(ctx, f.app.DB, "app-1")
	m := &module{app: f.app}
	if err := m.alertIssues(ctx); err != nil {
		t.Fatal(err)
	}
	rows, _ := f.app.DB.Query(ctx, `SELECT payload->'params'->>'summary' FROM events WHERE topic = 'notify' AND payload->>'type' = 'platform_issue'`)
	summaries, _ := pgx.CollectRows(rows, pgx.RowTo[string])
	if len(summaries) != 1 || !strings.Contains(summaries[0], "x is undefined") {
		t.Errorf("alerts = %v, want only the burst seen by three climbers", summaries)
	}
}

func TestIssueAlertsAreCappedPerRun(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	buf := logbuf.New(io.Discard)
	for i := range 8 {
		slog.New(buf).Error("job failed for good, dropped", "kind", fmt.Sprintf("kind%c", 'a'+i))
	}
	buf.Flush(ctx, f.app.DB, "app-1")
	m := &module{app: f.app}
	m.alertIssues(ctx)
	var alerts int
	f.app.DB.QueryRow(ctx, `SELECT count(*) FROM events WHERE topic = 'notify' AND payload->>'type' = 'platform_issue'`).Scan(&alerts)
	if alerts != alertsPerRun {
		t.Errorf("%d alerts in one run, want %d", alerts, alertsPerRun)
	}
}

func TestAnAlertedIssueAlertsAgainOnlyWhenItGrowsTenfold(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	m := &module{app: f.app}
	burst := func(n int) {
		buf := logbuf.New(io.Discard)
		for range n {
			slog.New(buf).Error("request failed", "route", "GET /api/x", "error", "boom")
		}
		buf.Flush(ctx, f.app.DB, "app-1")
		if err := m.alertIssues(ctx); err != nil {
			t.Fatal(err)
		}
	}
	alerts := func() (n int, escalated int) {
		f.app.DB.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE (payload->'params'->>'escalated')::bool)
			FROM events WHERE topic = 'notify' AND payload->>'type' = 'platform_issue'`).Scan(&n, &escalated)
		return
	}
	burst(12)
	if n, _ := alerts(); n != 1 {
		t.Fatalf("first burst sent %d alerts", n)
	}
	burst(12)
	if n, _ := alerts(); n != 1 {
		t.Errorf("doubling within the cooldown alerted again: %d", n)
	}
	burst(220)
	if n, escalated := alerts(); n != 2 || escalated != 1 {
		t.Errorf("a tenfold rise sent %d alerts (%d escalated), want 2 (1)", n, escalated)
	}
}

func TestIssueAlertsPastTheCooldownArePruned(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	f.exec(`INSERT INTO issue_alerts (fingerprint, alerted_at) VALUES ('old', now() - interval '7 hours'), ('recent', now() - interval '1 hour')`)
	if err := PruneIssueAlerts(ctx, f.app.DB); err != nil {
		t.Fatal(err)
	}
	rows, _ := f.app.DB.Query(ctx, `SELECT fingerprint FROM issue_alerts`)
	left, _ := pgx.CollectRows(rows, pgx.RowTo[string])
	if len(left) != 1 || left[0] != "recent" {
		t.Errorf("issue_alerts = %v, want only the one still in its cooldown", left)
	}
}

func TestBlocklistsAreCleanedStoredAndAnnounced(t *testing.T) {
	f := newFixture(t)
	f.call(http.MethodGet, "/platform/blocklists", "", f.climber, http.StatusForbidden)
	f.call(http.MethodPut, "/platform/blocklists", `{"blocked_emails": ["ok.test", "a b"], "protected_names": ["ab"]}`, f.operator, http.StatusBadRequest)
	got := f.call(http.MethodPut, "/platform/blocklists",
		`{"blocked_emails": [" Spam.Test ", "*.trash.test", "spam.test"], "protected_names": ["Gripello", "crew"]}`, f.operator, http.StatusOK)
	if fmt.Sprint(got["blocked_emails"], got["protected_names"]) != "[*.trash.test spam.test] [crew gripello]" {
		t.Errorf("lists = %v", got)
	}
	if e := f.lastEvent("platform_config.updated"); fmt.Sprint(e["changed"]) != "[blocked_emails protected_names]" || f.lastActor("platform_config.updated") != f.operator {
		t.Errorf("event = %v", e)
	}
	got = f.call(http.MethodPost, "/platform/blocklists/emails", `{"patterns": ["bad@example.com", "spam.test"]}`, f.operator, http.StatusOK)
	if fmt.Sprint(got["blocked_emails"]) != "[*.trash.test bad@example.com spam.test]" {
		t.Errorf("after add = %v", got)
	}
}

func TestBlockSuggestionsCountTheDomain(t *testing.T) {
	f := newFixture(t)
	spammer := f.user("one@spam.test", false)
	f.user("two@spam.test", false)
	other := f.user("three@spam.test", false)
	f.exec(`UPDATE users SET suspended_until = '9999-12-31' WHERE id = $1`, other)
	f.exec(`UPDATE platform_config SET blocked_emails = '{one@spam.test}'`)
	got := f.call(http.MethodGet, "/platform/users/"+spammer+"/block-suggestions", "", f.operator, http.StatusOK)
	if got["domain"] != "spam.test" || got["freemail"] != false || got["domain_accounts"] != 2.0 || got["domain_suspended"] != 1.0 ||
		got["email_blocked"] != true || got["domain_blocked"] != false {
		t.Errorf("suggestions = %v", got)
	}
	gmail := f.user("someone@gmail.com", false)
	if got := f.call(http.MethodGet, "/platform/users/"+gmail+"/block-suggestions", "", f.operator, http.StatusOK); got["freemail"] != true {
		t.Errorf("gmail = %v", got)
	}
	f.call(http.MethodGet, "/platform/users/nobody/block-suggestions", "", f.operator, http.StatusNotFound)
}

func TestParseSourceDomains(t *testing.T) {
	got, err := parseSourceDomains(strings.NewReader("# comment\nB.test\n\n a.test \nnot a domain\nlocalhost\nb.test\n-bad.test\n"))
	if err != nil || fmt.Sprint(got) != "[a.test b.test]" {
		t.Errorf("parse = %v %v", got, err)
	}
}

func TestEmailSourcesSyncToggleAndAllowlist(t *testing.T) {
	f := newFixture(t)
	lines := []string{"spam.test"}
	for i := range emailSourceMinDomains {
		lines = append(lines, fmt.Sprintf("trash%d.test", i))
	}
	body := strings.Join(lines, "\n")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/LICENSE" {
			io.WriteString(w, "Copyright (c) 2013 Francois-Guillaume Ribreau")
			return
		}
		io.WriteString(w, body)
	}))
	defer server.Close()
	original := emailSources
	emailSources = slices.Clone(original)
	emailSources[0].url = server.URL
	emailSources[1].url, emailSources[1].licenseURL = server.URL, server.URL+"/LICENSE"
	defer func() { emailSources = original }()
	ctx := context.Background()
	blocked := func(email string) bool {
		t.Helper()
		ok, err := blocklist.EmailBlocked(ctx, f.app.DB, email)
		if err != nil {
			t.Fatal(err)
		}
		return ok
	}

	f.call(http.MethodPut, "/platform/blocklists/sources/nope", `{"enabled": true}`, f.operator, http.StatusNotFound)
	got := f.call(http.MethodPut, "/platform/blocklists/sources/disposable-email-domains", `{"enabled": true}`, f.operator, http.StatusOK)
	source := got["sources"].([]any)[0].(map[string]any)
	if source["enabled"] != true || source["domain_count"] != float64(emailSourceMinDomains+1) || source["synced_at"] == nil || source["license"] != "CC0-1.0" {
		t.Errorf("source = %v", source)
	}
	got = f.call(http.MethodPut, "/platform/blocklists/sources/mailchecker", `{"enabled": true}`, f.operator, http.StatusOK)
	if notice := got["sources"].([]any)[1].(map[string]any)["notice"]; !strings.Contains(fmt.Sprint(notice), "Francois-Guillaume Ribreau") {
		t.Errorf("mailchecker notice = %v", notice)
	}
	f.call(http.MethodPut, "/platform/blocklists/sources/mailchecker", `{"enabled": false}`, f.operator, http.StatusOK)
	listed := f.call(http.MethodGet, "/platform/blocklists/sources/disposable-email-domains/domains?q=SPAM&page=1", "", f.operator, http.StatusOK)
	if fmt.Sprint(listed["items"], listed["total"]) != "[spam.test] 1" {
		t.Errorf("filtered domains = %v", listed)
	}
	listed = f.call(http.MethodGet, "/platform/blocklists/sources/disposable-email-domains/domains?page=2", "", f.operator, http.StatusOK)
	if items := listed["items"].([]any); len(items) != 1 || listed["total"] != float64(emailSourceMinDomains+1) {
		t.Errorf("page 2 = %v", listed)
	}
	if listed := f.call(http.MethodGet, "/platform/blocklists/sources/disposable-email-domains/domains?q=%25", "", f.operator, http.StatusOK); listed["total"] != 0.0 {
		t.Errorf("%% matched as a wildcard: %v", listed)
	}
	if f.lastActor("platform_config.updated") != f.operator {
		t.Error("toggle not audited")
	}
	if !blocked("x@spam.test") || !blocked("x@mx.spam.test") || blocked("x@example.com") {
		t.Error("synced domains not applied")
	}

	f.call(http.MethodPut, "/platform/blocklists", `{"blocked_emails": [], "allowed_emails": ["vip@spam.test"], "protected_names": ["gripello"]}`, f.operator, http.StatusOK)
	if blocked("vip@spam.test") || !blocked("other@spam.test") {
		t.Error("allowlist does not override")
	}

	body = "spam.test"
	got = f.call(http.MethodPost, "/platform/blocklists/sources/disposable-email-domains/sync", "", f.operator, http.StatusOK)
	source = got["sources"].([]any)[0].(map[string]any)
	if source["domain_count"] != float64(emailSourceMinDomains+1) || !strings.Contains(fmt.Sprint(source["last_error"]), "keeping the previous list") {
		t.Errorf("a short download replaced the list: %v", source)
	}

	f.call(http.MethodPut, "/platform/blocklists/sources/disposable-email-domains", `{"enabled": false}`, f.operator, http.StatusOK)
	if blocked("other@spam.test") {
		t.Error("disabled source still blocks")
	}
}

func TestBlocklistCheckNamesTheRule(t *testing.T) {
	f := newFixture(t)
	f.exec(`UPDATE email_blocklist_sources SET enabled = true WHERE id = 'mailchecker'`)
	f.exec(`INSERT INTO disposable_domains (domain, source) VALUES ('trash.test', 'mailchecker')`)
	lists := `"blocked_emails": ["Spam.test"], "allowed_emails": ["vip@trash.test"], "protected_names": ["gripello"]`
	for email, want := range map[string]string{
		"x@spam.test":     "map[blocked:true match:spam.test rule:blocked]",
		"x@mx.trash.test": "map[blocked:true match:mailchecker rule:source]",
		"vip@trash.test":  "map[blocked:false match:vip@trash.test rule:allowed]",
		"x@example.com":   "map[blocked:false match: rule:]",
	} {
		got := f.call(http.MethodPost, "/platform/blocklists/check", `{"email": "`+email+`", `+lists+`}`, f.operator, http.StatusOK)
		if fmt.Sprint(got["email"]) != want || got["name"] != nil {
			t.Errorf("check %s = %v", email, got)
		}
	}
	got := f.call(http.MethodPost, "/platform/blocklists/check", `{"name": "Team North", `+lists+`}`, f.operator, http.StatusOK)
	if fmt.Sprint(got["name"]) != "map[match: protected:false]" {
		t.Errorf("free name = %v", got)
	}
	got = f.call(http.MethodPost, "/platform/blocklists/check", `{"name": "north", `+lists+`}`, f.operator, http.StatusOK)
	if fmt.Sprint(got["name"]) != "map[match:North protected:true]" {
		t.Errorf("gym name = %v", got)
	}
}

func TestEmailSourceErrorsAreStoredWhole(t *testing.T) {
	f := newFixture(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, strings.Repeat("ü", 600))
	}))
	defer server.Close()
	original := emailSources
	emailSources = slices.Clone(original)
	emailSources[0].url = server.URL
	defer func() { emailSources = original }()

	ctx, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequest(http.MethodPost, "/", nil).WithContext(ctx)
	cancel()
	(&module{app: f.app}).syncForRequest(request, emailSources[0])
	var lastError string
	f.app.DB.QueryRow(context.Background(), `SELECT last_error FROM email_blocklist_sources WHERE id = 'disposable-email-domains'`).Scan(&lastError)
	if !strings.Contains(lastError, "only 0 domains") {
		t.Errorf("a cancelled request aborted the sync: %q", lastError)
	}
	if got := truncate(strings.Repeat("ü", 600), 500); !utf8.ValidString(got) {
		t.Errorf("truncate split a rune: %q", got)
	}
}
