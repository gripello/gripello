package members

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/golang-jwt/jwt/v5"

	"gripello/internal/platform"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/tenancy"
	"gripello/internal/platform/testapp"
)

var allPermissions = []string{
	"manage_users", "manage_settings", "manage_routes", "view_analytics", "manage_comments", "run_inventory",
	"manage_tasks", "manage_competitions", "judge_competitions", "manage_reports",
}

var setterPermissions = []string{"manage_routes", "view_analytics", "manage_comments", "run_inventory", "manage_tasks", "manage_competitions", "judge_competitions"}

type sentMail struct{ to, text string }

type fakeMailer struct {
	mu   sync.Mutex
	sent []sentMail
}

func (m *fakeMailer) Send(_ context.Context, to, _, _, text string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, sentMail{to, text})
	return nil
}

func (m *fakeMailer) last() (sentMail, int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.sent) == 0 {
		return sentMail{}, 0
	}
	return m.sent[len(m.sent)-1], len(m.sent)
}

type fixture struct {
	t                                           *testing.T
	app                                         *platform.App
	mail                                        *fakeMailer
	handler                                     http.Handler
	gymA, gymB                                  string
	adminRoleA, setterRoleA, adminRoleB         string
	setterRoleB                                 string
	adminA, setterA, setterB, climber, operator string
	tokenKeys                                   map[string]string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	app := testapp.App(t)
	f := &fixture{t: t, app: app, mail: &fakeMailer{}, tokenKeys: map[string]string{}}
	app.Mail = f.mail
	Register(app)
	f.handler = testapp.Handler(app)
	f.gymA = f.gym("gym-a", "A")
	f.gymB = f.gym("gym-b", "B")
	f.adminRoleA = f.role(f.gymA, "admin", allPermissions)
	f.setterRoleA = f.role(f.gymA, "routesetter", setterPermissions)
	f.adminRoleB = f.role(f.gymB, "admin", allPermissions)
	f.setterRoleB = f.role(f.gymB, "routesetter", setterPermissions)
	f.adminA = f.user("admin-a@example.com", false)
	f.setterA = f.user("setter-a@example.com", false)
	f.setterB = f.user("setter-b@example.com", false)
	f.climber = f.user("climber@example.com", false)
	f.operator = f.user("operator@example.com", true)
	f.member(f.adminA, f.gymA, f.adminRoleA)
	f.member(f.setterA, f.gymA, f.setterRoleA)
	f.member(f.setterB, f.gymB, f.setterRoleB)
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

func (f *fixture) gym(slug, name string) string {
	id := ids.New()
	f.exec(`INSERT INTO gyms (id, slug, name, active) VALUES ($1, $2, $3, true)`, id, slug, name)
	return id
}

func (f *fixture) role(gym, name string, permissions []string) string {
	id := ids.New()
	f.exec(`INSERT INTO roles (id, gym, name, permissions) VALUES ($1, $2, $3, $4)`, id, gym, name, permissions)
	return id
}

func (f *fixture) user(email string, platformAdmin bool) string {
	id, key := ids.New(), ids.New()+ids.New()
	f.exec(`INSERT INTO users (id, email, token_key, username, platform_admin) VALUES ($1, $2, $3, $4, $5)`,
		id, email, key, strings.NewReplacer("@", "_", ".", "_").Replace(email), platformAdmin)
	f.tokenKeys[id] = key
	return id
}

func (f *fixture) member(user, gym, role string) string {
	id := ids.New()
	f.exec(`INSERT INTO memberships (id, "user", gym, role) VALUES ($1, $2, $3, $4)`, id, user, gym, role)
	return id
}

func (f *fixture) membershipOf(user, gym string) string {
	var id string
	f.app.DB.QueryRow(context.Background(), `SELECT id FROM memberships WHERE "user" = $1 AND gym = $2`, user, gym).Scan(&id)
	return id
}

func (f *fixture) can(user, gym, permission string) bool {
	return tenancy.New(f.app.DB).Can(context.Background(), user, gym, permission)
}

func (f *fixture) call(method, url, body, caller string, status int, content ...string) string {
	f.t.Helper()
	request := httptest.NewRequest(method, "/api"+url, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if caller != "" {
		token, err := f.app.Tokens.Sign(caller, f.tokenKeys[caller], "")
		if err != nil {
			f.t.Fatal(err)
		}
		request.Header.Set("Authorization", token)
	}
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, request)
	if recorder.Code != status {
		f.t.Fatalf("%s %s = %d, want %d: %s", method, url, recorder.Code, status, recorder.Body)
	}
	if len(content) == 0 && status == http.StatusAccepted && recorder.Body.Len() != 0 {
		f.t.Errorf("%s %s: expected empty body, got %s", method, url, recorder.Body)
	}
	for _, item := range content {
		if !strings.Contains(recorder.Body.String(), item) {
			f.t.Errorf("%s %s: %q missing in %s", method, url, item, recorder.Body)
		}
	}
	return recorder.Body.String()
}

var inviteLinkPattern = regexp.MustCompile(`/auth/invite/([A-Za-z0-9]+)`)

func (f *fixture) invite(caller, gym, email, role string) string {
	f.t.Helper()
	_, sent := f.mail.last()
	f.call(http.MethodPost, "/gyms/"+gym+"/members", `{"email":"`+email+`","role":"`+role+`","firstname":"New"}`, caller, http.StatusAccepted)
	message, total := f.mail.last()
	if total != sent+1 {
		f.t.Fatalf("invite mail to %s not sent", email)
	}
	if message.to != strings.ToLower(strings.TrimSpace(email)) {
		f.t.Fatalf("invite mail went to %s", message.to)
	}
	match := inviteLinkPattern.FindStringSubmatch(message.text)
	if match == nil {
		f.t.Fatalf("no invite link in %q", message.text)
	}
	return match[1]
}

func (f *fixture) events(kind, action string) []map[string]any {
	f.t.Helper()
	rows, err := f.app.DB.Query(context.Background(), `SELECT payload FROM events WHERE kind = $1 ORDER BY id`, kind)
	if err != nil {
		f.t.Fatal(err)
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var raw []byte
		rows.Scan(&raw)
		var payload map[string]any
		json.Unmarshal(raw, &payload)
		if payload["action"] == action {
			out = append(out, payload)
		}
	}
	return out
}

func TestPermissionsArePerGym(t *testing.T) {
	f := newFixture(t)
	cases := []struct {
		user, gym, permission string
		want                  bool
	}{
		{f.adminA, f.gymA, "manage_users", true},
		{f.adminA, f.gymB, "manage_users", false},
		{f.setterA, f.gymA, "manage_routes", true},
		{f.setterA, f.gymA, "manage_users", false},
		{f.setterA, f.gymB, "manage_routes", false},
		{f.climber, f.gymA, "manage_routes", false},
	}
	for _, c := range cases {
		if got := f.can(c.user, c.gym, c.permission); got != c.want {
			t.Errorf("can(%s, %s, %s) = %v", c.user, c.gym, c.permission, got)
		}
	}
}

func TestCallerMayAssignRole(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	cases := []struct {
		name   string
		caller auth.Principal
		role   string
		want   bool
	}{
		{"admin assigns admin", auth.Principal{UserID: f.adminA}, f.adminRoleA, true},
		{"admin assigns setter", auth.Principal{UserID: f.adminA}, f.setterRoleA, true},
		{"setter assigns admin", auth.Principal{UserID: f.setterA}, f.adminRoleA, false},
		{"admin of A assigns a role of B", auth.Principal{UserID: f.adminA}, f.setterRoleB, false},
		{"climber assigns setter", auth.Principal{UserID: f.climber}, f.setterRoleA, false},
		{"platform admin assigns admin of B", auth.Principal{UserID: f.operator, PlatformAdmin: true}, f.adminRoleB, true},
		{"climber assigns admin of B", auth.Principal{UserID: f.climber}, f.adminRoleB, false},
	}
	for _, c := range cases {
		r, err := findRole(ctx, f.app.DB, c.role)
		if err != nil {
			t.Fatal(err)
		}
		if got := callerMayAssignRole(ctx, f.app.DB, c.caller, r); got != c.want {
			t.Errorf("%s: got %v", c.name, got)
		}
	}
}

func TestChangeMembershipRole(t *testing.T) {
	f := newFixture(t)
	setterMembership := f.membershipOf(f.setterA, f.gymA)
	f.call(http.MethodPost, "/memberships/"+setterMembership+"/role", `{"role":"`+f.setterRoleB+`"}`, f.adminA, http.StatusBadRequest, "role")
	f.call(http.MethodPost, "/memberships/"+setterMembership+"/role", `{"role":"`+f.adminRoleA+`"}`, f.setterA, http.StatusForbidden)
	f.call(http.MethodPost, "/memberships/"+f.membershipOf(f.setterB, f.gymB)+"/role", `{"role":"`+f.setterRoleB+`"}`, f.adminA, http.StatusNotFound)

	manager := f.role(f.gymA, "manager", []string{"manage_users", "manage_routes"})
	managerUser := f.user("manager@example.com", false)
	f.member(managerUser, f.gymA, manager)
	f.call(http.MethodPost, "/memberships/"+setterMembership+"/role", `{"role":"`+manager+`"}`, managerUser, http.StatusForbidden, "do not hold")

	f.call(http.MethodPost, "/memberships/"+setterMembership+"/role", `{"role":"`+manager+`"}`, f.adminA, http.StatusOK, `"role":"`+manager+`"`)
	changed := f.events(KindMembershipChanged, "updated")
	if len(changed) != 1 || !slices.Contains(toStrings(changed[0]["removed"]), "manage_tasks") || !slices.Contains(toStrings(changed[0]["added"]), "manage_users") {
		t.Errorf("membership.changed = %v", changed)
	}
	if toStrings(changed[0]["users"])[0] != f.setterA {
		t.Errorf("affected users = %v", changed[0]["users"])
	}
	var audience string
	f.app.DB.QueryRow(context.Background(), `SELECT audience::text FROM events WHERE kind = $1`, KindMembershipChanged).Scan(&audience)
	if !strings.Contains(audience, f.setterA) || !strings.Contains(audience, f.gymA+":manage_users") {
		t.Errorf("membership.changed audience = %s", audience)
	}
	if f.count(`SELECT count(*) FROM events WHERE topic NOT LIKE 'gym:%'`) != 0 {
		t.Error("event published outside the gym topic")
	}
}

func TestGymKeepsAnAdmin(t *testing.T) {
	f := newFixture(t)
	adminMembership := f.membershipOf(f.adminA, f.gymA)
	f.call(http.MethodPost, "/memberships/"+adminMembership+"/role", `{"role":"`+f.setterRoleA+`"}`, f.adminA, http.StatusBadRequest, "at least one admin")
	f.call(http.MethodDelete, "/memberships/"+adminMembership, "", f.adminA, http.StatusBadRequest, "at least one admin")
	f.call(http.MethodDelete, "/memberships/"+adminMembership, "", f.operator, http.StatusBadRequest, "at least one admin")

	second := f.user("admin2@example.com", false)
	f.member(second, f.gymA, f.adminRoleA)
	f.call(http.MethodPost, "/memberships/"+adminMembership+"/role", `{"role":"`+f.setterRoleA+`"}`, second, http.StatusOK)
	if f.can(f.adminA, f.gymA, "manage_users") {
		t.Error("demoted admin kept manage_users")
	}
}

func TestDeleteMembership(t *testing.T) {
	f := newFixture(t)
	adminMembership := f.membershipOf(f.adminA, f.gymA)
	f.call(http.MethodDelete, "/memberships/"+adminMembership, "", f.setterA, http.StatusNotFound)
	f.call(http.MethodDelete, "/memberships/"+adminMembership, "", "", http.StatusUnauthorized)

	manager := f.role(f.gymA, "manager", []string{"manage_users"})
	managerUser := f.user("manager@example.com", false)
	f.member(managerUser, f.gymA, manager)
	f.call(http.MethodDelete, "/memberships/"+f.membershipOf(f.setterA, f.gymA), "", managerUser, http.StatusForbidden, "do not hold")

	f.call(http.MethodDelete, "/memberships/"+f.membershipOf(f.setterA, f.gymA), "", f.setterA, http.StatusNoContent)
	if f.membershipOf(f.setterA, f.gymA) != "" {
		t.Error("setter could not leave")
	}
	deleted := f.events(KindMembershipChanged, "deleted")
	if len(deleted) != 1 || !slices.Contains(toStrings(deleted[0]["removed"]), "manage_tasks") {
		t.Errorf("membership.changed deleted = %v", deleted)
	}
	f.call(http.MethodDelete, "/memberships/"+f.membershipOf(managerUser, f.gymA), "", f.adminA, http.StatusNoContent)
}

func TestListMembersAndOwnMemberships(t *testing.T) {
	f := newFixture(t)
	f.call(http.MethodGet, "/gyms/"+f.gymA+"/members", "", f.adminA, http.StatusOK, `"username":"setter-a_example_com"`, `"name":"routesetter"`)
	f.call(http.MethodGet, "/gyms/"+f.gymA+"/members", "", f.operator, http.StatusOK, `"username":"admin-a_example_com"`)
	f.call(http.MethodGet, "/gyms/"+f.gymA+"/members", "", f.setterA, http.StatusForbidden)
	body := f.call(http.MethodGet, "/me/memberships", "", f.setterA, http.StatusOK, `"slug":"gym-a"`, `"manage_routes"`)
	if strings.Contains(body, "gym-b") {
		t.Errorf("own memberships leak another gym: %s", body)
	}
	f.call(http.MethodGet, "/me/memberships", "", "", http.StatusUnauthorized)
	if body := f.call(http.MethodGet, "/gyms/"+f.gymA+"/members", "", f.adminA, http.StatusOK); strings.Contains(body, "@example.com") {
		t.Errorf("hidden e-mails exposed: %s", body)
	}
}

func TestRoles(t *testing.T) {
	f := newFixture(t)
	f.call(http.MethodGet, "/gyms/"+f.gymA+"/roles", "", f.setterA, http.StatusOK, `"routesetter"`)
	f.call(http.MethodGet, "/gyms/"+f.gymA+"/roles", "", f.operator, http.StatusOK, `"admin"`)
	f.call(http.MethodGet, "/gyms/"+f.gymA+"/roles", "", f.setterB, http.StatusForbidden)
	f.call(http.MethodGet, "/gyms/"+f.gymA+"/roles", "", "", http.StatusUnauthorized)

	f.call(http.MethodPost, "/gyms/"+f.gymA+"/roles", `{"name":"helper","permissions":["manage_routes"]}`, f.setterA, http.StatusForbidden)
	f.call(http.MethodPost, "/gyms/"+f.gymA+"/roles", `{"name":"helper","permissions":["fly"]}`, f.adminA, http.StatusBadRequest, "permissions")
	f.call(http.MethodPost, "/gyms/"+f.gymA+"/roles", `{"name":"","permissions":[]}`, f.adminA, http.StatusBadRequest, "name")
	f.call(http.MethodPost, "/gyms/"+f.gymA+"/roles", `{"name":"routesetter","permissions":[]}`, f.adminA, http.StatusBadRequest, "validation_not_unique")

	manager := f.role(f.gymA, "manager", []string{"manage_users", "manage_routes"})
	managerUser := f.user("manager@example.com", false)
	f.member(managerUser, f.gymA, manager)
	f.call(http.MethodPost, "/gyms/"+f.gymA+"/roles", `{"name":"helper","permissions":["manage_tasks"]}`, managerUser, http.StatusForbidden, "do not hold")
	created := f.call(http.MethodPost, "/gyms/"+f.gymA+"/roles", `{"name":"helper","permissions":["manage_routes"]}`, managerUser, http.StatusOK, `"name":"helper"`)
	var helper role
	json.Unmarshal([]byte(created), &helper)

	f.call(http.MethodPut, "/roles/"+f.setterRoleA+"/permissions", `{"permissions":["manage_routes"]}`, managerUser, http.StatusForbidden, "grant or revoke")
	f.call(http.MethodPut, "/roles/"+helper.ID+"/permissions", `{"permissions":["manage_routes","manage_users"]}`, managerUser, http.StatusOK, `"manage_users"`)

	helperUser := f.user("helper@example.com", false)
	f.member(helperUser, f.gymA, helper.ID)
	f.call(http.MethodPut, "/roles/"+f.setterRoleA+"/permissions", `{"permissions":["manage_routes"]}`, f.adminA, http.StatusOK)
	changed := f.events(KindRoleChanged, "updated")
	last := changed[len(changed)-1]
	if !slices.Contains(toStrings(last["removed"]), "manage_tasks") || !slices.Equal(toStrings(last["users"]), []string{f.setterA}) {
		t.Errorf("role.changed = %v", last)
	}

	f.call(http.MethodPatch, "/roles/"+f.adminRoleA, `{"name":"boss"}`, f.adminA, http.StatusForbidden, "admin role")
	f.call(http.MethodPatch, "/roles/"+f.adminRoleA, `{"name":"boss"}`, f.operator, http.StatusForbidden, "admin role")
	f.call(http.MethodPut, "/roles/"+f.adminRoleA+"/permissions", `{"permissions":["manage_users"]}`, f.adminA, http.StatusForbidden, "admin role")
	f.call(http.MethodPatch, "/roles/"+f.adminRoleA, `{"color":"#ff0000"}`, f.adminA, http.StatusOK, `"color":"#ff0000"`)
	f.call(http.MethodPatch, "/roles/"+helper.ID, `{"name":"assistant","description":"Helps"}`, f.adminA, http.StatusOK, `"name":"assistant"`)
	f.call(http.MethodPatch, "/roles/"+helper.ID, `{"name":"x"}`, f.setterA, http.StatusForbidden)

	f.call(http.MethodDelete, "/roles/"+helper.ID, "", f.adminA, http.StatusConflict, "still assigned")
	f.exec(`DELETE FROM memberships WHERE "user" = $1`, helperUser)
	f.call(http.MethodDelete, "/roles/"+helper.ID, "", f.setterA, http.StatusForbidden)
	f.call(http.MethodDelete, "/roles/"+helper.ID, "", f.adminA, http.StatusNoContent)
	f.call(http.MethodDelete, "/roles/"+helper.ID, "", f.adminA, http.StatusNotFound)
}

func TestAdminRoleCannotBeDeleted(t *testing.T) {
	f := newFixture(t)
	f.call(http.MethodDelete, "/roles/"+f.adminRoleA, "", f.operator, http.StatusForbidden, "admin role")
	f.call(http.MethodDelete, "/roles/"+f.adminRoleA, "", f.adminA, http.StatusForbidden, "admin role")
	if f.count(`SELECT count(*) FROM roles WHERE id = $1`, f.adminRoleA) != 1 {
		t.Error("admin role deleted")
	}
}

func TestInviteMember(t *testing.T) {
	cases := []struct {
		name   string
		caller func(*fixture) string
		email  string
		status int
	}{
		{"setter may not invite", func(f *fixture) string { return f.setterA }, "climber@example.com", http.StatusForbidden},
		{"already a member", func(f *fixture) string { return f.adminA }, "setter-a@example.com", http.StatusConflict},
		{"existing account", func(f *fixture) string { return f.adminA }, "climber@example.com", http.StatusAccepted},
		{"unknown address", func(f *fixture) string { return f.adminA }, "new@example.com", http.StatusAccepted},
		{"invalid address", func(f *fixture) string { return f.adminA }, "not-an-address", http.StatusBadRequest},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newFixture(t)
			users := f.count(`SELECT count(*) FROM users`)
			var content []string
			if c.status != http.StatusAccepted {
				content = []string{"{"}
			}
			f.call(http.MethodPost, "/gyms/"+f.gymA+"/members", `{"email":"`+c.email+`","role":"`+f.setterRoleA+`"}`, c.caller(f), c.status, content...)
			if after := f.count(`SELECT count(*) FROM users`); after != users {
				t.Errorf("users %d -> %d", users, after)
			}
			if f.can(f.climber, f.gymA, "manage_routes") {
				t.Error("climber became a member before accepting")
			}
			if invites := f.count(`SELECT count(*) FROM invites`); (invites == 1) != (c.status == http.StatusAccepted) {
				t.Errorf("invites = %d", invites)
			}
		})
	}
}

