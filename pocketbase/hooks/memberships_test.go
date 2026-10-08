package hooks

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"
)

type memberFixture struct {
	app                               *tests.TestApp
	gymA, gymB                        *core.Record
	adminRoleA, setterRoleA           *core.Record
	setterRoleB                       *core.Record
	adminA, setterA, setterB, climber *core.Record
}

func gymRole(t *testing.T, app core.App, gymID, name string) *core.Record {
	t.Helper()
	role, err := app.FindFirstRecordByFilter("roles", "gym = {:gym} && name = {:name}", dbx.Params{"gym": gymID, "name": name})
	if err != nil {
		t.Fatalf("role %s of %s: %v", name, gymID, err)
	}
	return role
}

func saveUser(t *testing.T, app core.App, email string) *core.Record {
	t.Helper()
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	user := core.NewRecord(users)
	user.SetEmail(email)
	// The random default (users + 6 digits) occasionally collides across a fixture.
	user.Set("username", strings.NewReplacer("@", "_", "+", "_").Replace(email))
	user.SetPassword("1234567890")
	if err := app.Save(user); err != nil {
		t.Fatalf("saving user %s: %v", email, err)
	}
	return user
}

func newMemberFixture(t *testing.T) memberFixture {
	t.Helper()
	app := newGymTestApp(t)
	f := memberFixture{app: app}
	betas := map[string]bool{featureBetaVideos: true}
	f.gymA = saveRecord(t, app, "gyms", map[string]any{"slug": "gym-a", "name": "A", "active": true, "features": betas})
	f.gymB = saveRecord(t, app, "gyms", map[string]any{"slug": "gym-b", "name": "B", "active": true, "features": betas})
	f.adminRoleA = gymRole(t, app, f.gymA.Id, "admin")
	f.setterRoleA = gymRole(t, app, f.gymA.Id, "routesetter")
	f.setterRoleB = gymRole(t, app, f.gymB.Id, "routesetter")
	f.adminA = saveUser(t, app, "admin-a@example.com")
	f.setterA = saveUser(t, app, "setter-a@example.com")
	f.setterB = saveUser(t, app, "setter-b@example.com")
	f.climber = saveUser(t, app, "climber@example.com")
	for _, grant := range []struct{ user, gym, role *core.Record }{
		{f.adminA, f.gymA, f.adminRoleA},
		{f.setterA, f.gymA, f.setterRoleA},
		{f.setterB, f.gymB, f.setterRoleB},
	} {
		saveRecord(t, app, "memberships", map[string]any{"user": grant.user.Id, "gym": grant.gym.Id, "role": grant.role.Id})
	}
	return f
}

func userIDs(users []*core.Record) []string {
	ids := []string{}
	for _, user := range users {
		ids = append(ids, user.Id)
	}
	slices.Sort(ids)
	return ids
}

func TestPermissionsArePerGym(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()

	cases := []struct {
		user       *core.Record
		gym        *core.Record
		permission string
		want       bool
	}{
		{f.adminA, f.gymA, "manage_users", true},
		{f.adminA, f.gymB, "manage_users", false},
		{f.setterA, f.gymA, "manage_routes", true},
		{f.setterA, f.gymA, "manage_users", false},
		{f.setterA, f.gymB, "manage_routes", false},
		{f.climber, f.gymA, "manage_routes", false},
	}
	for _, c := range cases {
		if got := hasPermission(f.app, c.user.Id, c.gym.Id, c.permission); got != c.want {
			t.Errorf("hasPermission(%s, %s, %s) = %v", c.user.Email(), c.gym.GetString("slug"), c.permission, got)
		}
	}

	want := userIDs([]*core.Record{f.adminA, f.setterA})
	if got := userIDs(usersByPermission(f.app, f.gymA.Id, "manage_tasks")); !slices.Equal(got, want) {
		t.Errorf("task managers of A = %v, want %v", got, want)
	}
	if got := usersByPermission(f.app, f.gymB.Id, "manage_users"); len(got) != 0 {
		t.Errorf("gym B has user managers %v", userIDs(got))
	}
}

func TestCallerMayAssignRole(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()

	cases := []struct {
		name   string
		caller *core.Record
		role   *core.Record
		want   bool
	}{
		{"admin assigns admin", f.adminA, f.adminRoleA, true},
		{"admin assigns setter", f.adminA, f.setterRoleA, true},
		{"setter assigns admin", f.setterA, f.adminRoleA, false},
		{"admin of A assigns a role of B", f.adminA, f.setterRoleB, false},
		{"climber assigns setter", f.climber, f.setterRoleA, false},
	}
	for _, c := range cases {
		if got := callerMayAssignRole(f.app, c.caller, c.role.Id); got != c.want {
			t.Errorf("%s: got %v", c.name, got)
		}
	}
}

