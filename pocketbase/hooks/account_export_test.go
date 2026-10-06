package hooks

import (
	"archive/zip"
	"bytes"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/jsvm"
	"github.com/pocketbase/pocketbase/tests"
)

func exportFiles(t *testing.T, app core.App, user *core.Record) map[string]string {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	if err := writeAccountExport(app, zw, user); err != nil {
		t.Fatal(err)
	}
	zw.Close()
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]string{}
	for _, file := range zr.File {
		r, _ := file.Open()
		content, _ := io.ReadAll(r)
		r.Close()
		files[file.Name] = string(content)
	}
	return files
}

func TestAccountExportContainsOnlyOwnData(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()

	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id})
	route := saveRecord(t, f.app, "routes", map[string]any{"name": "Crimpy", "grade": "6a", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id})
	saveRecord(t, f.app, "ticks", map[string]any{"user": f.climber.Id, "route": route.Id, "type": "top", "attempts": 2, "date": time.Now(), "note": "my send"})
	saveRecord(t, f.app, "ticks", map[string]any{"user": f.setterA.Id, "route": route.Id, "type": "flash", "attempts": 1, "date": time.Now(), "note": "other send"})
	saveRecord(t, f.app, "tasks", map[string]any{"gym": f.gymA.Id, "kind": "defect", "category": "loose_hold", "priority": 4, "status": "open", "route": route.Id, "reporter": f.climber.Id, "description": "my defect"})
	saveRecord(t, f.app, "tasks", map[string]any{"gym": f.gymA.Id, "kind": "defect", "category": "loose_hold", "priority": 4, "status": "open", "route": route.Id, "reporter": f.setterA.Id, "description": "other defect"})
	saveRecord(t, f.app, "reports", map[string]any{"gym": f.gymA.Id, "content_type": "route", "content_id": route.Id, "content_url": "/x", "reason": "other", "explanation": "my report", "notifier_name": "n", "notifier_email": strings.ToUpper(f.climber.Email()), "status": "open", "good_faith": true, "decided_by": f.adminA.Id})

	f.gymA.Set("contact_email", "gym@example.com")
	if err := f.app.Save(f.gymA); err != nil {
		t.Fatal(err)
	}
	competition, _ := saveCompetition(t, f.app, f.gymB.Id)
	category := saveRecord(t, f.app, "competition_categories", map[string]any{"name": "Open", "competition": competition.Id})
	saveRecord(t, f.app, "competition_entries", map[string]any{
		"competition": competition.Id, "category": category.Id, "user": f.climber.Id,
		"display_name": "C", "birth_year": 1990, "status": "registered", "bib": 1,
	})

	hall, err := f.app.FindRecordById("locations", hall.Id)
	if err != nil {
		t.Fatal(err)
	}
	hall.Set("map", map[string]any{"width": 20, "height": 20, "shapes": []any{}})
	if err := f.app.Save(hall); err != nil {
		t.Fatal(err)
	}
	wall := saveRecord(t, f.app, "walls", map[string]any{"location": hall.Id, "name": "Slab", "outline": [][2]float64{{1, 1}, {2, 1}, {2, 2}}, "edge": [][2]float64{{1, 1}, {2, 1}}})
	f.climber.Set("followed_walls", []string{wall.Id})
	f.climber.Set("avatar", "missing.png")
	if err := f.app.UnsafeWithoutHooks().SaveNoValidate(f.climber); err != nil {
		t.Fatal(err)
	}

	files := exportFiles(t, f.app, f.climber)
	for _, name := range []string{"profile.json", "ticks.json", "logbook.csv", "memberships.json", "competition_entries.json", "notifications.json", "devices.json", "activity_log.json", "tasks.json", "reports.json"} {
		if _, ok := files[name]; !ok {
			t.Errorf("missing %s", name)
		}
	}
	if !strings.Contains(files["profile.json"], f.climber.Email()) {
		t.Error("profile lacks the email")
	}
	if strings.Contains(files["profile.json"], "tokenKey") || strings.Contains(files["profile.json"], "password") {
		t.Errorf("profile leaks credentials: %s", files["profile.json"])
	}
	if !strings.Contains(files["logbook.csv"], "Crimpy") || !strings.Contains(files["logbook.csv"], "my send") || !strings.Contains(files["logbook.csv"], ",A\n") {
		t.Errorf("logbook = %q", files["logbook.csv"])
	}
	if strings.Contains(files["logbook.csv"]+files["ticks.json"], "other send") {
		t.Error("export contains another user's tick")
	}
	if !strings.Contains(files["tasks.json"], "my defect") || strings.Contains(files["tasks.json"], "other defect") {
		t.Errorf("tasks = %s", files["tasks.json"])
	}
	if strings.Contains(files["reports.json"], "my report") {
		t.Error("unverified user received reports filed under their email")
	}

	if !strings.Contains(files["profile.json"], `"wall": "Slab"`) || !strings.Contains(files["profile.json"], `"gym": "A"`) || strings.Contains(files["profile.json"], "outline") {
		t.Errorf("followed walls should be names only: %s", files["profile.json"])
	}
	if _, ok := files["avatar.png"]; ok {
		t.Error("missing avatar file produced an entry")
	}
	if !strings.Contains(files["tasks.json"], "Crimpy") || strings.Contains(files["tasks.json"], f.climber.Id) {
		t.Errorf("tasks should name the route and drop user ids: %s", files["tasks.json"])
	}
	if !strings.Contains(files["competition_entries.json"], `"competition": "Jam"`) || !strings.Contains(files["competition_entries.json"], `"category": "Open"`) || strings.Contains(files["competition_entries.json"], "scoring_format") {
		t.Errorf("competition entries = %s", files["competition_entries.json"])
	}

	memberships := exportFiles(t, f.app, f.setterA)["memberships.json"]
	for _, want := range []string{`"gym": "A"`, `"gym_slug": "gym-a"`, `"role": "routesetter"`, `"manage_routes"`} {
		if !strings.Contains(memberships, want) {
			t.Errorf("memberships lack %s: %s", want, memberships)
		}
	}
	for _, gymOnly := range []string{"contact_email", "legal_representatives", "boulder_bands", "gym@example.com"} {
		if strings.Contains(memberships, gymOnly) {
			t.Errorf("memberships leak gym data %s: %s", gymOnly, memberships)
		}
	}

	f.climber.SetVerified(true)
	if err := f.app.Save(f.climber); err != nil {
		t.Fatal(err)
	}
	reports := exportFiles(t, f.app, f.climber)["reports.json"]
	if !strings.Contains(reports, "my report") || strings.Contains(reports, f.adminA.Id) {
		t.Errorf("verified user's reports (any email case, no moderator id) = %s", reports)
	}
}

