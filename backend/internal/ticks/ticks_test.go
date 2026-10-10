package ticks

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

type fixture struct {
	t       *testing.T
	app     *platform.App
	module  *module
	handler http.Handler
	gymA    string
	gymB    string
	hallA   string
	hallB   string
	users   map[string]string
	tokens  map[string]string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	app := testapp.App(t)
	f := &fixture{t: t, app: app, handler: testapp.Handler(app), users: map[string]string{}, tokens: map[string]string{}}
	f.gymA = f.exec(`INSERT INTO gyms (id, slug, name, active) VALUES ($1, 'alpha', 'Alpha', true) RETURNING id`, ids.New())
	f.gymB = f.exec(`INSERT INTO gyms (id, slug, name, active) VALUES ($1, 'beta', 'Beta', true) RETURNING id`, ids.New())
	f.hallA = f.exec(`INSERT INTO locations (id, gym, name) VALUES ($1, $2, 'Hall') RETURNING id`, ids.New(), f.gymA)
	f.hallB = f.exec(`INSERT INTO locations (id, gym, name) VALUES ($1, $2, 'Hall') RETURNING id`, ids.New(), f.gymB)
	f.user("climber", "")
	f.user("friend", "")
	f.user("stranger", "")
	f.user("setterA", f.gymA, "manage_routes", "manage_competitions")
	f.user("setterB", f.gymB, "manage_routes", "manage_competitions")
	f.user("adminA", f.gymA, "manage_settings")
	f.module = newModule(app)
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
	id := f.exec(`INSERT INTO users (id, username, token_key) VALUES ($1, $2, $3) RETURNING id`, ids.New(), name, "key-"+name)
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

func (f *fixture) follow(follower, followee, status string) {
	f.t.Helper()
	f.exec(`INSERT INTO follows (id, follower, followee, status) VALUES ($1, $2, $3, $4) RETURNING id`, ids.New(), f.users[follower], f.users[followee], status)
}

func (f *fixture) boulder(hall, grade string, index float64) string {
	f.t.Helper()
	gym := f.gymA
	if hall == f.hallB {
		gym = f.gymB
	}
	return f.exec(`INSERT INTO routes (id, gym, name, grade, grade_system, grade_index, type, location, color)
		VALUES ($1, $2, $3, $3, 'font', $4, 'Boulder', $5, 'red') RETURNING id`, ids.New(), gym, grade, index, hall)
}

func (f *fixture) call(user, method, path, body string, status int, contains ...string) string {
	f.t.Helper()
	request := httptest.NewRequest(method, "/api"+path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if user != "" {
		request.Header.Set("Authorization", f.tokens[user])
	}
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, request)
	out := recorder.Body.String()
	if recorder.Code != status {
		f.t.Fatalf("%s %s as %q = %d, want %d: %s", method, path, user, recorder.Code, status, out)
	}
	for _, want := range contains {
		if !strings.Contains(out, want) {
			f.t.Errorf("%s %s as %q: missing %s in %s", method, path, user, want, out)
		}
	}
	return out
}

func (f *fixture) tick(user, route, kind string, date time.Time) Tick {
	f.t.Helper()
	body, _ := json.Marshal(map[string]any{"route": route, "type": kind, "attempts": 3, "date": date.UTC().Format(time.RFC3339Nano), "note": "secret beta"})
	var tick Tick
	json.Unmarshal([]byte(f.call(user, "POST", "/me/ticks", string(body), http.StatusCreated)), &tick)
	return tick
}

func (f *fixture) outbox(topic string) []events.Event {
	f.t.Helper()
	rows, _ := f.app.DB.Query(context.Background(), `SELECT id, topic, kind, payload, audience FROM events WHERE topic = $1 ORDER BY id`, topic)
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (events.Event, error) {
		var e events.Event
		var audience []byte
		err := row.Scan(&e.ID, &e.Topic, &e.Kind, &e.Payload, &audience)
		json.Unmarshal(audience, &e.Audience)
		return e, err
	})
	if err != nil {
		f.t.Fatal(err)
	}
	return list
}

