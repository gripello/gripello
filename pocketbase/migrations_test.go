package main

import (
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/dop251/goja"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/jsvm"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/search"
)

func TestAverageRatingView(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	jsvm.MustRegister(app, jsvm.Config{MigrationsDir: "pb_migrations"})
	if err := app.RunAllMigrations(); err != nil {
		t.Fatal(err)
	}

	routes, err := app.FindCollectionByNameOrId("routes")
	if err != nil {
		t.Fatal(err)
	}
	ratings, err := app.FindCollectionByNameOrId("ratings")
	if err != nil {
		t.Fatal(err)
	}

	saveRoute := func(location string, archived bool) *core.Record {
		route := core.NewRecord(routes)
		route.Set("name", "route")
		route.Set("location", location)
		route.Set("archived", archived)
		if err := app.SaveNoValidate(route); err != nil {
			t.Fatal(err)
		}
		return route
	}
	rated := saveRoute("gym", false)
	unrated := saveRoute("gym", false)
	saveRoute("gym", true)
	saveRoute("crag", false)

	for _, stars := range []int{2, 4, 0} {
		rating := core.NewRecord(ratings)
		rating.Set("route_id", rated.Id)
		rating.Set("rating", stars)
		if err := app.SaveNoValidate(rating); err != nil {
			t.Fatal(err)
		}
	}

	view, err := app.FindCollectionByNameOrId("vcfw600rzblhed3")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"average_rating", "ratings_count"} {
		if field := view.Fields.GetByName(name); field == nil || field.Type() != core.FieldTypeNumber {
			t.Fatalf("%s is not a number field", name)
		}
	}

	records, err := app.FindRecordsByFilter(view, "archived = false && location = 'gym'", "", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 2 {
		t.Fatalf("got %d records, want 2", len(records))
	}

	byId := map[string]*core.Record{}
	for _, record := range records {
		byId[record.Id] = record
	}
	if got := byId[rated.Id].GetFloat("average_rating"); got != 3 {
		t.Errorf("average_rating = %v, want 3", got)
	}
	if got := byId[rated.Id].GetInt("ratings_count"); got != 2 {
		t.Errorf("ratings_count = %v, want 2", got)
	}
	if got := byId[unrated.Id].GetInt("ratings_count"); got != 0 {
		t.Errorf("unrated ratings_count = %v, want 0", got)
	}
}

func TestCompetitionCollections(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	jsvm.MustRegister(app, jsvm.Config{MigrationsDir: "pb_migrations"})
	if err := app.RunAllMigrations(); err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{"competitions", "competition_categories", "competition_routes", "competition_entries", "competition_scores"} {
		if _, err := app.FindCollectionByNameOrId(name); err != nil {
			t.Errorf("collection %s missing: %v", name, err)
		}
	}
	for _, permission := range []string{"manage_competitions", "judge_competitions"} {
		if _, err := app.FindFirstRecordByData("permissions", "name", permission); err != nil {
			t.Errorf("%s permission missing: %v", permission, err)
		}
	}
	scores, err := app.FindCollectionByNameOrId("competition_scores")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.FindCollectionByNameOrId("competition_standings"); err != nil {
		t.Errorf("competition_standings view missing: %v", err)
	}
	for _, field := range []string{"comp_route", "style", "height", "height_plus"} {
		if scores.Fields.GetByName(field) == nil {
			t.Errorf("competition_scores.%s missing", field)
		}
	}
	competitions, err := app.FindCollectionByNameOrId("competitions")
	if err != nil {
		t.Fatal(err)
	}
	if competitions.Fields.GetByName("requires_payment") == nil {
		t.Error("competitions.requires_payment missing")
	}
}

func latestMigrations() *core.MigrationsList {
	latest := map[string]*core.Migration{}
	for _, migration := range core.AppMigrations.Items() {
		latest[migration.File] = migration
	}
	list := &core.MigrationsList{}
	list.Copy(core.SystemMigrations)
	for _, migration := range latest {
		list.Add(migration)
	}
	return list
}

func migrationsSince(file string) int {
	newer := 0
	for _, migration := range latestMigrations().Items() {
		if migration.File >= file {
			newer++
		}
	}
	return newer
}

