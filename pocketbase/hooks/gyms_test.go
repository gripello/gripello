package hooks

import (
	"encoding/json"
	"net/http"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/jsvm"
	"github.com/pocketbase/pocketbase/tests"
)

type gymSlugFixtures struct {
	Reserved []string `json:"reserved"`
	Valid    []string `json:"valid"`
	Invalid  []string `json:"invalid"`
}

func loadGymSlugFixtures(t *testing.T) gymSlugFixtures {
	t.Helper()
	raw, err := os.ReadFile("../testdata/gymSlug.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures gymSlugFixtures
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	return fixtures
}

func TestValidateGymSlug(t *testing.T) {
	fixtures := loadGymSlugFixtures(t)
	if !slices.Equal(reservedGymSlugs, fixtures.Reserved) {
		t.Errorf("reservedGymSlugs = %v, want %v", reservedGymSlugs, fixtures.Reserved)
	}
	for _, slug := range fixtures.Valid {
		if err := validateGymSlug(slug); err != nil {
			t.Errorf("validateGymSlug(%q) = %v", slug, err)
		}
	}
	for _, slug := range fixtures.Invalid {
		if validateGymSlug(slug) == nil {
			t.Errorf("validateGymSlug(%q) accepted", slug)
		}
	}
}

func newGymTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	jsvm.MustRegister(app, jsvm.Config{MigrationsDir: "../pb_migrations"})
	if err := app.RunAllMigrations(); err != nil {
		t.Fatal(err)
	}
	Register(app)
	return app
}

func saveRecord(t *testing.T, app core.App, collection string, data map[string]any) *core.Record {
	t.Helper()
	target, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(target)
	record.Load(data)
	if err := app.Save(record); err != nil {
		t.Fatalf("saving %s: %v", collection, err)
	}
	return record
}

func TestGymLifecycle(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()

	first := saveRecord(t, app, "gyms", map[string]any{"slug": "first", "name": "First", "active": true})
	second := saveRecord(t, app, "gyms", map[string]any{"slug": "second", "name": "Second", "active": true})

	for _, gym := range []*core.Record{first, second} {
		for _, name := range []string{"admin", "routesetter"} {
			total, err := app.CountRecords("roles", dbx.HashExp{"gym": gym.Id, "name": name})
			if err != nil || total != 1 {
				t.Errorf("gym %s has %d %s roles (%v)", gym.GetString("slug"), total, name, err)
			}
		}
	}
	if orphans, _ := app.CountRecords("roles", dbx.HashExp{"gym": ""}); orphans != 0 {
		t.Errorf("%d roles without gym", orphans)
	}
	if total, _ := app.CountRecords("roles", dbx.HashExp{"name": "user"}); total != 0 {
		t.Errorf("%d user roles left", total)
	}

	hall := saveRecord(t, app, "locations", map[string]any{"name": "Hall", "gym": first.Id})
	otherHall := saveRecord(t, app, "locations", map[string]any{"name": "Hall", "gym": second.Id})
	routes, err := app.FindCollectionByNameOrId("routes")
	if err != nil {
		t.Fatal(err)
	}
	foreign := core.NewRecord(routes)
	foreign.Load(map[string]any{"name": "Crimp", "grade": "6a", "creator": []string{"Setter"}, "location": hall.Id, "gym": second.Id})
	if err := app.Save(foreign); err == nil {
		t.Error("route accepted a gym other than its location's")
	}
	route := saveRecord(t, app, "routes", map[string]any{
		"name": "Crimp", "grade": "6a", "creator": []string{"Setter"}, "location": hall.Id,
	})
	if route.GetString("gym") != first.Id {
		t.Errorf("route gym = %q, want location gym %q", route.GetString("gym"), first.Id)
	}
	rating := saveRecord(t, app, "ratings", map[string]any{"route_id": route.Id, "rating": 4})
	if rating.GetString("gym") != first.Id {
		t.Errorf("rating gym = %q, want %q", rating.GetString("gym"), first.Id)
	}

	route.Set("location", otherHall.Id)
	if err := app.Save(route); err == nil {
		t.Error("route moved to a location of another gym")
	}
	hall.Set("gym", second.Id)
	if err := app.Save(hall); err == nil {
		t.Error("location moved to another gym")
	}
}