func TestTickCreateCopiesTheRouteSnapshot(t *testing.T) {
	f := newFixture(t)
	route := f.boulder(f.hallA, "7A", 18.5)
	tick := f.tick("climber", route, "flash", time.Now())
	if tick.Grade != "7A" || tick.GradeSystem != "font" || tick.GradeIndex != 18.5 || tick.RouteName != "7A" || tick.User != f.users["climber"] {
		t.Fatalf("snapshot = %+v", tick)
	}
	if tick.Attempts != 1 {
		t.Fatalf("a flash takes one attempt, got %d", tick.Attempts)
	}
	f.call("climber", "POST", "/me/ticks", `{"route":"`+route+`","type":"top","attempts":2,"date":"2026-01-01 00:00:00.000Z","grade":"9A","grade_index":30}`, http.StatusCreated, `"grade":"7A"`, `"grade_index":18.5`)
	f.call("", "POST", "/me/ticks", `{"route":"`+route+`","type":"top","attempts":1,"date":"2026-01-01"}`, http.StatusUnauthorized)
	f.call("climber", "POST", "/me/ticks", `{"user":"`+f.users["friend"]+`","route":"`+route+`","type":"top","attempts":1,"date":"2026-01-01"}`, http.StatusForbidden)
	f.call("climber", "POST", "/me/ticks", `{"type":"top","attempts":1,"date":"2026-01-01"}`, http.StatusBadRequest, `"route"`)
	f.call("climber", "POST", "/me/ticks", `{"route":"missing","type":"top","attempts":1,"date":"2026-01-01"}`, http.StatusBadRequest, `"route"`)
	f.call("climber", "POST", "/me/ticks", `{"route":"`+route+`","type":"top","attempts":0,"date":"2026-01-01"}`, http.StatusBadRequest, `"attempts"`)
	f.call("climber", "POST", "/me/ticks", `{"route":"`+route+`","type":"onsight","attempts":1,"date":"2026-01-01"}`, http.StatusBadRequest, `"type"`)
	f.call("climber", "POST", "/me/ticks", `{"route":"`+route+`","type":"top","attempts":1,"date":"2026-01-01","note":"`+strings.Repeat("x", 501)+`"}`, http.StatusBadRequest, `"note"`)
}

func TestTickDatesMayNotLieFarInTheFuture(t *testing.T) {
	now := time.Now()
	if tickDateInFuture(now.Add(35*time.Hour), now) || !tickDateInFuture(now.Add(37*time.Hour), now) {
		t.Fatal("leeway is 36 h")
	}
	f := newFixture(t)
	route := f.boulder(f.hallA, "6A", 15.7)
	future := now.Add(48 * time.Hour).UTC().Format(time.RFC3339)
	f.call("climber", "POST", "/me/ticks", `{"route":"`+route+`","type":"top","attempts":1,"date":"`+future+`"}`, http.StatusBadRequest, "in the future")
	tick := f.tick("climber", route, "top", now)
	f.call("climber", "PATCH", "/ticks/"+tick.ID, `{"date":"`+future+`"}`, http.StatusBadRequest, "in the future")
}

func TestTickClientIDsReplayAsDuplicates(t *testing.T) {
	f := newFixture(t)
	route := f.boulder(f.hallA, "6A", 15.7)
	id := ids.New()
	body := `{"id":"` + id + `","route":"` + route + `","type":"top","attempts":1,"date":"2026-01-01"}`
	f.call("climber", "POST", "/me/ticks", body, http.StatusCreated, `"id":"`+id+`"`)
	f.call("climber", "POST", "/me/ticks", body, http.StatusBadRequest, `"validation_pk_invalid"`)
	f.call("climber", "POST", "/me/ticks", `{"id":"BAD","route":"`+route+`","type":"top","attempts":1,"date":"2026-01-01"}`, http.StatusBadRequest)
}