func migrateDownTo(t *testing.T, app core.App, file string) *core.MigrationsRunner {
	t.Helper()
	list := latestMigrations()
	runner := core.NewMigrationsRunner(app, *list)
	if _, err := runner.Up(); err != nil {
		t.Fatal(err)
	}
	if _, err := runner.Down(migrationsSince(file)); err != nil {
		t.Fatal(err)
	}
	return runner
}

func TestGymsMigration(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	jsvm.MustRegister(app, jsvm.Config{MigrationsDir: "pb_migrations"})
	runner := migrateDownTo(t, app, "1791800001_gyms.js")

	settings, err := app.FindRecordById("settings", "settings_123456")
	if err != nil {
		t.Fatal(err)
	}
	settings.Set("organization_name", "Boulderhalle München")
	settings.Set("organization_unit_name", "Nord")
	settings.Set("route_grade_system", "french")
	settings.Set("contact_email", "info@example.com")
	if err := app.SaveNoValidate(settings); err != nil {
		t.Fatal(err)
	}
	routes, err := app.FindCollectionByNameOrId("routes")
	if err != nil {
		t.Fatal(err)
	}
	route := core.NewRecord(routes)
	route.Set("name", "route")
	if err := app.SaveNoValidate(route); err != nil {
		t.Fatal(err)
	}

	if _, err := runner.Up(); err != nil {
		t.Fatal(err)
	}

	gyms, err := app.FindAllRecords("gyms")
	if err != nil {
		t.Fatal(err)
	}
	if len(gyms) != 1 {
		t.Fatalf("got %d gyms, want 1", len(gyms))
	}
	gym := gyms[0]
	expected := map[string]string{
		"slug":               "boulderhalle-muenchen",
		"name":               "Boulderhalle München",
		"unit_name":          "Nord",
		"route_grade_system": "french",
		"contact_email":      "info@example.com",
	}
	for field, want := range expected {
		if got := gym.GetString(field); got != want {
			t.Errorf("gym.%s = %q, want %q", field, got, want)
		}
	}
	if !gym.GetBool("active") {
		t.Error("default gym is not active")
	}

	route, err = app.FindRecordById("routes", route.Id)
	if err != nil {
		t.Fatal(err)
	}
	if route.GetString("gym") != gym.Id {
		t.Errorf("routes.gym = %q, want %q", route.GetString("gym"), gym.Id)
	}
	roles, err := app.FindAllRecords("roles")
	if err != nil {
		t.Fatal(err)
	}
	for _, role := range roles {
		if role.GetString("gym") != gym.Id {
			t.Errorf("role %s not backfilled", role.GetString("name"))
		}
	}

	settingsCollection, err := app.FindCollectionByNameOrId("settings")
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"organization_name", "application_url", "page_logo", "boulder_bands"} {
		if settingsCollection.Fields.GetByName(field) != nil {
			t.Errorf("settings.%s still exists", field)
		}
	}
	for _, field := range []string{"contact_email", "legal_address", "allow_registration", "audit_retention_days"} {
		if settingsCollection.Fields.GetByName(field) == nil {
			t.Errorf("settings.%s missing", field)
		}
	}
	for _, name := range []string{"locations", "walls", "routes", "ratings", "tasks", "reports", "competitions", "roles"} {
		collection, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Fatal(err)
		}
		if field := collection.Fields.GetByName("gym"); field == nil || !field.(*core.RelationField).Required {
			t.Errorf("%s.gym is not required", name)
		}
	}
	for _, name := range []string{"locations", "walls", "routes"} {
		collection, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Fatal(err)
		}
		if collection.ListRule == nil || *collection.ListRule != "" || collection.ViewRule == nil || *collection.ViewRule != "" {
			t.Errorf("%s is not publicly readable", name)
		}
	}
	for _, name := range []string{"vcfw600rzblhed3", "open_route_defects", "usedColors", "ratingsStats"} {
		view, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Fatal(err)
		}
		if view.Fields.GetByName("gym") == nil {
			t.Errorf("view %s lacks gym", name)
		}
	}
}

func TestGymsMigrationSkipsFreshInstall(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	jsvm.MustRegister(app, jsvm.Config{MigrationsDir: "pb_migrations"})
	if err := app.RunAllMigrations(); err != nil {
		t.Fatal(err)
	}
	total, err := app.CountRecords("gyms")
	if err != nil {
		t.Fatal(err)
	}
	if total != 0 {
		t.Fatalf("fresh install created %d gyms", total)
	}
}

