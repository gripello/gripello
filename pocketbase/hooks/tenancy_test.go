package hooks

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

var handlers = map[*tests.TestApp]http.Handler{}

func handlerOf(t *testing.T, app *tests.TestApp) http.Handler {
	t.Helper()
	if handler, ok := handlers[app]; ok {
		return handler
	}
	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	err = app.OnServe().Trigger(&core.ServeEvent{App: app, Router: router}, func(e *core.ServeEvent) error {
		handler, err := e.Router.BuildMux()
		handlers[app] = handler
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return handlers[app]
}

func call(t *testing.T, app *tests.TestApp, auth *core.Record, method, url, body string, status int, content ...string) {
	t.Helper()
	request := httptest.NewRequest(method, url, strings.NewReader(body))
	request.Header.Set("content-type", "application/json")
	if auth != nil {
		token, err := auth.NewAuthToken()
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", token)
	}
	recorder := httptest.NewRecorder()
	handlerOf(t, app).ServeHTTP(recorder, request)
	if recorder.Code != status {
		t.Errorf("%s %s = %d, want %d: %s", method, url, recorder.Code, status, recorder.Body.String())
		return
	}
	for _, expected := range content {
		if !strings.Contains(recorder.Body.String(), expected) {
			t.Errorf("%s %s lacks %q: %s", method, url, expected, recorder.Body.String())
		}
	}
}

func recordURL(collection, id string) string {
	return "/api/collections/" + collection + "/records/" + id
}

func permissionIDs(t *testing.T, app core.App, names ...string) []string {
	t.Helper()
	ids := []string{}
	for _, name := range names {
		permission, err := app.FindFirstRecordByData("permissions", "name", name)
		if err != nil {
			t.Fatalf("permission %s: %v", name, err)
		}
		ids = append(ids, permission.Id)
	}
	return ids
}

func membershipID(t *testing.T, app core.App, user, gym *core.Record) string {
	t.Helper()
	membership := membershipOf(app, user.Id, gym.Id)
	if membership == nil {
		t.Fatalf("%s has no membership in %s", user.Email(), gym.GetString("slug"))
	}
	return membership.Id
}

func platformAdmin(t *testing.T, app core.App) *core.Record {
	t.Helper()
	operator := saveUser(t, app, "operator@example.com")
	operator.Set("platform_admin", true)
	if err := app.Save(operator); err != nil {
		t.Fatal(err)
	}
	return operator
}

func addUserManager(t *testing.T, f memberFixture) (*core.Record, *core.Record) {
	t.Helper()
	role := saveRecord(t, f.app, "roles", map[string]any{"gym": f.gymA.Id, "name": "usermgr", "permissions": permissionIDs(t, f.app, "manage_users")})
	manager := saveUser(t, f.app, "usermgr@example.com")
	saveRecord(t, f.app, "memberships", map[string]any{"user": manager.Id, "gym": f.gymA.Id, "role": role.Id})
	return manager, role
}

func TestMemberCannotOutrankTheAdmin(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	manager, managerRole := addUserManager(t, f)
	adminMembership := membershipID(t, f.app, f.adminA, f.gymA)

	call(t, f.app, manager, http.MethodPatch, recordURL("memberships", adminMembership), `{"role":"`+managerRole.Id+`"}`, http.StatusForbidden)
	call(t, f.app, manager, http.MethodDelete, recordURL("memberships", adminMembership), "", http.StatusForbidden)
	call(t, f.app, manager, http.MethodPatch, recordURL("roles", f.setterRoleA.Id), `{"permissions":[]}`, http.StatusForbidden)
	call(t, f.app, manager, http.MethodDelete, recordURL("memberships", membershipID(t, f.app, f.setterA, f.gymA)), "", http.StatusForbidden)

	if !hasPermission(f.app, f.adminA.Id, f.gymA.Id, "manage_settings") || !hasPermission(f.app, f.setterA.Id, f.gymA.Id, "manage_routes") {
		t.Error("user manager took permissions away from higher roles")
	}

	peer := saveUser(t, f.app, "peer@example.com")
	peerMembership := saveRecord(t, f.app, "memberships", map[string]any{"user": peer.Id, "gym": f.gymA.Id, "role": managerRole.Id})
	call(t, f.app, manager, http.MethodDelete, recordURL("memberships", peerMembership.Id), "", http.StatusNoContent)
}

func TestGymKeepsAnAdmin(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	operator := platformAdmin(t, f.app)
	adminMembership := membershipID(t, f.app, f.adminA, f.gymA)

	call(t, f.app, f.adminA, http.MethodPatch, recordURL("memberships", adminMembership), `{"role":"`+f.setterRoleA.Id+`"}`, http.StatusBadRequest, "at least one admin")
	call(t, f.app, f.adminA, http.MethodDelete, recordURL("memberships", adminMembership), "", http.StatusBadRequest, "at least one admin")
	call(t, f.app, operator, http.MethodDelete, recordURL("memberships", adminMembership), "", http.StatusBadRequest, "at least one admin")

	call(t, f.app, f.adminA, http.MethodPatch, recordURL("memberships", membershipID(t, f.app, f.setterA, f.gymA)), `{"role":"`+f.adminRoleA.Id+`"}`, http.StatusOK)
	call(t, f.app, f.adminA, http.MethodDelete, recordURL("memberships", adminMembership), "", http.StatusNoContent)
}

func TestRoleInUseCannotBeDeleted(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()

	call(t, f.app, f.adminA, http.MethodDelete, recordURL("roles", f.setterRoleA.Id), "", http.StatusBadRequest)
	if _, err := f.app.FindRecordById("roles", f.setterRoleA.Id); err != nil {
		t.Fatalf("role in use deleted: %v", err)
	}
	if membershipOf(f.app, f.setterA.Id, f.gymA.Id) == nil {
		t.Fatal("membership deleted with its role")
	}

	unused := saveRecord(t, f.app, "roles", map[string]any{"gym": f.gymA.Id, "name": "unused"})
	call(t, f.app, f.adminA, http.MethodDelete, recordURL("roles", unused.Id), "", http.StatusNoContent)
}

func TestMemberLeavesAGym(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	setterMembership := membershipID(t, f.app, f.setterA, f.gymA)

	call(t, f.app, f.climber, http.MethodDelete, recordURL("memberships", setterMembership), "", http.StatusNotFound)
	call(t, f.app, f.setterA, http.MethodDelete, recordURL("memberships", setterMembership), "", http.StatusNoContent)
	if membershipOf(f.app, f.setterA.Id, f.gymA.Id) != nil {
		t.Error("membership still exists after leaving")
	}
}

func TestRolesAreVisibleToMembersOnly(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	operator := platformAdmin(t, f.app)
	countA, err := f.app.CountRecords("roles", dbx.HashExp{"gym": f.gymA.Id})
	if err != nil {
		t.Fatal(err)
	}
	countAll, err := f.app.CountRecords("roles")
	if err != nil {
		t.Fatal(err)
	}

	call(t, f.app, f.climber, http.MethodGet, "/api/collections/roles/records", "", http.StatusOK, `"totalItems":0`)
	call(t, f.app, f.setterA, http.MethodGet, "/api/collections/roles/records", "", http.StatusOK, `"totalItems":`+strconv.FormatInt(countA, 10))
	call(t, f.app, operator, http.MethodGet, "/api/collections/roles/records", "", http.StatusOK, `"totalItems":`+strconv.FormatInt(countAll, 10))
	call(t, f.app, f.setterA, http.MethodGet, recordURL("roles", f.setterRoleB.Id), "", http.StatusNotFound)
}

func TestTaskAssigneeMustManageTasksInTheGym(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id})
	body := func(assignee string) string {
		return `{"kind":"maintenance","title":"Clean","location":"` + hall.Id + `","assignee":"` + assignee + `"}`
	}

	call(t, f.app, f.adminA, http.MethodPost, "/api/collections/tasks/records", body(f.climber.Id), http.StatusBadRequest, "cannot manage tasks")
	call(t, f.app, f.adminA, http.MethodPost, "/api/collections/tasks/records", body(f.setterB.Id), http.StatusBadRequest, "cannot manage tasks")
	call(t, f.app, f.adminA, http.MethodPost, "/api/collections/tasks/records", body(f.setterA.Id), http.StatusOK)

	task, err := f.app.FindFirstRecordByData("tasks", "assignee", f.setterA.Id)
	if err != nil {
		t.Fatal(err)
	}
	call(t, f.app, f.adminA, http.MethodPatch, recordURL("tasks", task.Id), `{"assignee":"`+f.climber.Id+`"}`, http.StatusBadRequest, "cannot manage tasks")

	plain := saveRecord(t, f.app, "roles", map[string]any{"gym": f.gymA.Id, "name": "plain"})
	call(t, f.app, f.adminA, http.MethodPatch, recordURL("memberships", membershipID(t, f.app, f.setterA, f.gymA)), `{"role":"`+plain.Id+`"}`, http.StatusOK)
	if stored, _ := f.app.FindRecordById("tasks", task.Id); stored.GetString("assignee") != "" {
		t.Error("task stays assigned after the assignee lost manage_tasks")
	}

	call(t, f.app, f.adminA, http.MethodPatch, recordURL("tasks", task.Id), `{"assignee":"`+f.adminA.Id+`"}`, http.StatusOK)
	second := saveUser(t, f.app, "admin2@example.com")
	saveRecord(t, f.app, "memberships", map[string]any{"user": second.Id, "gym": f.gymA.Id, "role": f.adminRoleA.Id})
	call(t, f.app, second, http.MethodDelete, recordURL("memberships", membershipID(t, f.app, f.adminA, f.gymA)), "", http.StatusNoContent)
	if stored, _ := f.app.FindRecordById("tasks", task.Id); stored.GetString("assignee") != "" {
		t.Error("task stays assigned after the assignee left the gym")
	}
}