func TestContactEmailFallsBackToOperator(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()

	settings, err := app.FindRecordById("settings", platformSettingsID)
	if err != nil {
		t.Fatal(err)
	}
	settings.Set("contact_email", "operator@example.com")
	if err := app.Save(settings); err != nil {
		t.Fatal(err)
	}
	silent := saveRecord(t, app, "gyms", map[string]any{"slug": "silent", "name": "Silent"})
	loud := saveRecord(t, app, "gyms", map[string]any{"slug": "loud", "name": "Loud", "contact_email": "gym@example.com"})

	if got := contactEmail(app, silent.Id); got != "operator@example.com" {
		t.Errorf("contactEmail(silent) = %q", got)
	}
	if got := contactEmail(app, loud.Id); got != "gym@example.com" {
		t.Errorf("contactEmail(loud) = %q", got)
	}
	if got := gymPath(app, loud.Id, "/manage/tasks"); got != "/loud/manage/tasks" {
		t.Errorf("gymPath = %q", got)
	}
}

func TestMailSubjectNamesTheGym(t *testing.T) {
	if got := mailSubject("New content report", "Boulderhalle Nord", "Gripello"); got != "New content report - Boulderhalle Nord" {
		t.Fatalf("subject = %q", got)
	}
	if got := mailSubject("New content report", "", "Gripello"); got != "New content report - Gripello" {
		t.Fatalf("fallback subject = %q", got)
	}
}

func TestReportAlertReachesGymModerators(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()
	app.Settings().SMTP.Enabled = true

	gym := saveRecord(t, app, "gyms", map[string]any{"slug": "alerts", "name": "Alerts", "active": true})
	admin, err := app.FindFirstRecordByFilter("roles", "gym = {:gym} && name = 'admin'", dbx.Params{"gym": gym.Id})
	if err != nil {
		t.Fatal(err)
	}
	moderator := saveRecord(t, app, "users", map[string]any{"email": "mod@example.com", "password": "pw12345678"})
	saveRecord(t, app, "memberships", map[string]any{"user": moderator.Id, "gym": gym.Id, "role": admin.Id})
	hall := saveRecord(t, app, "locations", map[string]any{"name": "Hall", "gym": gym.Id})
	route := saveRecord(t, app, "routes", map[string]any{"name": "Crimp", "grade": "6a", "creator": []string{"Setter"}, "location": hall.Id})
	rating := saveRecord(t, app, "ratings", map[string]any{"route_id": route.Id, "rating": 4, "comment": "rude"})
	saveRecord(t, app, "reports", map[string]any{
		"content_type": "rating", "content_id": rating.Id, "content_url": "/route", "reason": "spam_fraud",
		"explanation": "x", "status": "open", "notifier_name": "N", "notifier_email": "notifier@example.com", "good_faith": true,
	})

	alerted := false
	for _, message := range app.TestMailer.Messages() {
		for _, to := range message.To {
			if to.Address == "mod@example.com" && strings.HasPrefix(message.Subject, "New content report") {
				alerted = true
			}
		}
	}
	if !alerted {
		t.Errorf("moderator got no alert; %d mails sent", app.TestMailer.TotalSend())
	}
}

func gymPreviousSlugs(t *testing.T, gym *core.Record) []string {
	t.Helper()
	slugs, err := previousSlugs(gym)
	if err != nil {
		t.Fatal(err)
	}
	return slugs
}

func renameGym(t *testing.T, app core.App, gymID, slug string) (*core.Record, error) {
	t.Helper()
	gym, err := app.FindRecordById("gyms", gymID)
	if err != nil {
		t.Fatal(err)
	}
	gym.Set("slug", slug)
	return gym, app.Save(gym)
}

