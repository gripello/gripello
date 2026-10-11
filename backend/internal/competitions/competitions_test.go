package competitions

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform"
	"gripello/internal/platform/events"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/testapp"
)

func at(value string) time.Time {
	parsed, _ := time.Parse(time.RFC3339, value)
	return parsed
}

func TestAcceptsScores(t *testing.T) {
	c := Competition{Status: "open", StartsAt: at("2026-10-10T10:00:00Z"), EndsAt: at("2026-10-10T14:00:00Z")}
	if !acceptsScores(c, at("2026-10-10T12:00:00Z")) {
		t.Error("score inside the window rejected")
	}
	if acceptsScores(c, at("2026-10-10T09:59:00Z")) || acceptsScores(c, at("2026-10-10T14:01:00Z")) {
		t.Error("score outside the window accepted")
	}
	c.Status = "closed"
	if acceptsScores(c, at("2026-10-10T12:00:00Z")) {
		t.Error("score on a closed competition accepted")
	}
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
		s := Score{Attempts: c.attempts, ZoneAttempt: c.zoneAttempt, TopAttempt: c.topAttempt, Height: 12}
		normalizeScore(&s, CompRoute{Zone: c.zone}, Competition{Discipline: "boulder", ScoringFormat: "dynamic"})
		if s.Attempts != c.wantAttempts || s.ZoneAttempt != c.wantZone || s.Height != 0 {
			t.Errorf("%s: got %+v", c.name, s)
		}
	}
}

func TestNormalizeRouteCollectionScore(t *testing.T) {
	c := Competition{Discipline: "rope", ScoringFormat: "route_points"}
	s := Score{TopAttempt: 2, ZoneAttempt: 1}
	normalizeScore(&s, CompRoute{}, c)
	if s.Style != "lead" || s.Attempts != 2 || s.ZoneAttempt != 0 {
		t.Errorf("route collection score not normalised: %+v", s)
	}
	s.Style = "toprope"
	normalizeScore(&s, CompRoute{}, c)
	if s.Style != "toprope" {
		t.Error("toprope style dropped")
	}
}

func TestNormalizeLeadHeightScore(t *testing.T) {
	c := Competition{Discipline: "rope", ScoringFormat: "lead_height"}
	s := Score{Height: 55, HeightPlus: true}
	normalizeScore(&s, CompRoute{HoldCount: 40}, c)
	if s.Height != 40 || s.HeightPlus || s.TopAttempt != 1 {
		t.Errorf("top not derived from hold count: %+v", s)
	}
	s.Height, s.HeightPlus = 23, true
	normalizeScore(&s, CompRoute{HoldCount: 40}, c)
	if s.Height != 23 || !s.HeightPlus || s.TopAttempt != 0 {
		t.Errorf("partial height not kept: %+v", s)
	}
}

func TestValidateCompetitionFormat(t *testing.T) {
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
		if got := validateCompetitionFormat(Competition{Discipline: c.discipline, ScoringFormat: c.format}) == nil; got != c.valid {
			t.Errorf("%s/%s valid = %v, want %v", c.discipline, c.format, got, c.valid)
		}
	}
}

func TestValidateScoring(t *testing.T) {
	for _, valid := range []string{``, `null`, `{}`, `{"topPool":1000,"zonePool":0,"bestOf":null,"flashBonus":10,"topropeFactor":0.5}`,
		`{"attemptFactors":[1,0.9,0.8],"bestOf":5}`} {
		if err := validateScoring(json.RawMessage(valid)); err != nil {
			t.Errorf("%s rejected: %v", valid, err)
		}
	}
	for _, broken := range []string{`[]`, `"x"`, `{"format":"ifsc"}`, `{"topPool":0}`, `{"flashBonus":101}`,
		`{"topropeFactor":2}`, `{"bestOf":1.5}`, `{"attemptFactors":[-1]}`, `{"topPool":"many"}`} {
		if validateScoring(json.RawMessage(broken)) == nil {
			t.Errorf("%s accepted", broken)
		}
	}
}

func TestNeedsGuardianConsent(t *testing.T) {
	if !needsGuardianConsent(2011, 2026) || needsGuardianConsent(2010, 2026) {
		t.Error("consent age not 16")
	}
}