func TestInviteRejectsForeignAndHigherRoles(t *testing.T) {
	f := newFixture(t)
	f.call(http.MethodPost, "/gyms/"+f.gymA+"/members", `{"email":"new@example.com","role":"`+f.setterRoleB+`"}`, f.adminA, http.StatusBadRequest, "role")
	manager := f.role(f.gymA, "manager", []string{"manage_users"})
	managerUser := f.user("manager@example.com", false)
	f.member(managerUser, f.gymA, manager)
	f.call(http.MethodPost, "/gyms/"+f.gymA+"/members", `{"email":"new@example.com","role":"`+f.setterRoleA+`"}`, managerUser, http.StatusForbidden)
	if f.count(`SELECT count(*) FROM invites`) != 0 {
		t.Error("invite saved")
	}
}

func TestInviteNewAccount(t *testing.T) {
	f := newFixture(t)
	first := f.invite(f.adminA, f.gymA, "new@example.com", f.adminRoleA)
	token := f.invite(f.adminA, f.gymA, "New@Example.com ", f.setterRoleA)
	if total := f.count(`SELECT count(*) FROM invites`); total != 1 {
		t.Fatalf("resend created %d invites", total)
	}
	if f.count(`SELECT count(*) FROM invites WHERE token_hash = $1 AND expires_at > now() + interval '6 days'`, hashToken(token)) != 1 {
		t.Error("invite token not stored as sha256 with 7 days validity")
	}
	for _, action := range []string{"created", "updated"} {
		if got := len(f.events(KindInviteChanged, action)); got != 1 {
			t.Errorf("invite %s events = %d, want 1", action, got)
		}
	}
	f.call(http.MethodGet, "/invites/"+first, "", "", http.StatusNotFound, "{")
	f.call(http.MethodGet, "/invites/"+token, "", "", http.StatusOK, `"hasAccount":false`, `"role":"routesetter"`, `"slug":"gym-a"`)

	f.call(http.MethodPost, "/invites/"+token+"/accept", `{"password":"short","passwordConfirm":"short"}`, "", http.StatusBadRequest, "password")
	f.call(http.MethodPost, "/invites/"+token+"/accept", `{"password":"1234567890","passwordConfirm":"0987654321"}`, "", http.StatusBadRequest, "passwordConfirm")
	acceptedBody := f.call(http.MethodPost, "/invites/"+token+"/accept", `{"password":"1234567890","passwordConfirm":"1234567890","firstname":"New"}`, "", http.StatusOK, `"token":`, `"gym":"gym-a"`)
	var acceptResponse struct {
		Token string `json:"token"`
	}
	json.Unmarshal([]byte(acceptedBody), &acceptResponse)
	var claims auth.Claims
	if _, _, err := jwt.NewParser().ParseUnverified(acceptResponse.Token, &claims); err != nil || claims.SessionID == "" {
		t.Fatalf("token without sid: %v", err)
	}
	if f.count(`SELECT count(*) FROM sessions s JOIN users u ON u.id = s."user" WHERE s.id = $1 AND s.method = 'invite' AND s.last_seen IS NOT NULL AND u.email = 'new@example.com'`, claims.SessionID) != 1 {
		t.Error("no sessions row backs the invite token")
	}
	if _, err := auth.Verify(context.Background(), f.app.DB, f.app.Cfg.TokenSecret, acceptResponse.Token); err != nil {
		t.Errorf("invite token does not verify: %v", err)
	}

	var userID, firstname string
	var verified bool
	if err := f.app.DB.QueryRow(context.Background(), `SELECT id, firstname, verified, token_key FROM users WHERE email = 'new@example.com'`).
		Scan(&userID, &firstname, &verified, new(string)); err != nil {
		t.Fatal(err)
	}
	if !verified || firstname != "New" {
		t.Errorf("unexpected account: verified=%v firstname=%q", verified, firstname)
	}
	if !f.can(userID, f.gymA, "manage_routes") || f.can(userID, f.gymA, "manage_users") {
		t.Error("membership does not carry the resent role")
	}
	accepted := f.events(KindInviteChanged, "accepted")
	if len(accepted) != 1 || !slices.Equal(toStrings(accepted[0]["users"]), []string{userID}) {
		t.Errorf("invite accepted events = %v", accepted)
	}
	if created := f.events(KindMembershipChanged, "created"); len(created) != 1 || created[0]["id"] != f.membershipOf(userID, f.gymA) {
		t.Errorf("membership created events = %v", created)
	}
	var key string
	f.app.DB.QueryRow(context.Background(), `SELECT token_key FROM users WHERE id = $1`, userID).Scan(&key)
	f.tokenKeys[userID] = key
	f.call(http.MethodPost, "/invites/"+token+"/accept", `{}`, userID, http.StatusNotFound, "{")
}