func TestAccountExportFailsInsteadOfSendingPartialData(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	if _, err := f.app.DB().NewQuery("DROP TABLE push_subscriptions").Execute(); err != nil {
		t.Fatal(err)
	}
	if err := writeAccountExport(f.app, zip.NewWriter(io.Discard), f.climber); err == nil {
		t.Error("export succeeded although a query failed")
	}
	token, err := f.climber.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	scenario := tests.ApiScenario{
		Method:          http.MethodGet,
		URL:             "/api/account/export",
		Headers:         map[string]string{"Authorization": token},
		ExpectedStatus:  http.StatusInternalServerError,
		ExpectedContent: []string{"Exporting your data failed."},
		TestAppFactory:  func(testing.TB) *tests.TestApp { return f.app },
	}
	scenario.Test(t)
}

func TestAccountExportRoute(t *testing.T) {
	for _, signedIn := range []bool{false, true} {
		f := newMemberFixture(t)
		scenario := tests.ApiScenario{
			Name:            "guest",
			Method:          http.MethodGet,
			URL:             "/api/account/export",
			ExpectedStatus:  http.StatusUnauthorized,
			ExpectedContent: []string{"{"},
			TestAppFactory:  func(testing.TB) *tests.TestApp { return f.app },
		}
		if signedIn {
			token, err := f.climber.NewAuthToken()
			if err != nil {
				t.Fatal(err)
			}
			scenario.Name = "signed in"
			scenario.Headers = map[string]string{"Authorization": token}
			scenario.ExpectedStatus = http.StatusOK
			scenario.ExpectedContent = []string{"profile.json"}
			scenario.AfterTestFunc = func(t testing.TB, _ *tests.TestApp, res *http.Response) {
				if res.Header.Get("Content-Type") != "application/zip" || !strings.HasPrefix(res.Header.Get("Content-Disposition"), `attachment; filename="gripello-data-`) {
					t.Errorf("headers = %v", res.Header)
				}
			}
		}
		scenario.Test(t)
	}
}

func TestAccountExportCoversEveryUserLink(t *testing.T) {
	app := core.NewBaseApp(core.BaseAppConfig{DataDir: t.TempDir()})
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	defer app.ResetBootstrapState()
	jsvm.MustRegister(app, jsvm.Config{MigrationsDir: "../pb_migrations"})
	if err := app.RunAllMigrations(); err != nil {
		t.Fatal(err)
	}

	exported := map[string]bool{
		"users.avatar":                 true,
		"users.banner":                 true,
		"ticks.user":                   true,
		"memberships.user":             true,
		"competition_entries.user":     true,
		"notifications.user":           true,
		"push_subscriptions.user":      true,
		"tasks.reporter":               true,
		"tasks.assignee":               true,
		"tasks.done_by":                true,
		"tasks.photo":                  true,
		"audit_logs.actor":             true,
		"follows.follower":             true,
		"follows.followee":             true,
		"beta_videos.user":             true,
		"user_badges.user":             true,
		"beta_videos.file":             true,
		"ratings.user":                 true,
		"reports.decided_by":           false, // moderation of other people's reports, holds the notifiers' data
		"blocks.blocker":               true,
		"blocks.blocked":               false, // who blocked you is the blocker's own data
		"moderation_items.author":      true,
		"moderation_items.files":       true,
		"moderation_items.reviewed_by": false, // moderator identity
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	collections, err := app.FindAllCollections(core.CollectionTypeBase, core.CollectionTypeAuth)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, collection := range collections {
		linked := collection.Id == users.Id
		for _, field := range collection.Fields {
			if relation, ok := field.(*core.RelationField); ok && relation.CollectionId == users.Id {
				found[collection.Name+"."+field.GetName()] = true
				linked = true
			}
		}
		for _, field := range collection.Fields {
			if _, ok := field.(*core.FileField); ok && linked {
				found[collection.Name+"."+field.GetName()] = true
			}
		}
	}
	for key := range found {
		if _, ok := exported[key]; !ok {
			t.Errorf("%s holds user data: add it to writeAccountExport (account_export.go) and this list, or list it as not exported with a reason", key)
		}
	}
	for key := range exported {
		if !found[key] {
			t.Errorf("%s no longer exists: drop it from this list", key)
		}
	}
}