func TestGymSlugifyMirrorsShared(t *testing.T) {
	var fixtures struct {
		Slugify [][2]string `json:"slugify"`
	}
	raw, err := os.ReadFile("../test/fixtures/gymSlug.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile("pb_migrations/1791800001_gyms.js")
	if err != nil {
		t.Fatal(err)
	}
	vm := goja.New()
	vm.Set("migrate", func(goja.FunctionCall) goja.Value { return goja.Undefined() })
	if _, err := vm.RunString(string(source)); err != nil {
		t.Fatal(err)
	}
	slugify, ok := goja.AssertFunction(vm.Get("slugify"))
	if !ok {
		t.Fatal("slugify not defined in migration")
	}
	for _, c := range fixtures.Slugify {
		got, err := slugify(goja.Undefined(), vm.ToValue(c[0]))
		if err != nil {
			t.Fatal(err)
		}
		if got.String() != c[1] {
			t.Errorf("slugify(%q) = %q, want %q", c[0], got.String(), c[1])
		}
	}
}

type tenancyFixture struct {
	gymA, gymB                          *core.Record
	adminA, setterA, splitUser, setterB *core.Record
	climber, routeA, routeB             *core.Record
	memberships                         map[string]*core.Record
}

func saveTestRecord(t *testing.T, app core.App, collection string, data map[string]any) *core.Record {
	t.Helper()
	target, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(target)
	record.Load(data)
	if err := app.SaveNoValidate(record); err != nil {
		t.Fatalf("saving %s: %v", collection, err)
	}
	return record
}

func seedTenancy(t *testing.T, app core.App) tenancyFixture {
	t.Helper()
	permissionID := func(name string) string {
		permission, err := app.FindFirstRecordByData("permissions", "name", name)
		if err != nil {
			t.Fatal(err)
		}
		return permission.Id
	}
	role := func(gym *core.Record, name string, permissions ...string) *core.Record {
		ids := []string{}
		for _, permission := range permissions {
			ids = append(ids, permissionID(permission))
		}
		return saveTestRecord(t, app, "roles", map[string]any{"gym": gym.Id, "name": name, "permissions": ids})
	}
	user := func(name string) *core.Record {
		return saveTestRecord(t, app, "users", map[string]any{"email": name + "@example.com", "firstname": name})
	}
	f := tenancyFixture{memberships: map[string]*core.Record{}}
	f.gymA = saveTestRecord(t, app, "gyms", map[string]any{"slug": "gym-a", "name": "A"})
	f.gymB = saveTestRecord(t, app, "gyms", map[string]any{"slug": "gym-b", "name": "B"})
	adminA := role(f.gymA, "admin", "manage_users", "manage_routes", "manage_tasks")
	setterA := role(f.gymA, "routesetter", "manage_routes", "manage_tasks")
	analystB := role(f.gymB, "analyst", "view_analytics")
	setterB := role(f.gymB, "routesetter", "manage_routes")

	f.adminA, f.setterA, f.splitUser, f.setterB, f.climber = user("adminA"), user("setterA"), user("split"), user("setterB"), user("climber")
	for _, grant := range []struct {
		user *core.Record
		gym  *core.Record
		role *core.Record
	}{
		{f.adminA, f.gymA, adminA},
		{f.setterA, f.gymA, setterA},
		{f.splitUser, f.gymA, setterA},
		{f.splitUser, f.gymB, analystB},
		{f.setterB, f.gymB, setterB},
	} {
		f.memberships[grant.user.Id+grant.gym.Id] = saveTestRecord(t, app, "memberships", map[string]any{"user": grant.user.Id, "gym": grant.gym.Id, "role": grant.role.Id})
	}
	f.routeA = saveTestRecord(t, app, "routes", map[string]any{"name": "A", "gym": f.gymA.Id})
	f.routeB = saveTestRecord(t, app, "routes", map[string]any{"name": "B", "gym": f.gymB.Id})
	return f
}

func newMigratedApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	jsvm.MustRegister(app, jsvm.Config{MigrationsDir: "pb_migrations"})
	runner := core.NewMigrationsRunner(app, *latestMigrations())
	if _, err := runner.Up(); err != nil {
		t.Fatal(err)
	}
	return app
}

