package hooks

import (
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
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
	f.gymA = saveRecord(t, app, "gyms", map[string]any{"slug": "gym-a", "name": "A", "active": true})
	f.gymB = saveRecord(t, app, "gyms", map[string]any{"slug": "gym-b", "name": "B", "active": true})
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

func TestInviteMember(t *testing.T) {
	cases := []struct {
		name   string
		caller func(memberFixture) *core.Record
		email  string
		status int
	}{
		{"setter may not invite", func(f memberFixture) *core.Record { return f.setterA }, "climber@example.com", http.StatusForbidden},
		{"already a member", func(f memberFixture) *core.Record { return f.adminA }, "setter-a@example.com", http.StatusConflict},
		{"admin invites a climber", func(f memberFixture) *core.Record { return f.adminA }, "climber@example.com", http.StatusOK},
	}
	for _, c := range cases {
		f := newMemberFixture(t)
		token, err := c.caller(f).NewAuthToken()
		if err != nil {
			t.Fatal(err)
		}
		scenario := tests.ApiScenario{
			Name:            c.name,
			Method:          http.MethodPost,
			URL:             "/api/gyms/" + f.gymA.Id + "/members",
			Body:            strings.NewReader(`{"email":"` + c.email + `","role":"` + f.setterRoleA.Id + `"}`),
			Headers:         map[string]string{"Authorization": token},
			ExpectedStatus:  c.status,
			ExpectedContent: []string{"{"},
			TestAppFactory:  func(testing.TB) *tests.TestApp { return f.app },
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				invited := hasPermission(app, f.climber.Id, f.gymA.Id, "manage_routes")
				if invited != (c.status == http.StatusOK) {
					t.Errorf("climber membership = %v", invited)
				}
			},
		}
		scenario.Test(t)
	}
}

func TestInviteMemberCreatesAccount(t *testing.T) {
	f := newMemberFixture(t)
	token, err := f.adminA.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	scenario := tests.ApiScenario{
		Name:            "unknown email gets an account and a password mail",
		Method:          http.MethodPost,
		URL:             "/api/gyms/" + f.gymA.Id + "/members",
		Body:            strings.NewReader(`{"email":"new@example.com","role":"` + f.setterRoleA.Id + `","firstname":"New","name":"Setter"}`),
		Headers:         map[string]string{"Authorization": token},
		ExpectedStatus:  http.StatusCreated,
		ExpectedContent: []string{`"created":true`},
		TestAppFactory:  func(testing.TB) *tests.TestApp { return f.app },
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			user, err := app.FindAuthRecordByEmail("users", "new@example.com")
			if err != nil {
				t.Fatalf("account not created: %v", err)
			}
			if user.Verified() || user.GetString("firstname") != "New" {
				t.Errorf("unexpected account %v", user.PublicExport())
			}
			if !hasPermission(app, user.Id, f.gymA.Id, "manage_routes") {
				t.Error("new account has no setter membership")
			}
			if app.TestMailer.TotalSend() != 1 || app.TestMailer.LastMessage().To[0].Address != "new@example.com" {
				t.Errorf("password mail not sent: %d", app.TestMailer.TotalSend())
			}
			membership := membershipOf(app, user.Id, f.gymA.Id)
			for collection, recordID := range map[string]string{"users": user.Id, "memberships": membership.Id} {
				total, err := app.CountRecords("audit_logs", dbx.HashExp{
					"collection_name": collection, "record_id": recordID, "action": "create", "actor": f.adminA.Id, "gym": f.gymA.Id,
				})
				if err != nil || total != 1 {
					t.Errorf("%s audit rows = %d (%v)", collection, total, err)
				}
			}
		},
	}
	scenario.Test(t)
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
		Name:            "platform admin invites the first admin of a gym",
		Method:          http.MethodPost,
		URL:             "/api/gyms/" + f.gymB.Id + "/members",
		Body:            strings.NewReader(`{"email":"climber@example.com","role":"` + adminRoleB.Id + `"}`),
		Headers:         map[string]string{"Authorization": token},
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{"{"},
		TestAppFactory:  func(testing.TB) *tests.TestApp { return f.app },
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if !hasPermission(app, f.climber.Id, f.gymB.Id, "manage_users") {
				t.Error("climber did not become admin of B")
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