func TestCompetitionChildrenCannotMove(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	competitionA, hall := saveCompetition(t, f.app, f.gymA.Id)
	competitionB, hallB := saveCompetition(t, f.app, f.gymB.Id)
	routeA := saveRecord(t, f.app, "routes", map[string]any{"name": "A", "grade": "6a", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id})
	routeB := saveRecord(t, f.app, "routes", map[string]any{"name": "B", "grade": "6a", "type": "Boulder", "creator": []string{"S"}, "location": hallB.Id})
	categoryA := saveRecord(t, f.app, "competition_categories", map[string]any{"name": "Open", "competition": competitionA.Id})
	categoryB := saveRecord(t, f.app, "competition_categories", map[string]any{"name": "Open", "competition": competitionB.Id})
	compRouteA := saveRecord(t, f.app, "competition_routes", map[string]any{"competition": competitionA.Id, "route": routeA.Id, "number": 1})
	entryA := saveRecord(t, f.app, "competition_entries", map[string]any{
		"competition": competitionA.Id, "category": categoryA.Id, "user": f.climber.Id,
		"display_name": "C", "birth_year": 1990, "status": "registered", "bib": 1,
	})

	call(t, f.app, f.adminA, http.MethodPatch, recordURL("competition_categories", categoryA.Id), `{"competition":"`+competitionB.Id+`"}`, http.StatusBadRequest, "another competition")
	call(t, f.app, f.adminA, http.MethodPatch, recordURL("competition_routes", compRouteA.Id), `{"competition":"`+competitionB.Id+`","route":"`+routeB.Id+`","number":7}`, http.StatusBadRequest)
	call(t, f.app, f.adminA, http.MethodPatch, recordURL("competition_entries", entryA.Id), `{"competition":"`+competitionB.Id+`","category":"`+categoryB.Id+`","bib":77}`, http.StatusBadRequest)

	for collection, id := range map[string]string{"competition_categories": categoryA.Id, "competition_routes": compRouteA.Id, "competition_entries": entryA.Id} {
		stored, err := f.app.FindRecordById(collection, id)
		if err != nil || stored.GetString("competition") != competitionA.Id {
			t.Errorf("%s moved to another competition", collection)
		}
	}
}