func ruleMatches(t *testing.T, app core.App, collection *core.Collection, rule string, auth *core.Record, allowHidden bool) []string {
	t.Helper()
	return ruleMatchesBody(t, app, collection, rule, auth, nil, allowHidden)
}

func ruleMatchesBody(t *testing.T, app core.App, collection *core.Collection, rule string, auth *core.Record, body map[string]any, allowHidden bool) []string {
	t.Helper()
	info := &core.RequestInfo{Auth: auth, Body: body, Context: core.RequestInfoContextDefault}
	resolver := core.NewRecordFieldResolver(app, collection, info, allowHidden)
	expr, err := search.FilterData(rule).BuildExpr(resolver)
	if err != nil {
		t.Fatalf("rule %q: %v", rule, err)
	}
	query := app.RecordQuery(collection).AndWhere(expr)
	if err := resolver.UpdateQuery(query); err != nil {
		t.Fatal(err)
	}
	records := []*core.Record{}
	if err := query.All(&records); err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	for _, record := range records {
		if !slices.Contains(ids, record.Id) {
			ids = append(ids, record.Id)
		}
	}
	slices.Sort(ids)
	return ids
}

func sortedIDs(records ...*core.Record) []string {
	ids := []string{}
	for _, record := range records {
		ids = append(ids, record.Id)
	}
	slices.Sort(ids)
	return ids
}

func TestMemberRuleSemantics(t *testing.T) {
	app := newMigratedApp(t)
	defer app.Cleanup()
	f := seedTenancy(t, app)

	routes, err := app.FindCollectionByNameOrId("routes")
	if err != nil {
		t.Fatal(err)
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name       string
		collection *core.Collection
		rule       string
		auth       *core.Record
		want       []string
	}{
		{"setter of A manages routes of A", routes, *routes.DeleteRule, f.setterA, sortedIDs(f.routeA)},
		{"setter of A and analyst of B manages only A", routes, *routes.DeleteRule, f.splitUser, sortedIDs(f.routeA)},
		{"setter of B manages only B", routes, *routes.DeleteRule, f.setterB, sortedIDs(f.routeB)},
		{"climber manages nothing", routes, *routes.DeleteRule, f.climber, sortedIDs()},
		{"guest manages nothing", routes, *routes.DeleteRule, nil, sortedIDs()},
		{"admin of A lists members of A", users, *users.ListRule, f.adminA, sortedIDs(f.adminA, f.setterA, f.splitUser)},
		{"setter of A lists only itself", users, *users.ListRule, f.setterA, sortedIDs(f.setterA)},
		{"climber lists only itself", users, *users.ListRule, f.climber, sortedIDs(f.climber)},
	}
	for _, allowHidden := range []bool{true, false} {
		for _, c := range cases {
			if got := ruleMatches(t, app, c.collection, c.rule, c.auth, allowHidden); !slices.Equal(got, c.want) {
				t.Errorf("%s (allowHidden=%v): got %v, want %v", c.name, allowHidden, got, c.want)
			}
		}
	}
}