func TestInviteExistingAccount(t *testing.T) {
	f := newFixture(t)
	token := f.invite(f.adminA, f.gymA, "climber@example.com", f.setterRoleA)
	f.call(http.MethodGet, "/invites/"+token, "", "", http.StatusOK, `"hasAccount":true`)
	f.call(http.MethodPost, "/invites/"+token+"/accept", `{"password":"1234567890","passwordConfirm":"1234567890"}`, "", http.StatusConflict, "{")
	f.call(http.MethodPost, "/invites/"+token+"/accept", `{}`, f.setterB, http.StatusForbidden, "{")
	if f.can(f.setterB, f.gymA, "manage_routes") {
		t.Fatal("another account accepted the invite")
	}
	f.call(http.MethodPost, "/invites/"+token+"/accept", `{}`, f.climber, http.StatusOK, `"gym":"gym-a"`)
	if !f.can(f.climber, f.gymA, "manage_routes") {
		t.Error("climber did not join")
	}
}

func TestInviteRevokeAndExpiry(t *testing.T) {
	f := newFixture(t)
	revoked := f.invite(f.adminA, f.gymA, "revoked@example.com", f.setterRoleA)
	var inviteID string
	f.app.DB.QueryRow(context.Background(), `SELECT id FROM invites WHERE email = 'revoked@example.com'`).Scan(&inviteID)
	f.call(http.MethodGet, "/gyms/"+f.gymA+"/invites", "", f.setterA, http.StatusForbidden)
	f.call(http.MethodGet, "/gyms/"+f.gymA+"/invites", "", f.adminA, http.StatusOK, `"email":"revoked@example.com"`, `"role_name":"routesetter"`)
	f.call(http.MethodDelete, "/invites/"+inviteID, "", f.setterA, http.StatusNotFound)
	f.call(http.MethodDelete, "/invites/"+inviteID, "", f.adminA, http.StatusNoContent)
	f.call(http.MethodGet, "/invites/"+revoked, "", "", http.StatusNotFound, "{")

	expired := f.invite(f.adminA, f.gymA, "expired@example.com", f.setterRoleA)
	f.exec(`UPDATE invites SET expires_at = now() - interval '1 minute' WHERE email = 'expired@example.com'`)
	f.call(http.MethodGet, "/invites/"+expired, "", "", http.StatusNotFound, "{")
	f.call(http.MethodPost, "/invites/"+expired+"/accept", `{}`, f.climber, http.StatusNotFound, "{")
	kept := f.invite(f.adminA, f.gymA, "kept@example.com", f.setterRoleA)
	if err := pruneExpiredInvites(context.Background(), f.app.DB); err != nil {
		t.Fatal(err)
	}
	if total := f.count(`SELECT count(*) FROM invites`); total != 1 {
		t.Errorf("invites after prune = %d, want only the unexpired one", total)
	}
	f.call(http.MethodGet, "/invites/"+kept, "", "", http.StatusOK, `"email":"kept@example.com"`)
}