func TestTickUpdatesKeepTheLockedFields(t *testing.T) {
	f := newFixture(t)
	route, other := f.boulder(f.hallA, "6A", 15.7), f.boulder(f.hallA, "7A", 18.5)
	tick := f.tick("climber", route, "top", time.Now())
	f.call("climber", "PATCH", "/ticks/"+tick.ID, `{"type":"attempt","attempts":4,"note":"next time","route":"`+route+`","grade":"6A"}`, http.StatusOK, `"attempts":4`, `"note":"next time"`)
	f.call("climber", "PATCH", "/ticks/"+tick.ID, `{"type":"flash","attempts":4}`, http.StatusOK, `"attempts":1`)
	for _, body := range []string{`{"route":"` + other + `"}`, `{"grade":"8A"}`, `{"grade_index":30}`, `{"grade_system":"v"}`, `{"route_name":"x"}`, `{"user":"` + f.users["friend"] + `"}`} {
		f.call("climber", "PATCH", "/ticks/"+tick.ID, body, http.StatusBadRequest)
	}
	f.call("friend", "PATCH", "/ticks/"+tick.ID, `{"note":"mine"}`, http.StatusNotFound)
	f.call("friend", "DELETE", "/ticks/"+tick.ID, "", http.StatusNotFound)
	f.call("climber", "DELETE", "/ticks/"+tick.ID, "", http.StatusNoContent)
	f.call("climber", "DELETE", "/ticks/"+tick.ID, "", http.StatusNotFound)
}

func TestTickEventsReachOwnerFollowersAndListeners(t *testing.T) {
	f := newFixture(t)
	route := f.boulder(f.hallA, "6A", 15.7)
	tick := f.tick("climber", route, "top", time.Now())
	f.call("climber", "PATCH", "/ticks/"+tick.ID, `{"date":"2026-01-01"}`, http.StatusOK)
	f.call("climber", "DELETE", "/ticks/"+tick.ID, "", http.StatusNoContent)

	own := f.outbox(TopicOwnTicks)
	if n := f.exec(`SELECT COUNT(*)::text FROM events WHERE topic IN ('own_ticks', 'followed_ticks', 'tick.changed') AND actor IS DISTINCT FROM $1`, f.users["climber"]); n != "0" {
		t.Error("tick events lack the actor")
	}
	if len(own) != 3 || own[0].Kind != "tick.created" || own[1].Kind != "tick.updated" || own[2].Kind != "tick.deleted" {
		t.Fatalf("own_ticks = %+v", own)
	}
	if aud := own[0].Audience; len(aud.Users) != 1 || aud.Users[0] != f.users["climber"] || aud.Public {
		t.Fatalf("own_ticks audience = %+v", aud)
	}
	var change TickChange
	json.Unmarshal(own[0].Payload, &change)
	if change.Action != "create" || change.Record.Note != "secret beta" {
		t.Fatalf("own_ticks payload = %s", own[0].Payload)
	}
	followed := f.outbox(TopicFollowedTicks)
	if len(followed) != 3 || followed[0].Audience.FollowersOf != f.users["climber"] || strings.Contains(string(followed[0].Payload), "secret") {
		t.Fatalf("followed_ticks = %+v", followed)
	}
	changed := f.outbox(TopicTickChanged)
	if len(changed) != 4 {
		t.Fatalf("tick.changed: create + update for both days + delete, got %d", len(changed))
	}
	var first TickChanged
	json.Unmarshal(changed[0].Payload, &first)
	if first.Gym != f.gymA || first.Route != route || first.User != f.users["climber"] {
		t.Fatalf("tick.changed payload = %+v", first)
	}

	f.exec(`UPDATE users SET ticks_private = true WHERE id = $1 RETURNING id`, f.users["climber"])
	f.tick("climber", route, "top", time.Now())
	if len(f.outbox(TopicFollowedTicks)) != 3 {
		t.Fatal("private ticks reached followers")
	}
}

