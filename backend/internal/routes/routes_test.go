package routes

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gripello/internal/platform"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/testapp"
)

const floorPlanJSON = `{"width":20,"height":20,"shapes":[]}`

type fixture struct {
	t        *testing.T
	app      *platform.App
	handler  http.Handler
	gymA     string
	gymB     string
	tokens   map[string]string
	hall     string
	hallB    string
	otherGym string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	app := testapp.App(t)
	Register(app)
	f := &fixture{t: t, app: app, handler: testapp.Handler(app), tokens: map[string]string{}}
	f.gymA = f.exec(`INSERT INTO gyms (id, slug, name, active) VALUES ($1, 'alpha', 'Alpha', true) RETURNING id`, ids.New())
	f.gymB = f.exec(`INSERT INTO gyms (id, slug, name, active) VALUES ($1, 'beta', 'Beta', true) RETURNING id`, ids.New())
	f.user("setter", f.gymA, "manage_routes")
	f.user("admin", f.gymA, "manage_settings")
	f.user("inventory", f.gymA, "run_inventory")
	f.user("setterB", f.gymB, "manage_routes", "manage_settings")
	f.user("climber", "")
	f.user("operator", "")
	f.exec(`UPDATE users SET platform_admin = true WHERE username = 'operator' RETURNING id`)
	f.hall = f.exec(`INSERT INTO locations (id, gym, name, map) VALUES ($1, $2, 'Hall', $3) RETURNING id`, ids.New(), f.gymA, floorPlanJSON)
	f.hallB = f.exec(`INSERT INTO locations (id, gym, name) VALUES ($1, $2, 'Annex') RETURNING id`, ids.New(), f.gymA)
	f.otherGym = f.exec(`INSERT INTO locations (id, gym, name, map) VALUES ($1, $2, 'Hall', $3) RETURNING id`, ids.New(), f.gymB, floorPlanJSON)
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
	f.tokens[name] = token
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

func (f *fixture) route(fields string) string {
	f.t.Helper()
	body := `{"name":"Crimp","grade":"6a","type":"Boulder","creator":["S"],"location":"` + f.hall + `"` + fields + `}`
	return f.call("setter", "POST", "/gyms/"+f.gymA+"/routes", body, http.StatusCreated)["id"].(string)
}

func (f *fixture) wall(location, name string) string {
	f.t.Helper()
	body := `{"location":"` + location + `","name":"` + name + `","outline":[[1,1],[2,1],[2,2]],"edge":[[1,1],[2,1]]}`
	return f.call("admin", "POST", "/gyms/"+f.gymA+"/walls", body, http.StatusCreated)["id"].(string)
}

func items(body map[string]any) []any {
	list, _ := body["items"].([]any)
	return list
}

func TestRouteWritesNeedManageRoutes(t *testing.T) {
	f := newFixture(t)
	body := `{"name":"Crimp","grade":"6a","location":"` + f.hall + `"}`
	f.call("", "POST", "/gyms/"+f.gymA+"/routes", body, http.StatusUnauthorized)
	f.call("climber", "POST", "/gyms/"+f.gymA+"/routes", body, http.StatusForbidden)
	f.call("setterB", "POST", "/gyms/"+f.gymA+"/routes", body, http.StatusForbidden)
	f.call("operator", "POST", "/gyms/"+f.gymA+"/routes", body, http.StatusForbidden)
	id := f.route("")
	f.call("", "GET", "/routes/"+id, "", http.StatusOK)
	f.call("climber", "PATCH", "/routes/"+id, `{"name":"x"}`, http.StatusForbidden)
	f.call("climber", "DELETE", "/routes/"+id, "", http.StatusForbidden)
	f.call("setter", "DELETE", "/routes/"+id, "", http.StatusNoContent)
	f.call("", "GET", "/routes/"+id, "", http.StatusNotFound)
}

func TestRouteRequiresNameAndGrade(t *testing.T) {
	f := newFixture(t)
	body := f.call("setter", "POST", "/gyms/"+f.gymA+"/routes", `{"grade":"6a"}`, http.StatusBadRequest)
	if _, ok := body["data"].(map[string]any)["name"]; !ok {
		t.Errorf("missing name field error: %v", body)
	}
	f.call("setter", "POST", "/gyms/"+f.gymA+"/routes", `{"name":"x","grade":"6a","type":"Trad"}`, http.StatusBadRequest)
}

func TestInventoryMayOnlyArchive(t *testing.T) {
	f := newFixture(t)
	id := f.route("")
	f.call("inventory", "PATCH", "/routes/"+id, `{"archived":true}`, http.StatusForbidden)
	f.call("inventory", "PATCH", "/routes/"+id, `{"name":"Renamed"}`, http.StatusForbidden)
	f.call("climber", "POST", "/routes/"+id+"/archive", `{}`, http.StatusForbidden)
	archived := f.call("inventory", "POST", "/routes/"+id+"/archive", ``, http.StatusOK)
	if archived["archived"] != true || archived["archived_at"] == nil {
		t.Fatalf("archive did not stamp: %v", archived)
	}
	restored := f.call("inventory", "POST", "/gyms/"+f.gymA+"/routes/archive", `{"ids":["`+id+`"],"archived":false}`, http.StatusOK)
	if route := items(restored)[0].(map[string]any); route["archived"] != false || route["archived_at"] != nil {
		t.Fatalf("restore kept stamp: %v", route)
	}
	other := f.call("setterB", "POST", "/gyms/"+f.gymB+"/routes", `{"name":"B","grade":"6a","location":"`+f.otherGym+`"}`, http.StatusCreated)["id"].(string)
	f.call("inventory", "POST", "/gyms/"+f.gymA+"/routes/archive", `{"ids":["`+id+`","`+other+`"]}`, http.StatusNotFound)
	if route := f.call("", "GET", "/routes/"+id, "", http.StatusOK); route["archived"] != false {
		t.Fatal("failed bulk archive was not rolled back")
	}
}

func TestArchivedAtStamp(t *testing.T) {
	f := newFixture(t)
	id := f.route("")
	first := f.call("setter", "PATCH", "/routes/"+id, `{"archived":true}`, http.StatusOK)["archived_at"]
	if first == nil {
		t.Fatal("archiving did not stamp archived_at")
	}
	f.exec(`UPDATE routes SET archived_at = '2020-01-01T00:00:00Z' WHERE id = $1 RETURNING id`, id)
	kept, _ := time.Parse(time.RFC3339, f.call("setter", "PATCH", "/routes/"+id, `{"name":"Still archived","archived_at":null}`, http.StatusOK)["archived_at"].(string))
	if !kept.Equal(time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("archived_at = %v, want the earlier stamp", kept)
	}
	f.exec(`UPDATE routes SET archived_at = NULL WHERE id = $1 RETURNING id`, id)
	if got := f.call("setter", "POST", "/routes/"+id+"/archive", `{"archived":true}`, http.StatusOK)["archived_at"]; got == nil {
		t.Fatal("archived route without stamp did not get one")
	}
	if got := f.call("setter", "PATCH", "/routes/"+id, `{"archived":false}`, http.StatusOK)["archived_at"]; got != nil {
		t.Fatalf("restoring kept archived_at %v", got)
	}
	created := f.call("setter", "POST", "/gyms/"+f.gymA+"/routes", `{"name":"Old","grade":"5","archived":true}`, http.StatusCreated)
	if created["archived_at"] == nil {
		t.Fatal("route created archived has no stamp")
	}
}

func TestRouteListExposesPermanentAndRatings(t *testing.T) {
	f := newFixture(t)
	id := f.route(`,"permanent":true`)
	f.exec(`INSERT INTO ratings (id, gym, route_id, rating) VALUES ($1, $2, $3, 4), ($4, $2, $3, 0) RETURNING id`, ids.New(), f.gymA, id, ids.New())
	list := items(f.call("", "GET", "/gyms/"+f.gymA+"/routes", "", http.StatusOK))
	if len(list) != 1 {
		t.Fatalf("got %d routes", len(list))
	}
	route := list[0].(map[string]any)
	if route["permanent"] != true || route["average_rating"] != 4.0 || route["ratings_count"] != 1.0 {
		t.Fatalf("route = %v", route)
	}
}

func TestRouteListFilters(t *testing.T) {
	f := newFixture(t)
	wall := f.wall(f.hall, "Slab")
	placed := f.route(`,"name":"Pinch","wall":"` + wall + `","color":"#FF0000","grade":"6b"`)
	loose := f.route(`,"name":"Crimp line","creator":["Anna"]`)
	annex := f.call("setter", "POST", "/gyms/"+f.gymA+"/routes", `{"name":"Annex","grade":"7a","type":"Route","location":"`+f.hallB+`"}`, http.StatusCreated)["id"].(string)
	archived := f.route(`,"name":"Gone","archived":true`)
	f.call("setterB", "POST", "/gyms/"+f.gymB+"/routes", `{"name":"Other gym","grade":"6a"}`, http.StatusCreated)

	ids := func(query string) []string {
		var out []string
		for _, item := range items(f.call("", "GET", "/gyms/"+f.gymA+"/routes?"+query, "", http.StatusOK)) {
			out = append(out, item.(map[string]any)["id"].(string))
		}
		return out
	}
	cases := map[string][]string{
		"sort=name":                                {annex, loose, placed},
		"sort=name&archived=all":                   {annex, loose, archived, placed},
		"archived=true":                            {archived},
		"location=" + f.hall + "&sort=name":        {loose, placed},
		"wall=" + wall:                             {placed},
		"wall=none&location=" + f.hall:             {loose},
		"type=Route":                               {annex},
		"color=%23FF0000":                          {placed},
		"grade=6b&grade=7a&sort=-grade_index,name": {annex, placed},
		"q=anna":                                   {loose},
		"q=pin":                                    {placed},
		"ids=" + placed + "," + annex + "&sort=name": {annex, placed},
		"sort=name&limit=1&page=2":                   {loose},
	}
	for query, want := range cases {
		if got := ids(query); strings.Join(got, ",") != strings.Join(want, ",") {
			t.Errorf("%s = %v, want %v", query, got, want)
		}
	}
	page := f.call("", "GET", "/gyms/alpha/routes?total=true&limit=1&include=location,wall,gym&sort=name&q=pinch", "", http.StatusOK)
	if page["total"] != 1.0 {
		t.Errorf("total = %v", page["total"])
	}
	expand := items(page)[0].(map[string]any)["expand"].(map[string]any)
	if expand["location"].(map[string]any)["name"] != "Hall" || expand["wall"].(map[string]any)["name"] != "Slab" || expand["gym"].(map[string]any)["slug"] != "alpha" {
		t.Errorf("expand = %v", expand)
	}
	f.call("", "GET", "/gyms/"+f.gymA+"/routes?sort=password", "", http.StatusBadRequest)
	f.call("", "GET", "/gyms/nope/routes", "", http.StatusNotFound)
}

func TestUsedColors(t *testing.T) {
	f := newFixture(t)
	f.route(`,"color":"#00FF00"`)
	f.route(`,"color":"#00FF00"`)
	f.route(`,"color":"#0000FF","archived":true`)
	colors := items(f.call("", "GET", "/gyms/"+f.gymA+"/routes/colors", "", http.StatusOK))
	if len(colors) != 2 || colors[0] != "#0000FF" || colors[1] != "#00FF00" {
		t.Fatalf("colors = %v", colors)
	}
}

func TestRouteGymFollowsLocation(t *testing.T) {
	f := newFixture(t)
	f.call("setter", "POST", "/gyms/"+f.gymA+"/routes", `{"name":"x","grade":"6a","location":"`+f.otherGym+`"}`, http.StatusBadRequest)
	f.call("setter", "POST", "/gyms/"+f.gymA+"/routes", `{"name":"x","grade":"6a","gym":"`+f.gymB+`"}`, http.StatusBadRequest)
	id := f.route("")
	if gym := f.call("", "GET", "/routes/"+id, "", http.StatusOK)["gym"]; gym != f.gymA {
		t.Fatalf("route gym = %v", gym)
	}
	f.call("setter", "PATCH", "/routes/"+id, `{"location":"`+f.otherGym+`"}`, http.StatusBadRequest)
	f.call("setter", "PATCH", "/routes/"+id, `{"gym":"`+f.gymB+`"}`, http.StatusBadRequest)
	f.call("setterB", "PATCH", "/routes/"+id, `{"name":"stolen"}`, http.StatusForbidden)
	f.call("admin", "PATCH", "/locations/"+f.hall, `{"gym":"`+f.gymB+`"}`, http.StatusBadRequest)
	f.call("admin", "PATCH", "/locations/"+f.hall, `{"name":"Main hall"}`, http.StatusOK)
}

func TestRouteWallMustHangInItsLocation(t *testing.T) {
	f := newFixture(t)
	wall := f.wall(f.hall, "Slab")
	f.call("setter", "POST", "/gyms/"+f.gymA+"/routes", `{"name":"x","grade":"6a","location":"`+f.hallB+`","wall":"`+wall+`"}`, http.StatusBadRequest)
	f.call("setter", "POST", "/gyms/"+f.gymA+"/routes", `{"name":"x","grade":"6a","location":"`+f.hall+`","wall":"missing"}`, http.StatusBadRequest)
	id := f.route(`,"wall":"` + wall + `","wall_position":3`)
	if pos := f.call("", "GET", "/routes/"+id, "", http.StatusOK)["wall_position"]; pos != 1.0 {
		t.Fatalf("wall_position = %v, want clamped 1", pos)
	}
	moved := f.call("setter", "PATCH", "/routes/"+id, `{"location":"`+f.hallB+`"}`, http.StatusOK)
	if moved["wall"] != "" || moved["wall_position"] != 0.0 {
		t.Fatalf("moving the route kept its wall: %v", moved)
	}
}

func TestMapPlacements(t *testing.T) {
	f := newFixture(t)
	wall := f.wall(f.hall, "Slab")
	first, second := f.route(""), f.route("")
	body := `{"placements":[{"route":"` + first + `","wall":"` + wall + `","wall_position":0.25},{"route":"` + second + `","wall":"` + wall + `","wall_position":-2}]}`
	f.call("admin", "PUT", "/gyms/"+f.gymA+"/map/placements", body, http.StatusForbidden)
	placed := items(f.call("setter", "PUT", "/gyms/"+f.gymA+"/map/placements", body, http.StatusOK))
	if len(placed) != 2 || placed[0].(map[string]any)["wall_position"] != 0.25 || placed[1].(map[string]any)["wall_position"] != 0.0 {
		t.Fatalf("placed = %v", placed)
	}
	f.exec(`UPDATE locations SET map = $2 WHERE id = $1 RETURNING id`, f.hallB, floorPlanJSON)
	annexWall := f.wall(f.hallB, "Annex wall")
	bad := `{"placements":[{"route":"` + first + `","wall":""},{"route":"` + second + `","wall":"` + annexWall + `"}]}`
	f.call("setter", "PUT", "/gyms/"+f.gymA+"/map/placements", bad, http.StatusBadRequest)
	if route := f.call("", "GET", "/routes/"+first, "", http.StatusOK); route["wall"] != wall {
		t.Fatal("failed placement batch was not rolled back")
	}
}

func TestListByIDsAcrossGyms(t *testing.T) {
	f := newFixture(t)
	wall := f.wall(f.hall, "Slab")
	own := f.route(`,"wall":"` + wall + `"`)
	other := f.call("setterB", "POST", "/gyms/"+f.gymB+"/routes", `{"name":"B","grade":"6a","location":"`+f.otherGym+`"}`, http.StatusCreated)["id"].(string)
	routes := items(f.call("", "GET", "/routes?ids="+own+","+other+"&include=gym,wall", "", http.StatusOK))
	if len(routes) != 2 {
		t.Fatalf("routes = %v", routes)
	}
	for _, item := range routes {
		route := item.(map[string]any)
		if _, ok := route["average_rating"]; !ok || route["expand"].(map[string]any)["gym"] == nil {
			t.Errorf("route = %v", route)
		}
	}
	f.call("", "GET", "/routes", "", http.StatusBadRequest)
	f.call("", "GET", "/routes?ids="+strings.Repeat("x,", 200)+"x", "", http.StatusBadRequest)

	walls := items(f.call("", "GET", "/walls?ids="+wall+",missing", "", http.StatusOK))
	if len(walls) != 1 || walls[0].(map[string]any)["location_name"] != "Hall" || walls[0].(map[string]any)["gym"] != f.gymA {
		t.Fatalf("walls = %v", walls)
	}
	f.call("", "GET", "/walls", "", http.StatusBadRequest)
}

func TestHiddenRouteStaysHidden(t *testing.T) {
	f := newFixture(t)
	id := f.route("")
	f.exec(`UPDATE routes SET archived = true, archived_at = now() WHERE id = $1 RETURNING id`, id)
	f.exec(`INSERT INTO moderation_items (id, gym, content_type, content_id, snapshot, files, state) VALUES ($1, $2, 'route', $3, '{}', '{}', 'hidden') RETURNING id`,
		ids.New(), f.gymA, id)
	f.call("setter", "POST", "/routes/"+id+"/archive", `{"archived":false}`, http.StatusForbidden)
	f.call("setter", "POST", "/gyms/"+f.gymA+"/routes/archive", `{"ids":["`+id+`"],"archived":false}`, http.StatusForbidden)
	f.call("setter", "PATCH", "/routes/"+id, `{"archived":false}`, http.StatusForbidden)
	f.call("setter", "PATCH", "/routes/"+id, `{"name":"Renamed"}`, http.StatusForbidden)
	f.call("setter", "PATCH", "/routes/"+id, `{"grade":"6b"}`, http.StatusOK)
}

func TestDeleteRouteWithHistoryNeedsForce(t *testing.T) {
	f := newFixture(t)
	id := f.route("")
	var user string
	f.app.DB.QueryRow(context.Background(), `SELECT id FROM users WHERE username = 'climber'`).Scan(&user)
	beta := f.exec(`INSERT INTO beta_videos (id, gym, route, "user", file) VALUES ($1, $2, $3, $4, 'clip.mp4') RETURNING id`, ids.New(), f.gymA, id, user)
	if err := f.app.Blob.Put(context.Background(), "beta_videos/"+beta+"/clip.mp4", strings.NewReader("x")); err != nil {
		t.Fatal(err)
	}
	f.call("setter", "DELETE", "/routes/"+id, "", http.StatusConflict)
	f.call("setter", "DELETE", "/routes/"+id+"?force=true", "", http.StatusNoContent)
	if _, err := f.app.Blob.Open(context.Background(), "beta_videos/"+beta+"/clip.mp4"); err == nil {
		t.Error("beta file left behind")
	}
}

func TestRouteTextLimits(t *testing.T) {
	f := newFixture(t)
	long := strings.Repeat("x", 101)
	for _, body := range []string{`{"name":"` + long + `"}`, `{"comment":"` + strings.Repeat("x", 2001) + `"}`,
		`{"creator":["` + long + `"]}`, `{"creator":["a"` + strings.Repeat(`,"a"`, 20) + `]}`} {
		f.call("setter", "POST", "/gyms/"+f.gymA+"/routes", `{"grade":"6a","name":"N","location":"`+f.hall+`",`+body[1:], http.StatusBadRequest)
	}
	f.call("admin", "POST", "/gyms/"+f.gymA+"/locations", `{"name":"`+long+`"}`, http.StatusBadRequest)
}

func TestRouteListPageOverflowAndRepeatedIncludes(t *testing.T) {
	f := newFixture(t)
	f.route("")
	page := f.call("", "GET", "/gyms/"+f.gymA+"/routes?page=9223372036854775807&limit=1000", "", http.StatusOK)
	if len(items(page)) != 0 {
		t.Errorf("overflowing page = %v", page)
	}
	listed := f.call("", "GET", "/gyms/"+f.gymA+"/routes?include="+strings.Repeat("location,", 300)+"location", "", http.StatusOK)
	if len(items(listed)) != 1 {
		t.Errorf("repeated include = %v", listed)
	}
}

func TestMovingAWallTakesItsRoutes(t *testing.T) {
	f := newFixture(t)
	f.exec(`UPDATE locations SET map = $2 WHERE id = $1 RETURNING id`, f.hallB, floorPlanJSON)
	wall := f.wall(f.hall, "North")
	id := f.route(`,"wall":"` + wall + `"`)
	f.call("admin", "PATCH", "/walls/"+wall, `{"location":"`+f.hallB+`"}`, http.StatusOK)
	got := f.call("", "GET", "/routes/"+id, "", http.StatusOK)
	if got["location"] != f.hallB || got["wall"] != wall {
		t.Errorf("route after wall move = %v", got)
	}
}