func TestDeletingGymRemovesInvites(t *testing.T) {
	f := newFixture(t)
	f.invite(f.adminA, f.gymA, "new@example.com", f.setterRoleA)
	f.exec(`DELETE FROM memberships WHERE gym = $1`, f.gymA)
	f.exec(`DELETE FROM gyms WHERE id = $1`, f.gymA)
	if total := f.count(`SELECT count(*) FROM invites`); total != 0 {
		t.Errorf("invites left after gym delete: %d", total)
	}
}

func TestPlatformAdminInvitesFirstAdmin(t *testing.T) {
	f := newFixture(t)
	f.call(http.MethodPost, "/gyms/"+f.gymB+"/members", `{"email":"climber@example.com","role":"`+f.adminRoleB+`"}`, f.operator, http.StatusAccepted)
	if f.count(`SELECT count(*) FROM invites WHERE gym = $1 AND role = $2`, f.gymB, f.adminRoleB) != 1 {
		t.Error("no pending admin invite for B")
	}
}

func TestPermissionHelpers(t *testing.T) {
	if !adminRoleChangeAllowed("routesetter", "x", []string{"a"}, nil) {
		t.Error("non-admin role change blocked")
	}
	if adminRoleChangeAllowed("admin", "boss", []string{"a"}, []string{"a"}) || adminRoleChangeAllowed("admin", "admin", []string{"a", "b"}, []string{"a"}) {
		t.Error("admin role renamed or lost permissions")
	}
	if !adminRoleChangeAllowed("admin", "admin", []string{"a"}, []string{"a", "b"}) {
		t.Error("admin role may not gain permissions")
	}
	if got := addedPermissions([]string{"a", "b"}, []string{"b", "c"}); !slices.Equal(got, []string{"c"}) {
		t.Errorf("addedPermissions = %v", got)
	}
}

