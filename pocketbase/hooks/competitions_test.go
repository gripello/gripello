package hooks

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func newCompetitionRecord(collectionName string, numbers []string, texts []string) *core.Record {
	collection := core.NewBaseCollection(collectionName)
	for _, name := range numbers {
		collection.Fields.Add(&core.NumberField{Name: name})
	}
	for _, name := range texts {
		collection.Fields.Add(&core.TextField{Name: name})
	}
	collection.Fields.Add(&core.DateField{Name: "starts_at"})
	collection.Fields.Add(&core.DateField{Name: "ends_at"})
	return core.NewRecord(collection)
}

func TestAcceptsScores(t *testing.T) {
	competition := newCompetitionRecord("competitions", nil, []string{"status"})
	competition.Set("status", "open")
	competition.Set("starts_at", "2026-10-10 10:00:00.000Z")
	competition.Set("ends_at", "2026-10-10 14:00:00.000Z")

	at := func(value string) time.Time {
		parsed, _ := time.Parse(time.RFC3339, value)
		return parsed
	}
	if !acceptsScores(competition, at("2026-10-10T12:00:00Z")) {
		t.Error("score inside the window rejected")
	}
	if acceptsScores(competition, at("2026-10-10T09:59:00Z")) || acceptsScores(competition, at("2026-10-10T14:01:00Z")) {
		t.Error("score outside the window accepted")
	}
	competition.Set("status", "closed")
	if acceptsScores(competition, at("2026-10-10T12:00:00Z")) {
		t.Error("score on a closed competition accepted")
	}
}

func newScoreContext(discipline, format string, zone bool, holdCount int) (*core.Record, *core.Record, *core.Record) {
	score := newCompetitionRecord("competition_scores", []string{"attempts", "zone_attempt", "top_attempt", "height"}, []string{"style"})
	score.Collection().Fields.Add(&core.BoolField{Name: "height_plus"})
	compRoute := newCompetitionRecord("competition_routes", []string{"hold_count"}, nil)
	compRoute.Collection().Fields.Add(&core.BoolField{Name: "zone"})
	compRoute.Set("zone", zone)
	compRoute.Set("hold_count", holdCount)
	competition := newCompetitionRecord("competitions", nil, []string{"discipline", "scoring_format"})
	competition.Set("discipline", discipline)
	competition.Set("scoring_format", format)
	return score, compRoute, competition
}

func TestNormalizeBoulderScore(t *testing.T) {
	cases := []struct {
		name                              string
		zone                              bool
		attempts, zoneAttempt, topAttempt int
		wantAttempts, wantZone            int
	}{
		{"top implies zone", true, 3, 0, 3, 3, 3},
		{"zone after top is clamped", true, 4, 4, 2, 4, 2},
		{"no zone hold clears the zone", false, 2, 1, 0, 2, 0},
		{"attempts never below the top", true, 1, 0, 5, 5, 5},
		{"zone only keeps its attempt", true, 6, 2, 0, 6, 2},
	}
	for _, c := range cases {
		score, compRoute, competition := newScoreContext("boulder", "dynamic", c.zone, 0)
		score.Set("attempts", c.attempts)
		score.Set("zone_attempt", c.zoneAttempt)
		score.Set("top_attempt", c.topAttempt)
		score.Set("height", 12)
		normalizeScore(score, compRoute, competition)
		if score.GetInt("attempts") != c.wantAttempts || score.GetInt("zone_attempt") != c.wantZone || score.GetInt("height") != 0 {
			t.Errorf("%s: got %v", c.name, score.PublicExport())
		}
	}
}

func TestNormalizeRouteCollectionScore(t *testing.T) {
	score, compRoute, competition := newScoreContext("rope", "route_points", false, 0)
	score.Set("top_attempt", 2)
	score.Set("zone_attempt", 1)
	score.Set("style", "")
	normalizeScore(score, compRoute, competition)
	if score.GetString("style") != "lead" || score.GetInt("attempts") != 2 || score.GetInt("zone_attempt") != 0 {
		t.Errorf("route collection score not normalised: %v", score.PublicExport())
	}

	score.Set("style", "toprope")
	normalizeScore(score, compRoute, competition)
	if score.GetString("style") != "toprope" {
		t.Error("toprope style dropped")
	}
}