func TestValidateMembership(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()

	memberships, err := f.app.FindCollectionByNameOrId("memberships")
	if err != nil {
		t.Fatal(err)
	}
	foreignRole := core.NewRecord(memberships)
	foreignRole.Load(map[string]any{"user": f.climber.Id, "gym": f.gymA.Id, "role": f.setterRoleB.Id})
	if validateMembership(f.app, f.adminA, foreignRole) == nil {
		t.Error("role of another gym accepted")
	}

	valid := core.NewRecord(memberships)
	valid.Load(map[string]any{"user": f.climber.Id, "gym": f.gymA.Id, "role": f.setterRoleA.Id})
	if err := validateMembership(f.app, f.adminA, valid); err != nil {
		t.Errorf("valid membership rejected: %v", err)
	}

	existing, err := f.app.FindFirstRecordByFilter("memberships", "user = {:user}", dbx.Params{"user": f.setterA.Id})
	if err != nil {
		t.Fatal(err)
	}
	existing.Set("user", f.climber.Id)
	if validateMembership(f.app, f.adminA, existing) == nil {
		t.Error("membership moved to another user")
	}
}

type inviteFixture struct {
	memberFixture
	handler http.Handler
}

func newInviteFixture(t *testing.T) inviteFixture {
	t.Helper()
	f := inviteFixture{memberFixture: newMemberFixture(t)}
	t.Cleanup(f.app.Cleanup)
	router, err := apis.NewRouter(f.app)
	if err != nil {
		t.Fatal(err)
	}
	serve := &core.ServeEvent{App: f.app, Router: router}
	err = f.app.OnServe().Trigger(serve, func(e *core.ServeEvent) error {
		f.handler, err = e.Router.BuildMux()
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func apiCall(t *testing.T, f inviteFixture, method, url, body string, caller *core.Record, status int, content ...string) {
	t.Helper()
	request := httptest.NewRequest(method, url, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if caller != nil {
		token, err := caller.NewAuthToken()
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", token)
	}
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, request)
	if recorder.Code != status {
		t.Fatalf("%s %s = %d, want %d: %s", method, url, recorder.Code, status, recorder.Body)
	}
	if len(content) == 0 && recorder.Body.Len() != 0 {
		t.Errorf("%s %s: expected empty body, got %s", method, url, recorder.Body)
	}
	for _, item := range content {
		if !strings.Contains(recorder.Body.String(), item) {
			t.Errorf("%s %s: %q missing in %s", method, url, item, recorder.Body)
		}
	}
}

var inviteLinkPattern = regexp.MustCompile(`/auth/invite/([A-Za-z0-9]+)`)

func invite(t *testing.T, f inviteFixture, caller *core.Record, gym *core.Record, email, roleID string) string {
	t.Helper()
	sent := f.app.TestMailer.TotalSend()
	apiCall(t, f, http.MethodPost, "/api/gyms/"+gym.Id+"/members", `{"email":"`+email+`","role":"`+roleID+`","firstname":"New"}`, caller, http.StatusAccepted)
	if f.app.TestMailer.TotalSend() != sent+1 {
		t.Fatalf("invite mail to %s not sent", email)
	}
	message := f.app.TestMailer.LastMessage()
	if message.To[0].Address != email {
		t.Fatalf("invite mail went to %v", message.To)
	}
	match := inviteLinkPattern.FindStringSubmatch(message.Text)
	if match == nil {
		t.Fatalf("no invite link in %q", message.Text)
	}
	return match[1]
}

func TestInviteMember(t *testing.T) {
	cases := []struct {
		name   string
		caller func(inviteFixture) *core.Record
		email  string
		status int
	}{
		{"setter may not invite", func(f inviteFixture) *core.Record { return f.setterA }, "climber@example.com", http.StatusForbidden},
		{"already a member", func(f inviteFixture) *core.Record { return f.adminA }, "setter-a@example.com", http.StatusConflict},
		{"existing account", func(f inviteFixture) *core.Record { return f.adminA }, "climber@example.com", http.StatusAccepted},
		{"unknown address", func(f inviteFixture) *core.Record { return f.adminA }, "new@example.com", http.StatusAccepted},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newInviteFixture(t)
			users, _ := f.app.CountRecords("users")
			content := []string{"{"}
			if c.status == http.StatusAccepted {
				content = nil
			}
			apiCall(t, f, http.MethodPost, "/api/gyms/"+f.gymA.Id+"/members", `{"email":"`+c.email+`","role":"`+f.setterRoleA.Id+`"}`, c.caller(f), c.status, content...)
			if after, _ := f.app.CountRecords("users"); after != users {
				t.Errorf("users %d -> %d", users, after)
			}
			if hasPermission(f.app, f.climber.Id, f.gymA.Id, "manage_routes") {
				t.Error("climber became a member before accepting")
			}
			invites, _ := f.app.CountRecords("invites")
			if (invites == 1) != (c.status == http.StatusAccepted) {
				t.Errorf("invites = %d", invites)
			}
		})
	}
}

func TestInviteNewAccount(t *testing.T) {
	f := newInviteFixture(t)
	first := invite(t, f, f.adminA, f.gymA, "new@example.com", f.adminRoleA.Id)
	token := invite(t, f, f.adminA, f.gymA, "new@example.com", f.setterRoleA.Id)
	if total, _ := f.app.CountRecords("invites"); total != 1 {
		t.Fatalf("resend created %d invites", total)
	}
	for action, want := range map[string]int64{"create": 1, "update": 1} {
		if total, _ := f.app.CountRecords("audit_logs", dbx.HashExp{"collection_name": "invites", "action": action}); total != want {
			t.Errorf("invite %s audit rows = %d, want %d", action, total, want)
		}
	}
	apiCall(t, f, http.MethodGet, "/api/invites/"+first, "", nil, http.StatusNotFound, "{")
	apiCall(t, f, http.MethodGet, "/api/invites/"+token, "", nil, http.StatusOK, `"hasAccount":false`, `"role":"routesetter"`, `"slug":"gym-a"`)

	apiCall(t, f, http.MethodPost, "/api/invites/"+token+"/accept", `{"password":"short","passwordConfirm":"short"}`, nil, http.StatusBadRequest, "{")
	apiCall(t, f, http.MethodPost, "/api/invites/"+token+"/accept", `{"password":"1234567890","passwordConfirm":"1234567890","firstname":"New"}`, nil, http.StatusOK, `"token":`, `"gym":"gym-a"`)

	user, err := f.app.FindAuthRecordByEmail("users", "new@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if !user.Verified() || user.GetString("firstname") != "New" {
		t.Errorf("unexpected account %v", user.PublicExport())
	}
	if !hasPermission(f.app, user.Id, f.gymA.Id, "manage_routes") || hasPermission(f.app, user.Id, f.gymA.Id, "manage_users") {
		t.Error("membership does not carry the resent role")
	}
	membership := membershipOf(f.app, user.Id, f.gymA.Id)
	for collection, recordID := range map[string]string{"users": user.Id, "memberships": membership.Id} {
		if total, err := f.app.CountRecords("audit_logs", dbx.HashExp{"collection_name": collection, "record_id": recordID, "action": "create", "gym": f.gymA.Id}); err != nil || total != 1 {
			t.Errorf("%s audit rows = %d (%v)", collection, total, err)
		}
	}
	apiCall(t, f, http.MethodPost, "/api/invites/"+token+"/accept", `{}`, user, http.StatusNotFound, "{")
}

func TestInviteExistingAccount(t *testing.T) {
	f := newInviteFixture(t)
	token := invite(t, f, f.adminA, f.gymA, "climber@example.com", f.setterRoleA.Id)
	apiCall(t, f, http.MethodGet, "/api/invites/"+token, "", nil, http.StatusOK, `"hasAccount":true`)
	apiCall(t, f, http.MethodPost, "/api/invites/"+token+"/accept", `{"password":"1234567890","passwordConfirm":"1234567890"}`, nil, http.StatusConflict, "{")
	apiCall(t, f, http.MethodPost, "/api/invites/"+token+"/accept", `{}`, f.setterB, http.StatusForbidden, "{")
	if hasPermission(f.app, f.setterB.Id, f.gymA.Id, "manage_routes") {
		t.Fatal("another account accepted the invite")
	}
	apiCall(t, f, http.MethodPost, "/api/invites/"+token+"/accept", `{}`, f.climber, http.StatusOK, `"gym":"gym-a"`)
	if !hasPermission(f.app, f.climber.Id, f.gymA.Id, "manage_routes") {
		t.Error("climber did not join")
	}
}

func TestInviteRevokeAndExpiry(t *testing.T) {
	f := newInviteFixture(t)
	revoked := invite(t, f, f.adminA, f.gymA, "revoked@example.com", f.setterRoleA.Id)
	record, err := f.app.FindFirstRecordByData("invites", "email", "revoked@example.com")
	if err != nil {
		t.Fatal(err)
	}
	apiCall(t, f, http.MethodGet, "/api/collections/invites/records", "", f.setterA, http.StatusOK, `"totalItems":0`)
	apiCall(t, f, http.MethodDelete, "/api/collections/invites/records/"+record.Id, "", f.adminA, http.StatusNoContent)
	apiCall(t, f, http.MethodGet, "/api/invites/"+revoked, "", nil, http.StatusNotFound, "{")

	expired := invite(t, f, f.adminA, f.gymA, "expired@example.com", f.setterRoleA.Id)
	record, err = f.app.FindFirstRecordByData("invites", "email", "expired@example.com")
	if err != nil {
		t.Fatal(err)
	}
	record.Set("expires_at", types.NowDateTime().Add(-time.Minute))
	if err := f.app.Save(record); err != nil {
		t.Fatal(err)
	}
	apiCall(t, f, http.MethodGet, "/api/invites/"+expired, "", nil, http.StatusNotFound, "{")
	apiCall(t, f, http.MethodPost, "/api/invites/"+expired+"/accept", `{}`, f.climber, http.StatusNotFound, "{")
	kept := invite(t, f, f.adminA, f.gymA, "kept@example.com", f.setterRoleA.Id)
	for _, job := range f.app.Cron().Jobs() {
		if job.Id() == "inviteRetention" {
			job.Run()
		}
	}
	if total, _ := f.app.CountRecords("invites"); total != 1 {
		t.Errorf("invites after prune = %d, want only the unexpired one", total)
	}
	apiCall(t, f, http.MethodGet, "/api/invites/"+kept, "", nil, http.StatusOK, `"email":"kept@example.com"`)
}

func TestDeletingGymRemovesInvites(t *testing.T) {
	f := newInviteFixture(t)
	invite(t, f, f.adminA, f.gymA, "new@example.com", f.setterRoleA.Id)
	if err := f.app.Delete(f.gymA); err != nil {
		t.Fatal(err)
	}
	if total, _ := f.app.CountRecords("invites"); total != 0 {
		t.Errorf("invites left after gym delete: %d", total)
	}
}

func TestPlatformAdminManagesAnyGym(t *testing.T) {
	f := newMemberFixture(t)
	operator := saveUser(t, f.app, "operator@example.com")
	operator.Set("platform_admin", true)
	if err := f.app.Save(operator); err != nil {
		t.Fatal(err)
	}
	adminRoleB := gymRole(t, f.app, f.gymB.Id, "admin")
	if !callerMayAssignRole(f.app, operator, adminRoleB.Id) {
		t.Error("platform admin may not assign the admin role")
	}
	if callerMayAssignRole(f.app, f.climber, adminRoleB.Id) {
		t.Error("climber may assign the admin role")
	}
	token, err := operator.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	scenario := tests.ApiScenario{
		Name:           "platform admin invites the first admin of a gym",
		Method:         http.MethodPost,
		URL:            "/api/gyms/" + f.gymB.Id + "/members",
		Body:           strings.NewReader(`{"email":"climber@example.com","role":"` + adminRoleB.Id + `"}`),
		Headers:        map[string]string{"Authorization": token},
		ExpectedStatus: http.StatusAccepted,
		TestAppFactory: func(testing.TB) *tests.TestApp { return f.app },
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if _, err := app.FindFirstRecordByFilter("invites", "gym = {:gym} && role = {:role}", dbx.Params{"gym": f.gymB.Id, "role": adminRoleB.Id}); err != nil {
				t.Error("no pending admin invite for B")
			}
		},
	}
	scenario.Test(t)
}

func TestAdminRoleCannotBeDeleted(t *testing.T) {
	f := newMemberFixture(t)
	operator := saveUser(t, f.app, "operator@example.com")
	operator.Set("platform_admin", true)
	if err := f.app.Save(operator); err != nil {
		t.Fatal(err)
	}
	token, err := operator.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	scenario := tests.ApiScenario{
		Name:            "platform admin may not delete the admin role",
		Method:          http.MethodDelete,
		URL:             "/api/collections/roles/records/" + f.adminRoleA.Id,
		Headers:         map[string]string{"Authorization": token},
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{"{"},
		TestAppFactory:  func(testing.TB) *tests.TestApp { return f.app },
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if _, err := app.FindRecordById("roles", f.adminRoleA.Id); err != nil {
				t.Errorf("admin role deleted: %v", err)
			}
		},
	}
	scenario.Test(t)

	if roleDeletable(adminRoleName, false) || !roleDeletable(adminRoleName, true) || !roleDeletable("routesetter", false) {
		t.Error("roleDeletable guards the wrong roles")
	}
}