func toStrings(v any) []string {
	items, _ := v.([]any)
	out := make([]string, 0, len(items))
	for _, item := range items {
		s, _ := item.(string)
		out = append(out, s)
	}
	return out
}

func TestListMembersQuery(t *testing.T) {
	f := newFixture(t)
	f.exec(`UPDATE users SET firstname = 'Ann', email_visibility = true WHERE id = $1`, f.setterA)
	var list struct {
		Items []member `json:"items"`
		Page  int      `json:"page"`
		Limit int      `json:"limit"`
		Total *int     `json:"total"`
	}
	get := func(query string) {
		t.Helper()
		list.Items, list.Total = nil, nil
		json.Unmarshal([]byte(f.call(http.MethodGet, "/gyms/"+f.gymA+"/members?"+query, "", f.adminA, http.StatusOK)), &list)
	}
	get("")
	if len(list.Items) != 2 || list.Total != nil {
		t.Errorf("all members = %d, total %v", len(list.Items), list.Total)
	}
	get("q=ann&total=true")
	if len(list.Items) != 1 || list.Items[0].User.ID != f.setterA || *list.Total != 1 {
		t.Errorf("search by name = %+v", list)
	}
	get("q=setter-a%40example")
	if len(list.Items) != 1 {
		t.Errorf("search by visible e-mail = %d", len(list.Items))
	}
	get("q=admin-a_example")
	if len(list.Items) != 1 || list.Items[0].User.ID != f.adminA {
		t.Errorf("search by username = %d", len(list.Items))
	}
	f.exec(`UPDATE users SET username = 'aaa' WHERE id = $1`, f.adminA)
	get("q=admin-a%40example")
	if len(list.Items) != 0 {
		t.Error("search matched a hidden e-mail")
	}
	get("role=" + f.adminRoleA + "&total=true")
	if len(list.Items) != 1 || list.Items[0].User.ID != f.adminA || *list.Total != 1 {
		t.Errorf("role filter = %+v", list.Items)
	}
	get("sort=-created&page=2&limit=1&total=true")
	if len(list.Items) != 1 || list.Items[0].User.ID != f.adminA || list.Page != 2 || list.Limit != 1 || *list.Total != 2 {
		t.Errorf("paged = %+v", list)
	}
	f.call(http.MethodGet, "/gyms/"+f.gymA+"/members?sort=password", "", f.adminA, http.StatusBadRequest, "sort")
}