func TestPlatformAdminRules(t *testing.T) {
	app := newMigratedApp(t)
	defer app.Cleanup()
	f := seedTenancy(t, app)
	f.climber.Set("platform_admin", true)
	if err := app.SaveNoValidate(f.climber); err != nil {
		t.Fatal(err)
	}
	operator := f.climber

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	gyms, err := app.FindCollectionByNameOrId("gyms")
	if err != nil {
		t.Fatal(err)
	}
	auditLogs, err := app.FindCollectionByNameOrId("audit_logs")
	if err != nil {
		t.Fatal(err)
	}
	memberships, err := app.FindCollectionByNameOrId("memberships")
	if err != nil {
		t.Fatal(err)
	}
	allMemberships := []*core.Record{}
	for _, membership := range f.memberships {
		allMemberships = append(allMemberships, membership)
	}
	everyUser, err := app.FindAllRecords("users")
	if err != nil {
		t.Fatal(err)
	}
	allUsers := sortedIDs(everyUser...)
	gymless := saveTestRecord(t, app, "audit_logs", map[string]any{"action": "login_failed"})
	gymRow := saveTestRecord(t, app, "audit_logs", map[string]any{"action": "create", "gym": f.gymA.Id})
	flag := map[string]any{"platform_admin": true}
	cases := []struct {
		name       string
		collection *core.Collection
		rule       string
		auth       *core.Record
		body       map[string]any
		want       []string
	}{
		{"user updates own profile", users, *users.UpdateRule, f.setterA, map[string]any{"firstname": "x"}, sortedIDs(f.setterA)},
		{"user cannot set the flag", users, *users.UpdateRule, f.setterA, flag, sortedIDs()},
		{"platform admin cannot set the flag either", users, *users.UpdateRule, operator, flag, sortedIDs()},
		{"platform admin passes gym create", gyms, *gyms.CreateRule, operator, nil, sortedIDs(f.gymA, f.gymB)},
		{"admin of A cannot create gyms", gyms, *gyms.CreateRule, f.adminA, nil, sortedIDs()},
		{"platform admin updates every gym", gyms, *gyms.UpdateRule, operator, nil, sortedIDs(f.gymA, f.gymB)},
		{"platform admin deletes gyms", gyms, *gyms.DeleteRule, operator, nil, sortedIDs(f.gymA, f.gymB)},
		{"platform admin reads every audit row", auditLogs, *auditLogs.ListRule, operator, nil, sortedIDs(gymless, gymRow)},
		{"admin of A does not read gym-less audit rows", auditLogs, *auditLogs.ListRule, f.adminA, nil, sortedIDs()},
		{"platform admin lists every user", users, *users.ListRule, operator, nil, allUsers},
		{"platform admin lists every membership", memberships, *memberships.ListRule, operator, nil, sortedIDs(allMemberships...)},
		{"platform admin removes members", memberships, *memberships.DeleteRule, operator, nil, sortedIDs(allMemberships...)},
	}
	for _, c := range cases {
		if got := ruleMatchesBody(t, app, c.collection, c.rule, c.auth, c.body, false); !slices.Equal(got, c.want) {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
	if users.CreateRule == nil || !strings.Contains(*users.CreateRule, "@request.body.platform_admin:isset = false") {
		t.Errorf("registration may set platform_admin: %v", users.CreateRule)
	}
}

func TestTaskAssigneesView(t *testing.T) {
	app := newMigratedApp(t)
	defer app.Cleanup()
	f := seedTenancy(t, app)

	assignees, err := app.FindAllRecords("task_assignees")
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, row := range assignees {
		var name string
		if err := json.Unmarshal([]byte(row.GetString("name")), &name); err != nil {
			t.Fatal(err)
		}
		got[row.Id] = row.GetString("user") + "@" + row.GetString("gym") + ":" + name
	}
	want := map[string]string{}
	for _, user := range []*core.Record{f.adminA, f.setterA, f.splitUser} {
		want[f.memberships[user.Id+f.gymA.Id].Id] = user.Id + "@" + f.gymA.Id + ":" + user.GetString("firstname")
	}
	if len(got) != len(want) {
		t.Fatalf("assignees = %v, want %v", got, want)
	}
	for id, row := range want {
		if got[id] != row {
			t.Errorf("assignee %s = %q, want %q", id, got[id], row)
		}
	}
}

func TestMembershipsMigration(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	jsvm.MustRegister(app, jsvm.Config{MigrationsDir: "pb_migrations"})
	runner := migrateDownTo(t, app, "1791800002_memberships_rules.js")

	gym := saveTestRecord(t, app, "gyms", map[string]any{"slug": "home", "name": "Home"})
	if _, err := app.DB().NewQuery("UPDATE roles SET gym = {:gym}").Bind(map[string]any{"gym": gym.Id}).Execute(); err != nil {
		t.Fatal(err)
	}
	setterRole, err := app.FindFirstRecordByData("roles", "name", "routesetter")
	if err != nil {
		t.Fatal(err)
	}
	userRole, err := app.FindFirstRecordByData("roles", "name", "user")
	if err != nil {
		t.Fatal(err)
	}
	setter := saveTestRecord(t, app, "users", map[string]any{"email": "setter@example.com", "role": setterRole.Id})
	climber := saveTestRecord(t, app, "users", map[string]any{"email": "climber@example.com", "role": userRole.Id})

	if _, err := runner.Up(); err != nil {
		t.Fatal(err)
	}

	memberships, err := app.FindAllRecords("memberships")
	if err != nil {
		t.Fatal(err)
	}
	if len(memberships) != 1 || memberships[0].GetString("user") != setter.Id || memberships[0].GetString("gym") != gym.Id || memberships[0].GetString("role") != setterRole.Id {
		t.Fatalf("memberships = %v", memberships)
	}
	if _, err := app.FindFirstRecordByData("roles", "name", "user"); err == nil {
		t.Error("role user still exists")
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	if users.Fields.GetByName("role") != nil {
		t.Error("users.role still exists")
	}

	if _, err := runner.Down(migrationsSince("1791800002_memberships_rules.js")); err != nil {
		t.Fatal(err)
	}
	for _, check := range []struct {
		user *core.Record
		role string
	}{{setter, "routesetter"}, {climber, "user"}} {
		restored, err := app.FindRecordById("users", check.user.Id)
		if err != nil {
			t.Fatal(err)
		}
		role, err := app.FindRecordById("roles", restored.GetString("role"))
		if err != nil || role.GetString("name") != check.role {
			t.Errorf("%s restored with role %v (%v)", check.user.GetString("email"), role, err)
		}
	}
	if total, _ := app.CountRecords("memberships"); total != 0 {
		t.Errorf("%d memberships left after down", total)
	}
}

func TestPlatformSettingsMigration(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	jsvm.MustRegister(app, jsvm.Config{MigrationsDir: "pb_migrations"})
	runner := migrateDownTo(t, app, "1791800004_platform_settings.js")
	if _, err := app.FindRecordById("settings", "settings_123456"); err != nil {
		t.Fatal(err)
	}
	audit := saveTestRecord(t, app, "audit_logs", map[string]any{"collection_name": "settings", "record_id": "settings_123456"})

	if _, err := runner.Up(); err != nil {
		t.Fatal(err)
	}

	if _, err := app.FindRecordById("settings", "platformsetting"); err != nil {
		t.Fatalf("renamed settings row missing: %v", err)
	}
	if _, err := app.FindRecordById("settings", "settings_123456"); err == nil {
		t.Error("old settings row still exists")
	}
	audit, err = app.FindRecordById("audit_logs", audit.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := audit.GetString("record_id"); got != "platformsetting" {
		t.Errorf("audit record_id = %q, want platformsetting", got)
	}

	f := seedTenancy(t, app)
	f.climber.Set("platform_admin", true)
	if err := app.SaveNoValidate(f.climber); err != nil {
		t.Fatal(err)
	}
	settings, err := app.FindCollectionByNameOrId("settings")
	if err != nil {
		t.Fatal(err)
	}
	if settings.UpdateRule == nil {
		t.Fatal("settings update rule is superuser-only")
	}
	if settings.CreateRule != nil || settings.DeleteRule != nil {
		t.Errorf("settings create/delete are not superuser-only: %v %v", settings.CreateRule, settings.DeleteRule)
	}
	for _, c := range []struct {
		name string
		auth *core.Record
		want []string
	}{
		{"platform admin updates settings", f.climber, []string{"platformsetting"}},
		{"gym admin cannot update settings", f.adminA, []string{}},
		{"guest cannot update settings", nil, []string{}},
	} {
		if got := ruleMatches(t, app, settings, *settings.UpdateRule, c.auth, false); !slices.Equal(got, c.want) {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestGymsMigrationDownRefusesSeveralGyms(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	jsvm.MustRegister(app, jsvm.Config{MigrationsDir: "pb_migrations"})
	runner := core.NewMigrationsRunner(app, *latestMigrations())
	if _, err := runner.Up(); err != nil {
		t.Fatal(err)
	}
	gyms, err := app.FindCollectionByNameOrId("gyms")
	if err != nil {
		t.Fatal(err)
	}
	for _, slug := range []string{"gym-a", "gym-b"} {
		gym := core.NewRecord(gyms)
		gym.Load(map[string]any{"slug": slug, "name": slug})
		if err := app.Save(gym); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := runner.Down(migrationsSince("1791800001_gyms.js")); err == nil || !strings.Contains(err.Error(), "more than one gym") {
		t.Fatalf("revert with two gyms: %v", err)
	}
	if _, err := app.FindCollectionByNameOrId("memberships"); err != nil {
		t.Errorf("failed revert left no memberships: %v", err)
	}
}