func TestNormalizeLeadHeightScore(t *testing.T) {
	score, compRoute, competition := newScoreContext("rope", "lead_height", false, 40)
	score.Set("height", 55)
	score.Set("height_plus", true)
	normalizeScore(score, compRoute, competition)
	if score.GetInt("height") != 40 || score.GetBool("height_plus") || score.GetInt("top_attempt") != 1 {
		t.Errorf("top not derived from hold count: %v", score.PublicExport())
	}

	score.Set("height", 23)
	score.Set("height_plus", true)
	normalizeScore(score, compRoute, competition)
	if score.GetInt("height") != 23 || !score.GetBool("height_plus") || score.GetInt("top_attempt") != 0 {
		t.Errorf("partial height not kept: %v", score.PublicExport())
	}
}

func TestValidateCompetitionFormat(t *testing.T) {
	competition := newCompetitionRecord("competitions", nil, []string{"discipline", "scoring_format"})
	cases := []struct {
		discipline, format string
		valid              bool
	}{
		{"boulder", "ifsc", true},
		{"boulder", "lead_height", false},
		{"rope", "route_points", true},
		{"rope", "dynamic", true},
		{"rope", "tops", false},
		{"", "dynamic", false},
	}
	for _, c := range cases {
		competition.Set("discipline", c.discipline)
		competition.Set("scoring_format", c.format)
		if got := validateCompetitionFormat(competition) == nil; got != c.valid {
			t.Errorf("%s/%s valid = %v, want %v", c.discipline, c.format, got, c.valid)
		}
	}
}

func TestNeedsGuardianConsent(t *testing.T) {
	if !needsGuardianConsent(2011, 2026) {
		t.Error("15-year-old does not need consent")
	}
	if needsGuardianConsent(2010, 2026) {
		t.Error("16-year-old needs consent")
	}
}

func TestCategoryFits(t *testing.T) {
	youth := newCompetitionRecord("competition_categories", []string{"min_birth_year", "max_birth_year"}, nil)
	youth.Set("min_birth_year", 2010)
	youth.Set("max_birth_year", 2013)
	if !categoryFits(youth, 2012) || categoryFits(youth, 2009) || categoryFits(youth, 2014) {
		t.Error("birth year range not applied")
	}
	open := newCompetitionRecord("competition_categories", []string{"min_birth_year", "max_birth_year"}, nil)
	if !categoryFits(open, 1950) {
		t.Error("open category rejected a climber")
	}
}

func TestOwnerEntryStatus(t *testing.T) {
	cases := []struct {
		current, requested string
		open               bool
		want               string
	}{
		{"registered", "withdrawn", true, "withdrawn"},
		{"checked_in", "withdrawn", false, "withdrawn"},
		{"withdrawn", "registered", true, "registered"},
		{"withdrawn", "registered", false, "withdrawn"},
		{"registered", "checked_in", true, "registered"},
		{"disqualified", "withdrawn", true, "disqualified"},
		{"disqualified", "registered", true, "disqualified"},
	}
	for _, c := range cases {
		if got := ownerEntryStatus(c.current, c.requested, c.open); got != c.want {
			t.Errorf("%s -> %s (open %v) = %s, want %s", c.current, c.requested, c.open, got, c.want)
		}
	}
}

func TestStampFreezeAt(t *testing.T) {
	competition := newCompetitionRecord("competitions", []string{"freeze_minutes"}, nil)
	competition.Collection().Fields.Add(&core.BoolField{Name: "live_ranking"})
	competition.Collection().Fields.Add(&core.DateField{Name: "freeze_at"})
	competition.Set("ends_at", "2026-10-10 14:00:00.000Z")
	competition.Set("live_ranking", true)
	competition.Set("freeze_minutes", 15)

	stampFreezeAt(competition)
	if got := competition.GetDateTime("freeze_at").String(); got != "2026-10-10 13:45:00.000Z" {
		t.Errorf("freeze_at = %q", got)
	}

	competition.Set("live_ranking", false)
	stampFreezeAt(competition)
	if !competition.GetDateTime("freeze_at").IsZero() {
		t.Error("freeze_at kept without live ranking")
	}
}