func TestRoleListsCountAndSearch(t *testing.T) {
	f := newFixture(t)
	var roles []listedRole
	json.Unmarshal([]byte(f.call(http.MethodGet, "/gyms/"+f.gymA+"/roles", "", f.setterA, http.StatusOK)), &roles)
	if len(roles) != 2 || roles[0].Name != "admin" || roles[0].Members != 1 || roles[1].Members != 1 || roles[0].GymSlug != "" {
		t.Errorf("roles = %+v", roles)
	}
	json.Unmarshal([]byte(f.call(http.MethodGet, "/gyms/"+f.gymA+"/roles?q=SET&limit=5", "", f.setterA, http.StatusOK)), &roles)
	if len(roles) != 1 || roles[0].ID != f.setterRoleA {
		t.Errorf("searched roles = %+v", roles)
	}
	f.call(http.MethodGet, "/platform/roles", "", f.adminA, http.StatusForbidden)
	json.Unmarshal([]byte(f.call(http.MethodGet, "/platform/roles?q=setter", "", f.operator, http.StatusOK)), &roles)
	if len(roles) != 2 || roles[0].GymSlug != "gym-a" || roles[1].GymName != "B" {
		t.Errorf("platform roles = %+v", roles)
	}
}

func TestDeleteRoleReassignsHolders(t *testing.T) {
	f := newFixture(t)
	crew := f.role(f.gymA, "crew", []string{"manage_routes", "manage_tasks"})
	crewUser := f.user("crew@example.com", false)
	membership := f.member(crewUser, f.gymA, crew)
	f.call(http.MethodDelete, "/roles/"+crew+"?reassign_to="+f.setterRoleB, "", f.adminA, http.StatusBadRequest, "reassign_to")
	f.call(http.MethodDelete, "/roles/"+crew+"?reassign_to="+crew, "", f.adminA, http.StatusBadRequest, "reassign_to")

	manager := f.role(f.gymA, "manager", []string{"manage_users", "manage_routes", "manage_tasks"})
	managerUser := f.user("manager@example.com", false)
	f.member(managerUser, f.gymA, manager)
	f.call(http.MethodDelete, "/roles/"+crew+"?reassign_to="+f.adminRoleA, "", managerUser, http.StatusForbidden)
	if f.count(`SELECT count(*) FROM memberships WHERE role = $1`, crew) != 1 {
		t.Fatal("holders moved although the delete failed")
	}

	f.call(http.MethodDelete, "/roles/"+crew+"?reassign_to="+manager, "", managerUser, http.StatusNoContent)
	if f.membershipOf(crewUser, f.gymA) != membership || !f.can(crewUser, f.gymA, "manage_users") {
		t.Error("holder not moved to the new role")
	}
	moved := f.events(KindMembershipChanged, "updated")
	if len(moved) != 1 || moved[0]["id"] != membership || !slices.Equal(toStrings(moved[0]["added"]), []string{"manage_users"}) {
		t.Errorf("membership.changed = %v", moved)
	}
	if len(f.events(KindRoleChanged, "deleted")) != 1 {
		t.Error("role.changed deleted missing")
	}
}