func TestLogbookListsOwnTicksWithTheRoute(t *testing.T) {
	f := newFixture(t)
	route, gone := f.boulder(f.hallA, "6A", 15.7), f.boulder(f.hallA, "7A", 18.5)
	f.tick("climber", route, "top", time.Now().Add(-time.Hour))
	f.tick("climber", gone, "attempt", time.Now())
	f.tick("friend", route, "top", time.Now())
	f.exec(`DELETE FROM routes WHERE id = $1 RETURNING id`, gone)

	var page tickPage
	json.Unmarshal([]byte(f.call("climber", "GET", "/me/ticks", "", http.StatusOK)), &page)
	if len(page.Items) != 2 || page.Items[0].Route != "" || page.Items[0].RouteName != "7A" || page.Items[0].Expand != nil {
		t.Fatalf("a deleted route keeps the snapshot: %+v", page.Items)
	}
	if expand := page.Items[1].Expand; expand == nil || expand.Route.ID != route || expand.Route.Expand.Gym.Slug != "alpha" {
		t.Fatalf("route summary = %+v", page.Items[1])
	}
	f.call("climber", "GET", "/me/ticks?route="+route, "", http.StatusOK, `"route":"`+route+`"`)
	f.call("climber", "GET", "/me/ticks?since=2999-01-01", "", http.StatusOK, `"items":[]`)
	f.call("climber", "GET", "/me/ticks?limit=1&page=2", "", http.StatusOK, `"page":2`, `"limit":1`)
	f.call("climber", "GET", "/me/ticks?limit=1&total=true", "", http.StatusOK, `"total":2`)
	if out := f.call("climber", "GET", "/me/ticks", "", http.StatusOK); strings.Contains(out, `"total"`) {
		t.Fatalf("total only on request: %s", out)
	}
	json.Unmarshal([]byte(f.call("climber", "GET", "/me/ticks?sort=date", "", http.StatusOK)), &page)
	if page.Items[0].Route != route {
		t.Fatalf("sort=date puts the oldest first: %+v", page.Items)
	}
	json.Unmarshal([]byte(f.call("climber", "GET", "/me/ticks?sort=-grade_index", "", http.StatusOK)), &page)
	if page.Items[0].GradeIndex != 18.5 {
		t.Fatalf("sort=-grade_index puts the hardest first: %+v", page.Items)
	}
	for _, sort := range []string{"-date,-created", "-created", "created", "grade_index"} {
		f.call("climber", "GET", "/me/ticks?sort="+sort, "", http.StatusOK)
	}
	f.call("climber", "GET", "/me/ticks?sort=note", "", http.StatusBadRequest)
	f.call("", "GET", "/me/ticks", "", http.StatusUnauthorized)
	f.call("climber", "GET", "/me/ticks/sends", "", http.StatusOK, `["`+route+`"]`)
}

func TestFeedShowsAcceptedFollowsOnly(t *testing.T) {
	f := newFixture(t)
	f.exec(`UPDATE users SET firstname = 'Cleo', name = 'Climber' WHERE id = $1 RETURNING id`, f.users["climber"])
	routeA, routeB := f.boulder(f.hallA, "6A", 15.7), f.boulder(f.hallB, "7A", 18.5)
	f.tick("climber", routeA, "top", time.Now().Add(-time.Hour))
	f.tick("climber", routeB, "flash", time.Now())
	f.follow("friend", "climber", "accepted")
	f.follow("stranger", "climber", "pending")

	var page tickPage
	json.Unmarshal([]byte(f.call("friend", "GET", "/me/feed", "", http.StatusOK)), &page)
	if len(page.Items) != 2 || page.Items[0].Route != routeB || page.Items[0].Note != "" || page.Items[0].Climber == nil || page.Items[0].Climber.Name != "Cleo Climber" {
		t.Fatalf("feed = %+v", page.Items)
	}
	f.call("friend", "GET", "/me/feed?gym="+f.gymA, "", http.StatusOK, `"route":"`+routeA+`"`)
	f.call("stranger", "GET", "/me/feed", "", http.StatusOK, `"items":[]`)
	f.call("friend", "GET", "/me/feed?sort=name", "", http.StatusBadRequest)
	f.call("friend", "GET", "/me/feed?gym="+f.gymA+"&total=true", "", http.StatusOK, `"total":1`)

	f.call("climber", "GET", "/climbers/"+f.users["climber"]+"/ticks", "", http.StatusOK, `"note":"secret beta"`)
	f.call("friend", "GET", "/climbers/"+f.users["climber"]+"/ticks", "", http.StatusOK, `"route":"`+routeA+`"`)
	f.call("friend", "GET", "/climbers/"+f.users["climber"]+"/ticks?limit=1&page=2", "", http.StatusOK, `"route":"`+routeA+`"`, `"page":2`, `"limit":1`)
	f.call("stranger", "GET", "/climbers/"+f.users["climber"]+"/ticks", "", http.StatusOK, `"items":[]`)
	f.exec(`UPDATE users SET ticks_private = true WHERE id = $1 RETURNING id`, f.users["climber"])
	f.call("friend", "GET", "/climbers/"+f.users["climber"]+"/ticks", "", http.StatusOK, `"items":[]`)
	f.call("friend", "GET", "/me/feed", "", http.StatusOK, `"items":[]`)
}