func TestCompetitionTickFields(t *testing.T) {
	if competitionTickType(1) != "flash" || competitionTickType(3) != "top" {
		t.Error("tick type not derived from the top attempt")
	}
	now := time.Date(2026, 10, 3, 9, 0, 0, 0, time.UTC)
	if got := competitionTickDate(time.Date(2026, 10, 2, 21, 0, 0, 0, time.UTC), now); got != "2026-10-02 12:00:00.000Z" {
		t.Errorf("past competition date = %s", got)
	}
	if got := competitionTickDate(time.Date(2026, 10, 9, 21, 0, 0, 0, time.UTC), now); got != "2026-10-03 12:00:00.000Z" {
		t.Errorf("future end not clamped to today: %s", got)
	}
}

func saveCompetition(t *testing.T, app core.App, gymID string) (*core.Record, *core.Record) {
	t.Helper()
	hall := saveRecord(t, app, "locations", map[string]any{"name": "Hall", "gym": gymID})
	competition := saveRecord(t, app, "competitions", map[string]any{
		"name": "Jam", "location": hall.Id, "status": "open", "discipline": "boulder", "scoring_format": "dynamic",
		"starts_at": time.Now().Add(-time.Hour), "ends_at": time.Now().Add(time.Hour),
	})
	return competition, hall
}

func TestCompetitionRouteMustShareTheGym(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()

	competition, hall := saveCompetition(t, f.app, f.gymA.Id)
	otherHall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymB.Id})
	own := saveRecord(t, f.app, "routes", map[string]any{"name": "Own", "grade": "6a", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id})
	foreign := saveRecord(t, f.app, "routes", map[string]any{"name": "Foreign", "grade": "6a", "type": "Boulder", "creator": []string{"S"}, "location": otherHall.Id})

	compRoutes, err := f.app.FindCollectionByNameOrId("competition_routes")
	if err != nil {
		t.Fatal(err)
	}
	compRoute := core.NewRecord(compRoutes)
	compRoute.Set("competition", competition.Id)
	compRoute.Set("route", own.Id)
	if err := validateCompetitionRoute(f.app, compRoute); err != nil {
		t.Errorf("own route rejected: %v", err)
	}
	compRoute.Set("route", foreign.Id)
	if validateCompetitionRoute(f.app, compRoute) == nil {
		t.Error("route of another gym accepted")
	}
}

func TestEntryManagerComesFromTheStoredCompetition(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()

	competitionA, _ := saveCompetition(t, f.app, f.gymA.Id)
	competitionB, _ := saveCompetition(t, f.app, f.gymB.Id)
	categoryA := saveRecord(t, f.app, "competition_categories", map[string]any{"name": "Open", "competition": competitionA.Id})
	categoryB := saveRecord(t, f.app, "competition_categories", map[string]any{"name": "Open", "competition": competitionB.Id})
	entry := saveRecord(t, f.app, "competition_entries", map[string]any{
		"competition": competitionA.Id, "category": categoryA.Id, "user": f.setterB.Id,
		"display_name": "B", "birth_year": 1990, "status": "registered", "bib": 1,
	})
	token, err := f.setterB.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	scenario := tests.ApiScenario{
		Method:          http.MethodPatch,
		URL:             "/api/collections/competition_entries/records/" + entry.Id,
		Body:            strings.NewReader(`{"competition":"` + competitionB.Id + `","category":"` + categoryB.Id + `","paid":true}`),
		Headers:         map[string]string{"Authorization": token},
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{"Category is not part of this competition."},
		TestAppFactory:  func(testing.TB) *tests.TestApp { return f.app },
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			stored, err := app.FindRecordById("competition_entries", entry.Id)
			if err != nil {
				t.Fatal(err)
			}
			if stored.GetString("competition") != competitionA.Id || stored.GetBool("paid") {
				t.Errorf("entry changed to %v", stored.PublicExport())
			}
		},
	}
	scenario.Test(t)
}

func TestAuditGym(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()

	competition, hall := saveCompetition(t, f.app, f.gymA.Id)
	category := saveRecord(t, f.app, "competition_categories", map[string]any{"name": "Open", "competition": competition.Id})
	membership, err := f.app.FindFirstRecordByFilter("memberships", "user = {:user}", dbx.Params{"user": f.adminA.Id})
	if err != nil {
		t.Fatal(err)
	}
	for _, record := range []*core.Record{f.gymA, hall, competition, category, membership} {
		if got := auditGym(f.app, record); got != f.gymA.Id {
			t.Errorf("auditGym(%s) = %q", record.Collection().Name, got)
		}
	}
}