func TestAddMembershipDirectly(t *testing.T) {
	f := newFixture(t)
	body := `{"user":"` + f.climber + `","role":"` + f.setterRoleB + `"}`
	f.call(http.MethodPost, "/gyms/"+f.gymB+"/memberships", body, f.adminA, http.StatusForbidden)
	f.call(http.MethodPost, "/gyms/"+f.gymA+"/memberships", `{"user":"`+f.climber+`","role":"`+f.setterRoleA+`"}`, f.adminA, http.StatusForbidden)
	f.call(http.MethodPost, "/gyms/"+f.gymA+"/memberships", `{"user":"nobody","role":"`+f.setterRoleA+`"}`, f.adminA, http.StatusForbidden)
	f.call(http.MethodPost, "/gyms/"+f.gymA+"/memberships", body, f.operator, http.StatusBadRequest, "role")
	f.call(http.MethodPost, "/gyms/"+f.gymA+"/memberships", `{"user":"nobody","role":"`+f.setterRoleA+`"}`, f.operator, http.StatusBadRequest, "user")
	if f.can(f.climber, f.gymA, "manage_routes") {
		t.Error("gym staff attached a user without an invite")
	}

	f.call(http.MethodPost, "/gyms/"+f.gymB+"/memberships", body, f.operator, http.StatusOK, `"user":"`+f.climber+`"`)
	if !f.can(f.climber, f.gymB, "manage_routes") {
		t.Error("membership not created")
	}
	f.call(http.MethodPost, "/gyms/"+f.gymB+"/memberships", body, f.operator, http.StatusConflict)
	if created := f.events(KindMembershipChanged, "created"); len(created) != 1 || toStrings(created[0]["users"])[0] != f.climber {
		t.Errorf("membership.changed created = %v", created)
	}
}