func TestCategoryFits(t *testing.T) {
	youth := Category{MinBirthYear: 2010, MaxBirthYear: 2013}
	if !categoryFits(youth, 2012) || categoryFits(youth, 2009) || categoryFits(youth, 2014) {
		t.Error("birth year range not applied")
	}
	if !categoryFits(Category{}, 1950) {
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
	c := Competition{EndsAt: at("2026-10-10T14:00:00Z"), LiveRanking: true, FreezeMinutes: 15}
	stampFreezeAt(&c)
	if c.FreezeAt == nil || !c.FreezeAt.Equal(at("2026-10-10T13:45:00Z")) {
		t.Errorf("freeze_at = %v", c.FreezeAt)
	}
	c.LiveRanking = false
	stampFreezeAt(&c)
	if c.FreezeAt != nil {
		t.Error("freeze_at kept without live ranking")
	}
}

func TestCompetitionTickFields(t *testing.T) {
	if competitionTickType(1) != "flash" || competitionTickType(3) != "top" {
		t.Error("tick type not derived from the top attempt")
	}
	now := at("2026-10-03T09:00:00Z")
	if got := competitionTickDate(at("2026-10-02T21:00:00Z"), now); !got.Equal(at("2026-10-02T12:00:00Z")) {
		t.Errorf("past competition date = %s", got)
	}
	if got := competitionTickDate(at("2026-10-09T21:00:00Z"), now); !got.Equal(at("2026-10-03T12:00:00Z")) {
		t.Errorf("future end not clamped to today: %s", got)
	}
}

func TestResultsVisibility(t *testing.T) {
	past := time.Now().Add(-time.Minute)
	for _, c := range []struct {
		competition Competition
		want        string
	}{
		{Competition{Status: "published"}, "final"},
		{Competition{Status: "draft", LiveRanking: true}, "hidden"},
		{Competition{Status: "open"}, "hidden"},
		{Competition{Status: "open", LiveRanking: true}, "live"},
		{Competition{Status: "open", LiveRanking: true, FreezeAt: &past}, "frozen"},
	} {
		if got := resultsVisibility(c.competition, time.Now()); got != c.want {
			t.Errorf("%+v = %s, want %s", c.competition, got, c.want)
		}
	}
}

type fixture struct {
	t        *testing.T
	app      *platform.App
	handler  http.Handler
	gymA     string
	gymB     string
	hall     string
	hallB    string
	boulder  string
	boulder2 string
	rope     string
	foreign  string
	users    map[string]string
	tokens   map[string]string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	app := testapp.App(t)
	Register(app)
	f := &fixture{t: t, app: app, handler: testapp.Handler(app), users: map[string]string{}, tokens: map[string]string{}}
	f.gymA = f.exec(`INSERT INTO gyms (id, slug, name, active) VALUES ($1, 'alpha', 'Alpha', true) RETURNING id`, ids.New())
	f.gymB = f.exec(`INSERT INTO gyms (id, slug, name, active) VALUES ($1, 'beta', 'Beta', true) RETURNING id`, ids.New())
	f.user("manager", f.gymA, permManage)
	f.user("judge", f.gymA, permJudge)
	f.user("managerB", f.gymB, permManage)
	f.user("climber", "")
	f.user("other", "")
	f.hall = f.exec(`INSERT INTO locations (id, gym, name) VALUES ($1, $2, 'Hall') RETURNING id`, ids.New(), f.gymA)
	f.hallB = f.exec(`INSERT INTO locations (id, gym, name) VALUES ($1, $2, 'Hall') RETURNING id`, ids.New(), f.gymB)
	f.boulder = f.route(f.gymA, f.hall, "Boulder")
	f.boulder2 = f.route(f.gymA, f.hall, "Boulder")
	f.rope = f.route(f.gymA, f.hall, "Route")
	f.foreign = f.route(f.gymB, f.hallB, "Boulder")
	return f
}

func (f *fixture) exec(sql string, args ...any) string {
	f.t.Helper()
	var id string
	if err := f.app.DB.QueryRow(context.Background(), sql, args...).Scan(&id); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return id
}

func (f *fixture) user(name, gym string, permissions ...string) {
	f.t.Helper()
	id := f.exec(`INSERT INTO users (id, username, firstname, email, token_key) VALUES ($1, $2, $2, $3, $4) RETURNING id`,
		ids.New(), name, name+"@example.com", "key-"+name)
	if gym != "" {
		role := f.exec(`INSERT INTO roles (id, gym, name, permissions) VALUES ($1, $2, $3, $4) RETURNING id`, ids.New(), gym, name, permissions)
		f.exec(`INSERT INTO memberships (id, "user", gym, role) VALUES ($1, $2, $3, $4) RETURNING id`, ids.New(), id, gym, role)
	}
	token, err := f.app.Tokens.Sign(id, "key-"+name, "")
	if err != nil {
		f.t.Fatal(err)
	}
	f.users[name], f.tokens[name] = id, token
}

func (f *fixture) route(gym, location, kind string) string {
	return f.exec(`INSERT INTO routes (id, gym, name, grade, grade_system, grade_index, type, location)
		VALUES ($1, $2, 'Crimp', '6a', 'font', 12, $3, $4) RETURNING id`, ids.New(), gym, kind, location)
}

func (f *fixture) call(user, method, path, body string, status int) map[string]any {
	f.t.Helper()
	request := httptest.NewRequest(method, "/api"+path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if user != "" {
		request.Header.Set("Authorization", f.tokens[user])
	}
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, request)
	if recorder.Code != status {
		f.t.Fatalf("%s %s as %q = %d, want %d: %s", method, path, user, recorder.Code, status, recorder.Body.String())
	}
	out := map[string]any{}
	json.Unmarshal(recorder.Body.Bytes(), &out)
	return out
}

func items(body map[string]any) []any {
	list, _ := body["items"].([]any)
	return list
}

func window() (string, string) {
	return time.Now().Add(-time.Hour).UTC().Format(time.RFC3339), time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
}

// competition creates an open boulder competition with one category and two routes, returning its ids.
func (f *fixture) competition(extra string) (id, category, route1, route2 string) {
	f.t.Helper()
	starts, ends := window()
	body := `{"name":"Jam","location":"` + f.hall + `","discipline":"boulder","scoring_format":"dynamic",
		"starts_at":"` + starts + `","ends_at":"` + ends + `"` + extra + `}`
	id = f.call("manager", "POST", "/gyms/alpha/competitions", body, http.StatusCreated)["id"].(string)
	category = f.call("manager", "POST", "/competitions/"+id+"/categories", `{"name":"Open"}`, http.StatusCreated)["id"].(string)
	route1 = f.call("manager", "POST", "/competitions/"+id+"/routes", `{"route":"`+f.boulder+`","number":1,"zone":true}`, http.StatusCreated)["id"].(string)
	route2 = f.call("manager", "POST", "/competitions/"+id+"/routes", `{"route":"`+f.boulder2+`","number":2}`, http.StatusCreated)["id"].(string)
	f.call("manager", "PATCH", "/competitions/"+id, `{"status":"open"}`, http.StatusOK)
	return
}

func (f *fixture) register(user, competition, category, extra string) string {
	f.t.Helper()
	return f.call(user, "POST", "/competitions/"+competition+"/entries",
		`{"category":"`+category+`","display_name":"`+user+`","birth_year":1990`+extra+`}`, http.StatusCreated)["id"].(string)
}

type eventRow struct {
	Topic    string
	Kind     string
	Payload  json.RawMessage
	Audience events.Audience
	Actor    string
}

func (f *fixture) events(topic string) []eventRow {
	f.t.Helper()
	rows, err := f.app.DB.Query(context.Background(), `SELECT topic, kind, payload, audience, actor FROM events WHERE topic = $1 ORDER BY id`, topic)
	if err != nil {
		f.t.Fatal(err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (eventRow, error) {
		var e eventRow
		var audience []byte
		err := row.Scan(&e.Topic, &e.Kind, &e.Payload, &audience, &e.Actor)
		json.Unmarshal(audience, &e.Audience)
		return e, err
	})
	if err != nil {
		f.t.Fatal(err)
	}
	return out
}

func TestCompetitionLifecycleAndVisibility(t *testing.T) {
	f := newFixture(t)
	starts, ends := window()
	base := `"location":"` + f.hall + `","discipline":"boulder","scoring_format":"dynamic","starts_at":"` + starts + `","ends_at":"` + ends + `"`
	f.call("climber", "POST", "/gyms/alpha/competitions", `{"name":"Jam",`+base+`}`, http.StatusForbidden)
	f.call("manager", "POST", "/gyms/alpha/competitions", `{"name":"Jam","location":"`+f.hallB+`","discipline":"boulder","scoring_format":"dynamic","starts_at":"`+starts+`","ends_at":"`+ends+`"}`, http.StatusBadRequest)
	f.call("manager", "POST", "/gyms/alpha/competitions", `{"name":"Jam",`+base+`,"scoring_format":"lead_height"}`, http.StatusBadRequest)
	created := f.call("manager", "POST", "/gyms/alpha/competitions", `{"name":"Jam",`+base+`,"live_ranking":true,"freeze_minutes":30,"gym":"`+f.gymB+`"}`, http.StatusCreated)
	id := created["id"].(string)
	if created["status"] != "draft" || created["gym"] != f.gymA || created["freeze_at"] == nil {
		t.Fatalf("created = %v", created)
	}
	f.call("", "GET", "/competitions/"+id, "", http.StatusNotFound)
	f.call("judge", "GET", "/competitions/"+id+"/categories", "", http.StatusNotFound)
	if got := items(f.call("climber", "GET", "/gyms/alpha/competitions", "", http.StatusOK)); len(got) != 0 {
		t.Errorf("draft listed for a climber: %v", got)
	}
	if got := items(f.call("manager", "GET", "/gyms/alpha/competitions?include=location", "", http.StatusOK)); len(got) != 1 ||
		got[0].(map[string]any)["expand"].(map[string]any)["location"].(map[string]any)["name"] != "Hall" {
		t.Errorf("manager list = %v", got)
	}
	f.call("managerB", "PATCH", "/competitions/"+id, `{"status":"open"}`, http.StatusNotFound)
	f.call("manager", "PATCH", "/competitions/"+id, `{"location":"`+f.hallB+`"}`, http.StatusBadRequest)
	f.call("manager", "PATCH", "/competitions/"+id, `{"status":"open","live_ranking":false}`, http.StatusOK)
	got := f.call("", "GET", "/competitions/"+id, "", http.StatusOK)
	if got["freeze_at"] != nil {
		t.Errorf("freeze_at kept after live ranking off: %v", got)
	}
	if got := items(f.call("", "GET", "/gyms/alpha/competitions?status=open,closed", "", http.StatusOK)); len(got) != 1 {
		t.Errorf("open competitions = %v", got)
	}
	later := f.call("manager", "POST", "/gyms/alpha/competitions", `{"name":"Later",`+strings.Replace(base, starts, time.Now().Add(30*time.Minute).UTC().Format(time.RFC3339), 1)+`,"status":"open"}`, http.StatusCreated)["id"].(string)
	if got := items(f.call("", "GET", "/gyms/alpha/competitions?sort=-starts_at", "", http.StatusOK)); len(got) != 2 || got[0].(map[string]any)["id"] != later {
		t.Errorf("newest first = %v", got)
	}
	if got := items(f.call("", "GET", "/gyms/alpha/competitions", "", http.StatusOK)); got[0].(map[string]any)["id"] != id {
		t.Errorf("default order = %v", got)
	}
	f.call("", "GET", "/gyms/alpha/competitions?sort=name", "", http.StatusBadRequest)
	expanded := f.call("", "GET", "/competitions/"+id+"?include=location", "", http.StatusOK)
	if location, _ := expanded["expand"].(map[string]any)["location"].(map[string]any); location["name"] != "Hall" {
		t.Errorf("get with include = %v", expanded)
	}
	patched := f.call("manager", "PATCH", "/competitions/"+id+"?include=location", `{"name":"Jam 2"}`, http.StatusOK)
	if location, _ := patched["expand"].(map[string]any)["location"].(map[string]any); location["name"] != "Hall" {
		t.Errorf("patch with include = %v", patched)
	}
}

func TestCompetitionRouteMustFitGymAndDiscipline(t *testing.T) {
	f := newFixture(t)
	id, _, route1, _ := f.competition("")
	f.call("manager", "POST", "/competitions/"+id+"/routes", `{"route":"`+f.foreign+`","number":3}`, http.StatusBadRequest)
	f.call("manager", "POST", "/competitions/"+id+"/routes", `{"route":"`+f.rope+`","number":3}`, http.StatusBadRequest)
	f.call("manager", "POST", "/competitions/"+id+"/routes", `{"route":"`+f.boulder+`","number":3}`, http.StatusBadRequest)
	f.call("judge", "PATCH", "/competition-routes/"+route1, `{"points":5}`, http.StatusForbidden)
	updated := f.call("manager", "PATCH", "/competition-routes/"+route1, `{"hold_count":30,"points":5}`, http.StatusOK)
	if route, _ := updated["expand"].(map[string]any)["route"].(map[string]any); route["name"] != "Crimp" {
		t.Errorf("patched route not expanded: %v", updated)
	}
	if updated["hold_count"] != 0.0 || updated["points"] != 5.0 {
		t.Errorf("boulder route kept a hold count: %v", updated)
	}
	other, _, _, _ := f.competition("")
	f.call("manager", "PATCH", "/competition-routes/"+route1, `{"competition":"`+other+`"}`, http.StatusBadRequest)
	listed := items(f.call("", "GET", "/competitions/"+id+"/routes", "", http.StatusOK))
	if len(listed) != 2 || listed[0].(map[string]any)["expand"].(map[string]any)["route"].(map[string]any)["name"] != "Crimp" {
		t.Errorf("routes = %v", listed)
	}
}

func TestRegistration(t *testing.T) {
	f := newFixture(t)
	id, category, _, _ := f.competition("")
	entry := f.call("climber", "POST", "/competitions/"+id+"/entries",
		`{"category":"`+category+`","display_name":"C","birth_year":1990,"user":"`+f.users["other"]+`","paid":true,"bib":40,"status":"checked_in"}`,
		http.StatusCreated)
	if entry["user"] != f.users["climber"] || entry["paid"] != false || entry["bib"] != 1.0 || entry["status"] != "registered" {
		t.Errorf("climber set staff fields: %v", entry)
	}
	f.call("climber", "POST", "/competitions/"+id+"/entries", `{"category":"`+category+`","display_name":"C","birth_year":1990}`, http.StatusBadRequest)
	f.call("other", "POST", "/competitions/"+id+"/entries", `{"category":"`+category+`","display_name":"Kid","birth_year":2015}`, http.StatusBadRequest)
	staffEntry := f.call("manager", "POST", "/competitions/"+id+"/entries",
		`{"category":"`+category+`","display_name":"O","birth_year":1990,"user":"`+f.users["other"]+`","bib":7,"paid":true}`, http.StatusCreated)
	if staffEntry["user"] != f.users["other"] || staffEntry["bib"] != 7.0 || staffEntry["paid"] != true {
		t.Errorf("manager registration = %v", staffEntry)
	}
	if got := f.events(TopicEntryCreated); len(got) != 2 {
		t.Errorf("entry.created events = %d", len(got))
	}
	f.call("manager", "PATCH", "/competitions/"+id, `{"status":"closed"}`, http.StatusOK)
	f.call("judge", "POST", "/competitions/"+id+"/entries", `{"category":"`+category+`","display_name":"J","birth_year":1990}`, http.StatusBadRequest)
}

func TestOwnerCannotMoveOrPayTheirEntry(t *testing.T) {
	f := newFixture(t)
	idA, categoryA, _, _ := f.competition("")
	_, categoryB, _, _ := f.competition("")
	entry := f.register("climber", idA, categoryA, "")
	f.call("climber", "PATCH", "/competition-entries/"+entry, `{"competition":"x","category":"`+categoryB+`","paid":true}`, http.StatusBadRequest)
	stored, err := findEntry(context.Background(), f.app.DB, entry)
	if err != nil || stored.Competition != idA || stored.Paid || stored.Category != categoryA {
		t.Errorf("entry changed to %+v (%v)", stored, err)
	}
	updated := f.call("climber", "PATCH", "/competition-entries/"+entry, `{"status":"checked_in","paid":true,"hidden":true}`, http.StatusOK)
	if updated["status"] != "registered" || updated["paid"] != false || updated["hidden"] != true {
		t.Errorf("owner update = %v", updated)
	}
	f.call("other", "PATCH", "/competition-entries/"+entry, `{"hidden":false}`, http.StatusNotFound)
	f.call("manager", "PATCH", "/competition-entries/"+entry, `{"paid":true,"status":"checked_in"}`, http.StatusOK)
}

func TestEntryVisibility(t *testing.T) {
	f := newFixture(t)
	id, category, _, _ := f.competition("")
	f.register("climber", id, category, `,"hidden":true`)
	f.register("other", id, category, "")
	others := items(f.call("other", "GET", "/competitions/"+id+"/entries", "", http.StatusOK))
	if len(others) != 1 || others[0].(map[string]any)["birth_year"] != 1990.0 {
		t.Errorf("other sees %v", others)
	}
	guest := items(f.call("", "GET", "/competitions/"+id+"/entries", "", http.StatusOK))
	if len(guest) != 1 || guest[0].(map[string]any)["birth_year"] != 0.0 {
		t.Errorf("guest sees %v", guest)
	}
	if got := items(f.call("judge", "GET", "/competitions/"+id+"/entries", "", http.StatusOK)); len(got) != 2 ||
		got[0].(map[string]any)["expand"].(map[string]any)["category"].(map[string]any)["name"] != "Open" {
		t.Errorf("judge sees %v", got)
	}
	standings := f.call("", "GET", "/competitions/"+id+"/standings", "", http.StatusOK)
	if len(items(standings)) != 2 || items(standings)[0].(map[string]any)["display_name"] != "" {
		t.Errorf("standings = %v", standings)
	}
}

func TestScoring(t *testing.T) {
	f := newFixture(t)
	id, category, route1, route2 := f.competition("")
	mine := f.register("climber", id, category, "")
	theirs := f.register("other", id, category, "")
	saved := items(f.call("climber", "PUT", "/competitions/"+id+"/scores",
		`{"scores":[{"entry":"`+mine+`","comp_route":"`+route1+`","attempts":1,"top_attempt":3,"height":9}]}`, http.StatusOK))
	if len(saved) != 1 || saved[0].(map[string]any)["attempts"] != 3.0 || saved[0].(map[string]any)["zone_attempt"] != 3.0 {
		t.Errorf("score not normalised: %v", saved)
	}
	f.call("climber", "PUT", "/competitions/"+id+"/scores", `{"scores":[{"entry":"`+mine+`","comp_route":"`+route1+`","attempts":4,"top_attempt":1}]}`, http.StatusOK)
	f.call("climber", "PUT", "/competitions/"+id+"/scores", `{"scores":[{"entry":"`+theirs+`","comp_route":"`+route1+`","top_attempt":1}]}`, http.StatusForbidden)
	f.call("judge", "PUT", "/competitions/"+id+"/scores", `{"scores":[{"entry":"`+theirs+`","comp_route":"`+route2+`","top_attempt":2}]}`, http.StatusOK)
	otherComp, _, foreignRoute, _ := f.competition("")
	f.call("judge", "PUT", "/competitions/"+id+"/scores", `{"scores":[{"entry":"`+theirs+`","comp_route":"`+foreignRoute+`","top_attempt":2}]}`, http.StatusBadRequest)
	_ = otherComp

	if got := items(f.call("climber", "GET", "/competitions/"+id+"/scores", "", http.StatusOK)); len(got) != 1 {
		t.Errorf("climber sees %d scores without live ranking", len(got))
	}
	if got := items(f.call("judge", "GET", "/competitions/"+id+"/scores", "", http.StatusOK)); len(got) != 2 {
		t.Errorf("judge sees %d scores", len(got))
	}
	f.call("manager", "PATCH", "/competition-routes/"+route2, `{"voided":true}`, http.StatusOK)
	f.call("climber", "PUT", "/competitions/"+id+"/scores", `{"scores":[{"entry":"`+mine+`","comp_route":"`+route2+`","top_attempt":1}]}`, http.StatusBadRequest)
	f.call("manager", "PATCH", "/competitions/"+id, `{"live_ranking":true}`, http.StatusOK)
	if got := items(f.call("", "GET", "/competitions/"+id+"/scores", "", http.StatusOK)); len(got) != 2 {
		t.Errorf("guest sees %d scores with live ranking", len(got))
	}
	f.call("manager", "PATCH", "/competitions/"+id, `{"status":"closed"}`, http.StatusOK)
	f.call("climber", "PUT", "/competitions/"+id+"/scores", `{"scores":[{"entry":"`+mine+`","comp_route":"`+route1+`","top_attempt":1}]}`, http.StatusBadRequest)
	f.call("climber", "DELETE", "/competition-scores/"+saved[0].(map[string]any)["id"].(string), "", http.StatusForbidden)
	f.call("manager", "DELETE", "/competition-scores/"+saved[0].(map[string]any)["id"].(string), "", http.StatusNoContent)
}

func TestJudgeOnlyFormat(t *testing.T) {
	f := newFixture(t)
	starts, ends := window()
	id := f.call("manager", "POST", "/gyms/alpha/competitions", `{"name":"Lead","location":"`+f.hall+`","discipline":"rope",
		"scoring_format":"lead_height","status":"open","starts_at":"`+starts+`","ends_at":"`+ends+`"}`, http.StatusCreated)["id"].(string)
	category := f.call("manager", "POST", "/competitions/"+id+"/categories", `{"name":"Open"}`, http.StatusCreated)["id"].(string)
	route := f.call("manager", "POST", "/competitions/"+id+"/routes", `{"route":"`+f.rope+`","number":1,"hold_count":40,"zone":true}`, http.StatusCreated)
	if route["zone"] != false {
		t.Errorf("rope route kept a zone: %v", route)
	}
	entry := f.register("climber", id, category, "")
	body := `{"scores":[{"entry":"` + entry + `","comp_route":"` + route["id"].(string) + `","height":45}]}`
	f.call("climber", "PUT", "/competitions/"+id+"/scores", body, http.StatusForbidden)
	saved := items(f.call("judge", "PUT", "/competitions/"+id+"/scores", body, http.StatusOK))
	if saved[0].(map[string]any)["top_attempt"] != 1.0 || saved[0].(map[string]any)["height"] != 40.0 {
		t.Errorf("lead height = %v", saved)
	}
}

func TestPublishCopiesTopsToTheLogbook(t *testing.T) {
	f := newFixture(t)
	id, category, route1, route2 := f.competition("")
	mine := f.register("climber", id, category, "")
	withdrawn := f.register("other", id, category, "")
	f.call("judge", "PUT", "/competitions/"+id+"/scores", `{"scores":[
		{"entry":"`+mine+`","comp_route":"`+route1+`","top_attempt":1},
		{"entry":"`+mine+`","comp_route":"`+route2+`","attempts":2,"zone_attempt":0}]}`, http.StatusOK)
	f.call("other", "PATCH", "/competition-entries/"+withdrawn, `{"status":"withdrawn"}`, http.StatusOK)
	f.call("judge", "POST", "/competitions/"+id+"/publish", "", http.StatusForbidden)
	f.call("manager", "POST", "/competitions/"+id+"/publish", "", http.StatusOK)

	var count int
	var kind, note, grade string
	f.app.DB.QueryRow(context.Background(), `SELECT COUNT(*), MIN(type), MIN(note), MIN(grade) FROM ticks WHERE "user" = $1`, f.users["climber"]).
		Scan(&count, &kind, &note, &grade)
	if count != 1 || kind != "flash" || note != "Jam" || grade != "6a" {
		t.Errorf("ticks = %d %s %s %s", count, kind, note, grade)
	}
	if got := f.events(TopicOwnTicks); len(got) != 1 || got[0].Audience.Users[0] != f.users["climber"] {
		t.Errorf("own_ticks events = %v", got)
	}
	if got := f.events(TopicTickChanged); len(got) != 1 {
		t.Errorf("tick.changed events = %v", got)
	}
	notes := f.events(TopicNotify)
	var n Notify
	if len(notes) != 1 || json.Unmarshal(notes[0].Payload, &n) != nil || len(n.Users) != 1 || n.Users[0] != f.users["climber"] ||
		n.Type != "competition_published" || n.URL != "/alpha/competitions/"+id || n.Params["competition"] != "Jam" {
		t.Errorf("notify = %+v", notes)
	}

	f.call("manager", "PATCH", "/competitions/"+id, `{"status":"closed"}`, http.StatusOK)
	f.call("manager", "POST", "/competitions/"+id+"/publish", "", http.StatusOK)
	f.app.DB.QueryRow(context.Background(), `SELECT COUNT(*) FROM ticks`).Scan(&count)
	if count != 1 {
		t.Errorf("republishing duplicated ticks: %d", count)
	}

	results := f.call("", "GET", "/competitions/"+id+"/results", "", http.StatusOK)
	if results["visibility"] != "final" || len(results["scores"].([]any)) != 2 || len(results["entries"].([]any)) != 1 {
		t.Errorf("results = %v", results)
	}
}

func TestResultsAreHiddenWithoutLiveRanking(t *testing.T) {
	f := newFixture(t)
	id, category, route1, _ := f.competition("")
	entry := f.register("climber", id, category, "")
	f.call("judge", "PUT", "/competitions/"+id+"/scores", `{"scores":[{"entry":"`+entry+`","comp_route":"`+route1+`","top_attempt":1}]}`, http.StatusOK)
	if got := f.call("", "GET", "/competitions/"+id+"/results", "", http.StatusOK); got["visibility"] != "hidden" || len(got["scores"].([]any)) != 0 {
		t.Errorf("guest results = %v", got)
	}
	if got := f.call("manager", "GET", "/competitions/"+id+"/results", "", http.StatusOK); got["visibility"] != "live" || len(got["scores"].([]any)) != 1 {
		t.Errorf("manager results = %v", got)
	}
}

func TestDeleteCompetitionRemovesEntriesFirst(t *testing.T) {
	f := newFixture(t)
	id, category, route1, _ := f.competition("")
	entry := f.register("climber", id, category, "")
	f.call("judge", "PUT", "/competitions/"+id+"/scores", `{"scores":[{"entry":"`+entry+`","comp_route":"`+route1+`","top_attempt":1}]}`, http.StatusOK)
	f.call("manager", "DELETE", "/competition-categories/"+category, "", http.StatusBadRequest)
	f.call("judge", "DELETE", "/competitions/"+id, "", http.StatusForbidden)
	f.call("manager", "DELETE", "/competitions/"+id, "", http.StatusNoContent)
	var left int
	f.app.DB.QueryRow(context.Background(), `SELECT (SELECT COUNT(*) FROM competition_entries) + (SELECT COUNT(*) FROM competition_scores)
		+ (SELECT COUNT(*) FROM competition_categories)`).Scan(&left)
	if left != 0 {
		t.Errorf("%d children left", left)
	}
}

func TestChangeAudiences(t *testing.T) {
	f := newFixture(t)
	starts, ends := window()
	draft := f.call("manager", "POST", "/gyms/alpha/competitions", `{"name":"Draft","location":"`+f.hall+`","discipline":"boulder",
		"scoring_format":"dynamic","starts_at":"`+starts+`","ends_at":"`+ends+`"}`, http.StatusCreated)["id"].(string)
	drafted := f.events("competition_changes:" + draft)
	if len(drafted) != 1 || drafted[0].Audience.Public || drafted[0].Audience.GymPerm != f.gymA+":"+permManage ||
		len(drafted[0].Audience.Users) != 0 {
		t.Errorf("draft change audience = %+v", drafted)
	}

	id, category, _, _ := f.competition("")
	before := len(f.events("competition_changes:" + id))
	entry := f.register("climber", id, category, "")
	changes := f.events("competition_changes:" + id)[before:]
	if len(changes) != 3 {
		t.Fatalf("entry changes = %+v", changes)
	}
	for _, change := range changes {
		if change.Actor != f.users["climber"] {
			t.Errorf("change actor = %q", change.Actor)
		}
	}
	var owner, guest, others Change
	json.Unmarshal(changes[0].Payload, &owner)
	json.Unmarshal(changes[1].Payload, &guest)
	json.Unmarshal(changes[2].Payload, &others)
	if owner.User != f.users["climber"] || owner.Entry != entry || owner.Kind != "entries" || owner.Gym != f.gymA ||
		changes[0].Audience.Users[0] != f.users["climber"] {
		t.Errorf("owner change = %+v %+v", owner, changes[0].Audience)
	}
	if guest.User != "" || guest.Entry != "" || !changes[1].Audience.GuestsOnly {
		t.Errorf("guest change = %+v %+v", guest, changes[1].Audience)
	}
	if others.User != "" || !changes[2].Audience.SignedIn || changes[2].Audience.NotUsers[0] != f.users["climber"] {
		t.Errorf("others change = %+v %+v", others, changes[2].Audience)
	}
}

func TestOwnerCannotDeleteADisqualifiedOrScoredEntry(t *testing.T) {
	f := newFixture(t)
	id, category, route1, _ := f.competition("")
	disqualified := f.register("climber", id, category, "")
	f.call("manager", "PATCH", "/competition-entries/"+disqualified, `{"status":"disqualified"}`, http.StatusOK)
	f.call("climber", "DELETE", "/competition-entries/"+disqualified, "", http.StatusForbidden)
	f.call("climber", "POST", "/competitions/"+id+"/entries", `{"category":"`+category+`","display_name":"C","birth_year":1990}`, http.StatusBadRequest)

	scored := f.register("other", id, category, "")
	f.call("other", "PUT", "/competitions/"+id+"/scores", `{"scores":[{"entry":"`+scored+`","comp_route":"`+route1+`","top_attempt":1}]}`, http.StatusOK)
	f.call("other", "DELETE", "/competition-entries/"+scored, "", http.StatusForbidden)
	f.call("manager", "DELETE", "/competition-entries/"+scored, "", http.StatusNoContent)
	if got := f.events(TopicEntryDeleted); len(got) != 1 {
		t.Errorf("entry.deleted events = %d", len(got))
	}
}

func TestClimberCannotOverwriteAJudgesScore(t *testing.T) {
	f := newFixture(t)
	id, category, route1, route2 := f.competition("")
	entry := f.register("climber", id, category, "")
	f.call("judge", "PUT", "/competitions/"+id+"/scores", `{"scores":[{"entry":"`+entry+`","comp_route":"`+route1+`","attempts":5}]}`, http.StatusOK)
	f.call("climber", "PUT", "/competitions/"+id+"/scores", `{"scores":[{"entry":"`+entry+`","comp_route":"`+route1+`","top_attempt":1}]}`, http.StatusForbidden)
	stored := items(f.call("judge", "GET", "/competitions/"+id+"/scores", "", http.StatusOK))
	if len(stored) != 1 || stored[0].(map[string]any)["top_attempt"] != 0.0 || stored[0].(map[string]any)["scored_by"] != nil {
		t.Errorf("judge score = %v", stored)
	}
	f.call("climber", "PUT", "/competitions/"+id+"/scores", `{"scores":[{"entry":"`+entry+`","comp_route":"`+route2+`","top_attempt":2}]}`, http.StatusOK)
	f.call("climber", "PUT", "/competitions/"+id+"/scores", `{"scores":[{"entry":"`+entry+`","comp_route":"`+route2+`","top_attempt":1}]}`, http.StatusOK)
	f.call("judge", "PUT", "/competitions/"+id+"/scores", `{"scores":[{"entry":"`+entry+`","comp_route":"`+route2+`","top_attempt":3}]}`, http.StatusOK)
}

func TestManagerRegistrationNotifiesAndHidesUserIDs(t *testing.T) {
	f := newFixture(t)
	id, category, _, _ := f.competition("")
	entry := f.call("manager", "POST", "/competitions/"+id+"/entries",
		`{"category":"`+category+`","display_name":"O","birth_year":1990,"user":"`+f.users["other"]+`"}`, http.StatusCreated)["id"].(string)
	var n Notify
	notes := f.events(TopicNotify)
	if len(notes) != 1 || json.Unmarshal(notes[0].Payload, &n) != nil || n.Type != "competition_entry_added" || n.Users[0] != f.users["other"] {
		t.Errorf("notify = %+v", notes)
	}
	f.call("other", "PATCH", "/competition-entries/"+entry, `{"status":"withdrawn"}`, http.StatusOK)
	f.register("climber", id, category, "")
	if len(f.events(TopicNotify)) != 1 {
		t.Error("own registration notified")
	}
	for _, viewer := range []string{"", "climber"} {
		for _, e := range items(f.call(viewer, "GET", "/competitions/"+id+"/entries", "", http.StatusOK)) {
			entry := e.(map[string]any)
			if entry["user"] != "" && entry["user"] != f.users[viewer] {
				t.Errorf("%q sees user %v", viewer, entry["user"])
			}
		}
	}
	if got := items(f.call("", "GET", "/competitions/"+id+"/entries?user="+f.users["climber"], "", http.StatusOK)); len(got) != 0 {
		t.Errorf("guest filtered by user: %v", got)
	}
	if got := items(f.call("judge", "GET", "/competitions/"+id+"/entries", "", http.StatusOK)); len(got) != 2 || got[0].(map[string]any)["user"] == "" {
		t.Errorf("judge entries = %v", got)
	}
}

func TestRepublishDoesNotDuplicateTicksOnAnotherDay(t *testing.T) {
	f := newFixture(t)
	id, category, route1, _ := f.competition("")
	entry := f.register("climber", id, category, "")
	f.call("judge", "PUT", "/competitions/"+id+"/scores", `{"scores":[{"entry":"`+entry+`","comp_route":"`+route1+`","top_attempt":1}]}`, http.StatusOK)
	f.call("manager", "POST", "/competitions/"+id+"/publish", "", http.StatusOK)
	f.app.DB.Exec(context.Background(), `UPDATE ticks SET date = date - interval '2 days'`)
	f.call("manager", "PATCH", "/competitions/"+id, `{"status":"closed"}`, http.StatusOK)
	f.call("manager", "POST", "/competitions/"+id+"/publish", "", http.StatusOK)
	var count int
	f.app.DB.QueryRow(context.Background(), `SELECT COUNT(*) FROM ticks WHERE competition = $1`, id).Scan(&count)
	if count != 1 {
		t.Errorf("ticks after republish = %d", count)
	}
}

func TestJudgesDoNotWorkOnDrafts(t *testing.T) {
	f := newFixture(t)
	id, category, route1, _ := f.competition("")
	entry := f.register("climber", id, category, "")
	f.call("manager", "PATCH", "/competitions/"+id, `{"status":"draft"}`, http.StatusOK)
	f.call("judge", "GET", "/competitions/"+id, "", http.StatusNotFound)
	if got := items(f.call("judge", "GET", "/competitions/"+id+"/entries", "", http.StatusOK)); len(got) != 0 {
		t.Errorf("judge sees draft entries: %v", got)
	}
	f.call("judge", "PUT", "/competitions/"+id+"/scores", `{"scores":[{"entry":"`+entry+`","comp_route":"`+route1+`","top_attempt":1}]}`, http.StatusForbidden)
	f.call("judge", "PATCH", "/competition-entries/"+entry, `{"status":"checked_in"}`, http.StatusNotFound)
}

func TestHiddenEntryNameStaysHidden(t *testing.T) {
	f := newFixture(t)
	id, category, _, _ := f.competition("")
	entry := f.register("climber", id, category, "")
	f.exec(`UPDATE competition_entries SET hidden = true, display_name = 'x' WHERE id = $1 RETURNING id`, entry)
	f.exec(`INSERT INTO moderation_items (id, gym, content_type, content_id, snapshot, files, state) VALUES ($1, $2, 'competition_entry', $3, '{}', '{}', 'hidden') RETURNING id`,
		ids.New(), f.gymA, entry)
	f.call("climber", "PATCH", "/competition-entries/"+entry, `{"hidden":false}`, http.StatusForbidden)
	f.call("manager", "PATCH", "/competition-entries/"+entry, `{"display_name":"Rude"}`, http.StatusForbidden)
	f.call("climber", "PATCH", "/competition-entries/"+entry, `{"status":"withdrawn"}`, http.StatusOK)
}