func TestGymSlugHistory(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()

	gym := saveRecord(t, app, "gyms", map[string]any{"slug": "north", "name": "North"})
	if _, err := renameGym(t, app, gym.Id, "north-hall"); err != nil {
		t.Fatal(err)
	}
	gym, err := renameGym(t, app, gym.Id, "nord")
	if err != nil {
		t.Fatal(err)
	}
	if got := gymPreviousSlugs(t, gym); !slices.Equal(got, []string{"north", "north-hall"}) {
		t.Errorf("previous slugs after renames = %v", got)
	}

	if gym, err = renameGym(t, app, gym.Id, "north"); err != nil {
		t.Fatalf("reclaiming the old slug failed: %v", err)
	}
	if got := gymPreviousSlugs(t, gym); !slices.Equal(got, []string{"north-hall", "nord"}) {
		t.Errorf("previous slugs after reclaim = %v", got)
	}

	gyms, err := app.FindCollectionByNameOrId("gyms")
	if err != nil {
		t.Fatal(err)
	}
	for _, slug := range []string{"north", "nord"} {
		other := core.NewRecord(gyms)
		other.Load(map[string]any{"slug": slug, "name": "Other"})
		if app.Save(other) == nil {
			t.Errorf("another gym took the used slug %q", slug)
		}
	}
	other := saveRecord(t, app, "gyms", map[string]any{"slug": "south", "name": "South"})
	if _, err := renameGym(t, app, other.Id, "nord"); err == nil {
		t.Error("another gym renamed itself to a previous slug")
	}
}

func TestOnlyPlatformAdminsReleaseSlugs(t *testing.T) {
	cases := []struct {
		name          string
		platformAdmin bool
		status        int
	}{
		{"gym admin may not release", false, http.StatusForbidden},
		{"platform admin releases", true, http.StatusOK},
	}
	for _, c := range cases {
		f := newMemberFixture(t)
		if _, err := renameGym(t, f.app, f.gymA.Id, "gym-a-new"); err != nil {
			t.Fatal(err)
		}
		caller := f.adminA
		if c.platformAdmin {
			caller = saveUser(t, f.app, "operator@example.com")
			caller.Set("platform_admin", true)
			if err := f.app.Save(caller); err != nil {
				t.Fatal(err)
			}
		}
		token, err := caller.NewAuthToken()
		if err != nil {
			t.Fatal(err)
		}
		scenario := tests.ApiScenario{
			Name:            c.name,
			Method:          http.MethodPatch,
			URL:             "/api/collections/gyms/records/" + f.gymA.Id,
			Body:            strings.NewReader(`{"previous_slugs":[]}`),
			Headers:         map[string]string{"Authorization": token},
			ExpectedStatus:  c.status,
			ExpectedContent: []string{"{"},
			TestAppFactory:  func(testing.TB) *tests.TestApp { return f.app },
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				gyms, _ := app.FindCollectionByNameOrId("gyms")
				reuse := core.NewRecord(gyms)
				reuse.Load(map[string]any{"slug": "gym-a", "name": "Reuse"})
				if released := app.Save(reuse) == nil; released != c.platformAdmin {
					t.Errorf("old slug reusable = %v", released)
				}
			},
		}
		scenario.Test(t)
	}
}

func TestOnlyPlatformAdminsChangeSlugs(t *testing.T) {
	cases := []struct {
		name          string
		platformAdmin bool
		status        int
	}{
		{"gym admin may not change the slug", false, http.StatusForbidden},
		{"platform admin changes the slug", true, http.StatusOK},
	}
	for _, c := range cases {
		f := newMemberFixture(t)
		caller := f.adminA
		if c.platformAdmin {
			caller = saveUser(t, f.app, "operator@example.com")
			caller.Set("platform_admin", true)
			if err := f.app.Save(caller); err != nil {
				t.Fatal(err)
			}
		}
		token, err := caller.NewAuthToken()
		if err != nil {
			t.Fatal(err)
		}
		scenario := tests.ApiScenario{
			Name:            c.name,
			Method:          http.MethodPatch,
			URL:             "/api/collections/gyms/records/" + f.gymA.Id,
			Body:            strings.NewReader(`{"slug":"gym-a-renamed"}`),
			Headers:         map[string]string{"Authorization": token},
			ExpectedStatus:  c.status,
			ExpectedContent: []string{"{"},
			TestAppFactory:  func(testing.TB) *tests.TestApp { return f.app },
		}
		scenario.Test(t)
	}
}