func TestSetMembershipPublishesLikeTheAPI(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	id, err := SetMembership(ctx, f.app.DB, f.climber, f.gymA, f.setterRoleA)
	if err != nil || id != f.membershipOf(f.climber, f.gymA) {
		t.Fatalf("created %q, %v", id, err)
	}
	if again, err := SetMembership(ctx, f.app.DB, f.climber, f.gymA, f.adminRoleA); err != nil || again != id {
		t.Fatalf("updated %q, %v", again, err)
	}
	if _, err := SetMembership(ctx, f.app.DB, f.climber, f.gymA, ""); err != nil || f.membershipOf(f.climber, f.gymA) != "" {
		t.Fatalf("removed: %v", err)
	}
	created, updated, deleted := f.events(KindMembershipChanged, "created"), f.events(KindMembershipChanged, "updated"), f.events(KindMembershipChanged, "deleted")
	if len(created) != 1 || len(updated) != 1 || len(deleted) != 1 {
		t.Fatalf("events created=%v updated=%v deleted=%v", created, updated, deleted)
	}
	if updated[0]["previous_role"] != f.setterRoleA || updated[0]["role"] != f.adminRoleA || deleted[0]["previous_role"] != f.adminRoleA {
		t.Errorf("updated=%v deleted=%v", updated[0], deleted[0])
	}
}

func TestRoleGuards(t *testing.T) {
	f := newFixture(t)
	f.call(http.MethodPost, "/gyms/"+f.gymA+"/roles", `{"name":"Admin","permissions":[]}`, f.adminA, http.StatusBadRequest, "validation_not_unique")
	f.call(http.MethodPatch, "/roles/"+f.setterRoleA, `{"name":"admin"}`, f.operator, http.StatusBadRequest, "validation_not_unique")

	manager := f.role(f.gymA, "manager", []string{"manage_users", "manage_routes"})
	managerUser := f.user("manager@example.com", false)
	f.member(managerUser, f.gymA, manager)
	idle := f.role(f.gymA, "idle", []string{"manage_settings"})
	f.call(http.MethodPatch, "/roles/"+idle, `{"name":"renamed"}`, managerUser, http.StatusForbidden, "do not hold")
	f.call(http.MethodDelete, "/roles/"+idle, "", managerUser, http.StatusForbidden, "do not hold")

	f.invite(f.adminA, f.gymA, "pending@example.com", idle)
	f.call(http.MethodDelete, "/roles/"+idle, "", f.adminA, http.StatusNoContent)
	if deleted := f.events(KindInviteChanged, "deleted"); len(deleted) != 1 || f.count(`SELECT count(*) FROM invites`) != 0 {
		t.Errorf("invite.changed deleted = %v", deleted)
	}
}