func TestDraftCompetitionChangesReachStaffOnly(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()

	draft := competitionAudience(f.app, f.gymA.Id, true)
	cases := map[string]struct {
		auth *core.Record
		want bool
	}{
		"staff of the gym":     {f.setterA, true},
		"staff of another gym": {f.setterB, false},
		"climber":              {f.climber, false},
		"guest":                {nil, false},
	}
	for name, c := range cases {
		if got := draft(c.auth); got != c.want {
			t.Errorf("%s receives draft changes = %v", name, got)
		}
	}
	if !competitionAudience(f.app, f.gymA.Id, false)(nil) {
		t.Error("guest misses changes of a public competition")
	}
}

func TestDeletingAGymRetiresItsSlugs(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	operator := platformAdmin(t, f.app)
	gym := f.gymA

	competition, created := saveCompetition(t, f.app, gym.Id)
	hall, err := f.app.FindRecordById("locations", created.Id)
	if err != nil {
		t.Fatal(err)
	}
	hall.Set("map", map[string]any{"width": 20, "height": 20, "shapes": []any{}})
	if err := f.app.Save(hall); err != nil {
		t.Fatal(err)
	}
	saveRecord(t, f.app, "walls", map[string]any{"location": hall.Id, "name": "Wall", "outline": [][2]float64{{1, 1}, {2, 1}, {2, 2}}, "edge": [][2]float64{{1, 1}, {2, 1}}})
	route := saveRecord(t, f.app, "routes", map[string]any{"name": "Crimpy", "grade": "6a", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id})
	saveRecord(t, f.app, "ratings", map[string]any{"route_id": route.Id, "rating": 4, "comment": "nice"})
	saveRecord(t, f.app, "tasks", map[string]any{"gym": gym.Id, "kind": "defect", "category": "loose_hold", "priority": 4, "status": "open", "route": route.Id})
	saveRecord(t, f.app, "reports", map[string]any{"gym": gym.Id, "content_type": "route", "content_id": route.Id, "content_url": "/x", "reason": "other", "explanation": "x", "notifier_name": "n", "notifier_email": "n@example.com", "status": "open", "good_faith": true})
	category := saveRecord(t, f.app, "competition_categories", map[string]any{"name": "Open", "competition": competition.Id})
	compRoute := saveRecord(t, f.app, "competition_routes", map[string]any{"competition": competition.Id, "route": route.Id, "number": 1})
	entry := saveRecord(t, f.app, "competition_entries", map[string]any{
		"competition": competition.Id, "category": category.Id, "user": f.climber.Id,
		"display_name": "C", "birth_year": 1990, "status": "registered", "bib": 1,
	})
	saveRecord(t, f.app, "competition_scores", map[string]any{"competition": competition.Id, "entry": entry.Id, "comp_route": compRoute.Id, "attempts": 1, "top_attempt": 1})
	audit := saveRecord(t, f.app, "audit_logs", map[string]any{"gym": gym.Id, "action": "update", "actor": f.setterA.Id, "collection_name": "routes"})
	tick := saveRecord(t, f.app, "ticks", map[string]any{"user": f.climber.Id, "route": route.Id, "type": "top", "attempts": 2, "date": time.Now()})
	if tick.GetString("route_name") != "Crimpy" {
		t.Fatalf("tick route_name = %q", tick.GetString("route_name"))
	}

	gym, err = f.app.FindRecordById("gyms", gym.Id)
	if err != nil {
		t.Fatal(err)
	}
	gym.Set("slug", "gym-a-renamed")
	if err := f.app.Save(gym); err != nil {
		t.Fatal(err)
	}

	call(t, f.app, operator, http.MethodDelete, recordURL("gyms", gym.Id), "", http.StatusNoContent)
	if _, err := f.app.FindRecordById("gyms", gym.Id); err == nil {
		t.Fatal("gym not deleted")
	}

	for _, table := range []string{"locations", "walls", "routes", "ratings", "tasks", "reports", "competitions", "roles", "memberships"} {
		if total, err := f.app.CountRecords(table, dbx.HashExp{"gym": gym.Id}); err != nil || total != 0 {
			t.Errorf("%s rows left: %d (%v)", table, total, err)
		}
	}
	for _, table := range []string{"competition_categories", "competition_routes", "competition_entries", "competition_scores"} {
		if total, err := f.app.CountRecords(table, dbx.HashExp{"competition": competition.Id}); err != nil || total != 0 {
			t.Errorf("%s rows left: %d (%v)", table, total, err)
		}
	}
	if stored, err := f.app.FindRecordById("audit_logs", audit.Id); err != nil || stored.GetString("gym") != "" {
		t.Errorf("audit row not kept without gym: %v", err)
	}
	stored, err := f.app.FindRecordById("ticks", tick.Id)
	if err != nil {
		t.Fatalf("tick deleted with the gym: %v", err)
	}
	if stored.GetString("route") != "" || stored.GetString("route_name") != "Crimpy" || stored.GetString("grade") != "6a" {
		t.Errorf("tick snapshot lost: %v", stored.PublicExport())
	}

	for _, slug := range []string{"gym-a", "gym-a-renamed"} {
		call(t, f.app, operator, http.MethodPost, "/api/collections/gyms/records", `{"slug":"`+slug+`","name":"Copy"}`, http.StatusBadRequest, "used by another gym")
	}
	retired, err := f.app.FindFirstRecordByData("retired_slugs", "slug", "gym-a")
	if err != nil {
		t.Fatal(err)
	}
	if err := f.app.Delete(retired); err != nil {
		t.Fatal(err)
	}
	call(t, f.app, operator, http.MethodPost, "/api/collections/gyms/records", `{"id":"`+gym.Id+`","slug":"gym-a","name":"Copy"}`, http.StatusOK)
	reborn, err := f.app.FindFirstRecordByData("gyms", "slug", "gym-a")
	if err != nil {
		t.Fatal(err)
	}
	if reborn.Id == gym.Id {
		t.Error("deleted gym id reused")
	}
}

func TestGymSavesBeforeSlugHistoryMigrations(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	retired, err := f.app.FindCollectionByNameOrId("retired_slugs")
	if err != nil {
		t.Fatal(err)
	}
	if err := f.app.Delete(retired); err != nil {
		t.Fatal(err)
	}
	saveRecord(t, f.app, "gyms", map[string]any{"name": "Legacy", "slug": "legacy", "active": true})
}
