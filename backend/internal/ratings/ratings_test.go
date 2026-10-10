package ratings

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"gripello/internal/platform"
	"gripello/internal/platform/captcha"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/testapp"
)

type fixture struct {
	t       *testing.T
	app     *platform.App
	handler http.Handler
	gymA    string
	gymB    string
	users   map[string]string
	tokens  map[string]string
	route   string
	routeB  string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	app := testapp.App(t)
	Register(app)
	f := &fixture{t: t, app: app, handler: testapp.Handler(app), users: map[string]string{}, tokens: map[string]string{}}
	f.gymA = f.exec(`INSERT INTO gyms (id, slug, name, active, features) VALUES ($1, 'alpha', 'Alpha', true, '{"beta_videos":true}') RETURNING id`, ids.New())
	f.gymB = f.exec(`INSERT INTO gyms (id, slug, name, active, features) VALUES ($1, 'beta', 'Beta', true, '{"beta_videos":true}') RETURNING id`, ids.New())
	f.user("climber", "", "Anna", "Muster")
	f.user("shy", "", "Shy", "Person")
	f.exec(`UPDATE users SET reviews_anonymous = true WHERE username = 'shy' RETURNING id`)
	f.user("moderator", f.gymA, "", "", "manage_comments")
	f.user("setter", f.gymA, "", "", "manage_routes")
	f.user("moderatorB", f.gymB, "", "", "manage_comments", "manage_routes")
	hall := f.exec(`INSERT INTO locations (id, gym, name) VALUES ($1, $2, 'Hall') RETURNING id`, ids.New(), f.gymA)
	hallB := f.exec(`INSERT INTO locations (id, gym, name) VALUES ($1, $2, 'Annex') RETURNING id`, ids.New(), f.gymB)
	f.route = f.exec(`INSERT INTO routes (id, gym, name, grade, type, location) VALUES ($1, $2, 'Crimp', '6a', 'Boulder', $3) RETURNING id`, ids.New(), f.gymA, hall)
	f.routeB = f.exec(`INSERT INTO routes (id, gym, name, grade, type, location) VALUES ($1, $2, 'Sloper', '6b', 'Boulder', $3) RETURNING id`, ids.New(), f.gymB, hallB)
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

func (f *fixture) user(name, gym, firstname, lastname string, permissions ...string) {
	f.t.Helper()
	id := f.exec(`INSERT INTO users (id, username, firstname, name, token_key) VALUES ($1, $2, $3, $4, $5) RETURNING id`, ids.New(), name, firstname, lastname, "key-"+name)
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

func (f *fixture) send(user string, request *http.Request, status int) map[string]any {
	f.t.Helper()
	if user != "" {
		request.Header.Set("Authorization", f.tokens[user])
	}
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, request)
	if recorder.Code != status {
		f.t.Fatalf("%s %s as %q = %d, want %d: %s", request.Method, request.URL, user, recorder.Code, status, recorder.Body.String())
	}
	out := map[string]any{}
	json.Unmarshal(recorder.Body.Bytes(), &out)
	return out
}

func (f *fixture) call(user, method, path, body string, status int) map[string]any {
	f.t.Helper()
	request := httptest.NewRequest(method, "/api"+path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	return f.send(user, request, status)
}

func (f *fixture) rate(user, body string) string {
	f.t.Helper()
	return f.call(user, "POST", "/routes/"+f.route+"/ratings", body, http.StatusCreated)["id"].(string)
}

func (f *fixture) ratingUser(id string) string {
	f.t.Helper()
	return f.exec(`SELECT COALESCE("user", '') FROM ratings WHERE id = $1`, id)
}

func items(body map[string]any) []map[string]any {
	var out []map[string]any
	list, _ := body["items"].([]any)
	for _, item := range list {
		out = append(out, item.(map[string]any))
	}
	return out
}

func TestCreateRatingSetsUserFromAuth(t *testing.T) {
	f := newFixture(t)
	guest := f.rate("", `{"rating":4,"comment":"nice","user":"forged"}`)
	if got := f.ratingUser(guest); got != "" {
		t.Errorf("guest rating user = %q", got)
	}
	own := f.call("climber", "POST", "/routes/"+f.route+"/ratings", `{"rating":5,"grade":"6a","grade_system":"font","grade_index":12}`, http.StatusCreated)
	if f.ratingUser(own["id"].(string)) != f.users["climber"] {
		t.Error("signed-in rating not owned by the caller")
	}
	if _, leaked := own["user"]; leaked || own["mine"] != true || own["gym"] != f.gymA {
		t.Errorf("created rating = %v", own)
	}
	if author := own["author"].(map[string]any); author["name"] != "Anna Muster" {
		t.Errorf("author = %v", author)
	}
	f.call("", "POST", "/routes/"+f.route+"/ratings", `{"rating":6}`, http.StatusBadRequest)
	f.call("", "POST", "/routes/"+f.route+"/ratings", `{"rating":3,"grade_index":41}`, http.StatusBadRequest)
	f.call("", "POST", "/routes/"+f.route+"/ratings", `{"comment":"`+strings.Repeat("x", 5001)+`"}`, http.StatusBadRequest)
	f.call("", "POST", "/routes/missing/ratings", `{"rating":3}`, http.StatusNotFound)
}

func TestRouteRatingsEnrichForSignedInViewers(t *testing.T) {
	f := newFixture(t)
	f.rate("climber", `{"rating":5}`)
	f.rate("shy", `{"rating":2}`)
	for _, item := range items(f.call("", "GET", "/routes/"+f.route+"/ratings", "", http.StatusOK)) {
		if item["author"] != nil || item["mine"] != nil || item["user"] != nil {
			t.Errorf("guest sees %v", item)
		}
	}
	list := items(f.call("shy", "GET", "/routes/"+f.route+"/ratings", "", http.StatusOK))
	if len(list) != 2 || list[0]["mine"] != true || list[0]["author"] != nil {
		t.Fatalf("own anonymous review = %v", list)
	}
	if list[1]["mine"] != false || list[1]["author"].(map[string]any)["id"] != f.users["climber"] {
		t.Errorf("other review = %v", list[1])
	}
}

func TestRatingUpdateAndDeleteRules(t *testing.T) {
	f := newFixture(t)
	id := f.rate("climber", `{"rating":5,"comment":"great"}`)
	f.call("climber", "PATCH", "/ratings/"+id, `{"comment":"edited"}`, http.StatusForbidden)
	f.call("moderatorB", "PATCH", "/ratings/"+id, `{"comment":"edited"}`, http.StatusForbidden)
	updated := f.call("moderator", "PATCH", "/ratings/"+id, `{"comment":"edited"}`, http.StatusOK)
	if updated["comment"] != "edited" || updated["rating"] != float64(5) || f.ratingUser(id) != f.users["climber"] {
		t.Errorf("update = %v, user %q", updated, f.ratingUser(id))
	}
	if changed := f.exec(`SELECT string_agg(payload->>'changed', '|') FROM events WHERE kind = 'rating.updated'`); changed != `["comment"]|["comment"]|["comment"]` {
		t.Errorf("changed per variant = %s", changed)
	}
	f.call("", "DELETE", "/ratings/"+id, "", http.StatusUnauthorized)
	f.call("shy", "DELETE", "/ratings/"+id, "", http.StatusForbidden)
	f.call("climber", "DELETE", "/ratings/"+id, "", http.StatusNoContent)
	other := f.rate("shy", `{"rating":1}`)
	f.call("moderatorB", "DELETE", "/ratings/"+other, "", http.StatusForbidden)
	f.call("moderator", "DELETE", "/ratings/"+other, "", http.StatusNoContent)
}

func TestGymRatingsForModerators(t *testing.T) {
	f := newFixture(t)
	f.rate("climber", `{"rating":5,"comment":"Lovely crimps"}`)
	f.rate("", `{"rating":1,"comment":"meh"}`)
	f.call("", "POST", "/routes/"+f.routeB+"/ratings", `{"rating":3}`, http.StatusCreated)
	f.call("climber", "GET", "/gyms/alpha/ratings", "", http.StatusForbidden)
	f.call("moderatorB", "GET", "/gyms/alpha/ratings", "", http.StatusForbidden)
	all := items(f.call("moderator", "GET", "/gyms/alpha/ratings?sort=lowest", "", http.StatusOK))
	if len(all) != 2 || all[0]["rating"] != float64(1) {
		t.Fatalf("list = %v", all)
	}
	route := all[1]["expand"].(map[string]any)["route_id"].(map[string]any)
	if route["name"] != "Crimp" || route["expand"].(map[string]any)["location"].(map[string]any)["name"] != "Hall" {
		t.Errorf("route expand = %v", route)
	}
	if got := items(f.call("moderator", "GET", "/gyms/alpha/ratings?min_rating=2&q=crimp", "", http.StatusOK)); len(got) != 1 {
		t.Errorf("filtered = %v", got)
	}
	if got := items(f.call("moderator", "GET", "/gyms/alpha/ratings?q=Crimp&max_rating=1", "", http.StatusOK)); len(got) != 1 {
		t.Errorf("route name search = %v", got)
	}
	shy := f.rate("shy", `{"rating":3}`)
	page := f.call("moderator", "GET", "/gyms/alpha/ratings?total=true&limit=1&since=2026-01-01%2000:00:00.000Z&route="+f.route+",other", "", http.StatusOK)
	if page["total"] != float64(3) || len(items(page)) != 1 {
		t.Errorf("total page = %v", page)
	}
	byID := items(f.call("moderator", "GET", "/gyms/alpha/ratings?ids="+shy, "", http.StatusOK))
	if len(byID) != 1 || byID[0]["author"].(map[string]any)["name"] != "Shy Person" {
		t.Errorf("staff must see anonymous authors: %v", byID)
	}
	f.call("moderator", "DELETE", "/ratings/"+shy, "", http.StatusNoContent)
	stats := f.call("", "GET", "/gyms/alpha/ratings/stats", "", http.StatusOK)
	if stats["total_reviews"] != float64(2) || stats["avg_rating"] != float64(3) || stats["low_rated"] != float64(1) || stats["this_week"] != float64(2) {
		t.Errorf("stats = %v", stats)
	}
}

func TestRatingEventsPerAudience(t *testing.T) {
	f := newFixture(t)
	id := f.rate("climber", `{"rating":4}`)
	rows, err := f.app.DB.Query(context.Background(), `SELECT topic, kind, payload, audience FROM events ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for rows.Next() {
		var topic, kind string
		var payload, audience map[string]any
		if err := rows.Scan(&topic, &kind, &payload, &audience); err != nil {
			t.Fatal(err)
		}
		record, _ := payload["record"].(map[string]any)
		got = append(got, topic+" "+kind)
		switch {
		case topic == "rating.created":
			if payload["user"] != f.users["climber"] || payload["id"] != id {
				t.Errorf("server event = %v", payload)
			}
		case audience["guests_only"] == true:
			if audience["public"] != nil || record["author"] != nil || record["mine"] != nil || record["user"] != nil {
				t.Errorf("public variant = %v", record)
			}
		case audience["signed_in"] == true:
			if record["mine"] != false || record["author"] == nil || audience["not_users"].([]any)[0] != f.users["climber"] {
				t.Errorf("signed-in variant = %v %v", record, audience)
			}
		default:
			if record["mine"] != true || audience["users"].([]any)[0] != f.users["climber"] {
				t.Errorf("author variant = %v %v", record, audience)
			}
		}
	}
	want := "rating.created rating.created|gym_changes:" + f.gymA + " rating.created"
	if len(got) != 4 || got[0]+"|"+got[1] != want {
		t.Errorf("events = %v", got)
	}
	if actors := f.exec(`SELECT string_agg(DISTINCT actor, ',') FROM events`); actors != f.users["climber"] {
		t.Errorf("actors = %q", actors)
	}
	f.rate("", `{"rating":2}`)
	var audience string
	if err := f.app.DB.QueryRow(context.Background(), `SELECT audience::text FROM events WHERE topic LIKE 'gym_changes:%' ORDER BY id DESC LIMIT 1`).Scan(&audience); err != nil {
		t.Fatal(err)
	}
	if n := f.exec(`SELECT COUNT(*)::text FROM events WHERE topic LIKE 'gym_changes:%'`); n != "4" || audience != `{"public": true}` {
		t.Errorf("guest rating events = %s, audience %s", n, audience)
	}
}

func TestImportRatings(t *testing.T) {
	f := newFixture(t)
	body := `{"ratings":[
		{"route_id":"` + f.route + `","rating":4,"comment":"old","created":"2024-03-01 10:00:00.000Z","user":"` + f.users["climber"] + `"},
		{"route_id":"` + f.route + `","rating":3,"created":"2999-01-01"},
		{"route_id":"` + f.routeB + `","rating":2},
		{"route_id":"` + f.route + `","rating":9}
	]}`
	f.call("climber", "POST", "/gyms/alpha/ratings/import", body, http.StatusForbidden)
	f.call("moderatorB", "POST", "/gyms/alpha/ratings/import", body, http.StatusForbidden)
	result := f.call("setter", "POST", "/gyms/alpha/ratings/import", body, http.StatusOK)
	if result["failed"] != float64(2) {
		t.Errorf("failed = %v", result)
	}
	if n := f.exec(`SELECT COUNT(*)::text FROM ratings WHERE "user" IS NOT NULL`); n != "0" {
		t.Errorf("imported ratings with user: %s", n)
	}
	if past := f.exec(`SELECT created::date::text FROM ratings WHERE comment = 'old'`); past != "2024-03-01" {
		t.Errorf("past created = %s", past)
	}
	if future := f.exec(`SELECT (created > now() - interval '1 minute')::text FROM ratings WHERE rating = 3`); future != "true" {
		t.Error("future created not replaced with now")
	}
	many := `{"ratings":[` + strings.TrimSuffix(strings.Repeat(`{},`, 501), ",") + `]}`
	f.call("setter", "POST", "/gyms/alpha/ratings/import", many, http.StatusBadRequest)
}

func TestIsBetaVideoLink(t *testing.T) {
	for link, want := range map[string]bool{
		"https://www.youtube.com/watch?v=abc":   false,
		"https://youtu.be/abc":                  false,
		"https://youtube.com/shorts/123":        true,
		"https://m.youtube.com/shorts/abc":      true,
		"https://vimeo.com/123":                 false,
		"https://www.instagram.com/reel/abc/":   true,
		"https://vm.tiktok.com/abc":             true,
		"http://www.youtube.com/watch?v=abc":    false,
		"https://youtube.com.evil.example/abc":  false,
		"https://example.com/video.mp4":         false,
		"javascript:alert(1)//www.youtube.com/": false,
	} {
		if got := isBetaVideoLink(link); got != want {
			t.Errorf("isBetaVideoLink(%q) = %v, want %v", link, got, want)
		}
	}
}

func TestBetaLinks(t *testing.T) {
	f := newFixture(t)
	path := "/routes/" + f.route + "/betas"
	link := `{"url":"https://youtube.com/shorts/123"}`
	f.call("", "POST", path, link, http.StatusUnauthorized)
	f.call("climber", "POST", path, `{"url":""}`, http.StatusBadRequest)
	f.call("climber", "POST", path, `{"url":"https://example.com/x"}`, http.StatusBadRequest)
	archived := f.exec(`INSERT INTO routes (id, gym, name, grade, archived) VALUES ($1, $2, 'Old', '6a', true) RETURNING id`, ids.New(), f.gymA)
	f.call("climber", "POST", "/routes/"+archived+"/betas", link, http.StatusBadRequest)
	f.exec(`UPDATE gyms SET features = '{}' WHERE id = $1 RETURNING id`, f.gymB)
	f.call("climber", "POST", "/routes/"+f.routeB+"/betas", link, http.StatusForbidden)

	created := f.call("climber", "POST", path, link, http.StatusCreated)
	if created["gym"] != f.gymA || created["user"] != f.users["climber"] || created["author"] == nil {
		t.Errorf("created = %v", created)
	}
	id := created["id"].(string)
	audiences := f.exec(`SELECT string_agg(audience::text, '|' ORDER BY id) FROM events WHERE kind = 'beta.created' AND topic LIKE 'gym_changes:%'`)
	if audiences != `{"guests_only": true}|{"signed_in": true}` {
		t.Errorf("beta audiences = %s", audiences)
	}
	if guest := items(f.call("", "GET", path, "", http.StatusOK)); len(guest) != 1 || guest[0]["author"] != nil {
		t.Errorf("guest list = %v", guest)
	}
	if viewer := items(f.call("shy", "GET", path, "", http.StatusOK)); viewer[0]["author"].(map[string]any)["name"] != "Anna Muster" {
		t.Errorf("signed-in list = %v", viewer)
	}
	f.call("shy", "DELETE", "/betas/"+id, "", http.StatusForbidden)
	f.call("moderatorB", "DELETE", "/betas/"+id, "", http.StatusForbidden)
	f.call("moderator", "DELETE", "/betas/"+id, "", http.StatusNoContent)
	own := f.call("climber", "POST", path, link, http.StatusCreated)["id"].(string)
	f.call("climber", "DELETE", "/betas/"+own, "", http.StatusNoContent)
}

func mp4Bytes() []byte {
	head := append([]byte{0, 0, 0, 0x18}, []byte("ftypmp42\x00\x00\x00\x00mp42isom")...)
	return append(head, bytes.Repeat([]byte{0}, 1024)...)
}

func (f *fixture) upload(user, route string, content []byte, extra map[string]string, status int) map[string]any {
	f.t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, _ := form.CreateFormFile("file", "My Beta.mp4")
	part.Write(content)
	for key, value := range extra {
		form.WriteField(key, value)
	}
	form.Close()
	request := httptest.NewRequest("POST", "/api/routes/"+route+"/betas", &body)
	request.Header.Set("Content-Type", form.FormDataContentType())
	return f.send(user, request, status)
}

func (f *fixture) blobExists(key string) bool {
	file, err := f.app.Blob.Open(context.Background(), key)
	if err != nil {
		return false
	}
	io.Copy(io.Discard, file)
	file.Close()
	return true
}

func TestBetaUploads(t *testing.T) {
	f := newFixture(t)
	f.upload("climber", f.route, []byte("not a video at all"), nil, http.StatusBadRequest)
	f.upload("climber", f.route, mp4Bytes(), map[string]string{"url": "https://youtube.com/shorts/1"}, http.StatusBadRequest)
	created := f.upload("climber", f.route, mp4Bytes(), nil, http.StatusCreated)
	key := betaKey(created["id"].(string), created["file"].(string))
	if !strings.HasPrefix(created["file"].(string), "my_beta_") || !f.blobExists(key) {
		t.Fatalf("upload = %v", created)
	}
	f.call("climber", "DELETE", "/betas/"+created["id"].(string), "", http.StatusNoContent)
	if f.blobExists(key) {
		t.Error("file survived the delete")
	}
}

func TestBetaPremoderation(t *testing.T) {
	f := newFixture(t)
	f.exec(`UPDATE gyms SET premoderate_betas = true WHERE id = $1 RETURNING id`, f.gymA)
	pending := f.upload("climber", f.route, mp4Bytes(), nil, http.StatusAccepted)
	if pending["pending"] != true {
		t.Fatalf("pending = %v", pending)
	}
	if n := f.exec(`SELECT COUNT(*)::text FROM beta_videos`); n != "0" {
		t.Errorf("held beta published: %s rows", n)
	}
	var payload BetaPending
	var raw []byte
	if err := f.app.DB.QueryRow(context.Background(), `SELECT payload FROM events WHERE topic = $1`, TopicBetaPending).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	json.Unmarshal(raw, &payload)
	if payload.Gym != f.gymA || payload.User != f.users["climber"] || payload.FileKey != "moderation_items/"+payload.ID+"/"+payload.File ||
		!f.blobExists(payload.FileKey) || f.blobExists(betaKey(payload.ID, payload.File)) {
		t.Errorf("pending event = %+v", payload)
	}
	f.call("moderator", "POST", "/routes/"+f.route+"/betas", `{"url":"https://youtube.com/shorts/1"}`, http.StatusCreated)
}

func TestUserUpdatedRefreshesAuthorName(t *testing.T) {
	f := newFixture(t)
	f.rate("climber", `{"rating":5}`)
	name := func() any {
		return items(f.call("shy", "GET", "/routes/"+f.route+"/ratings", "", http.StatusOK))[0]["author"].(map[string]any)["name"]
	}
	if got := name(); got != "Anna Muster" {
		t.Fatalf("name = %v", got)
	}
	f.exec(`UPDATE users SET firstname = 'Berta' WHERE id = $1 RETURNING id`, f.users["climber"])
	f.exec(`INSERT INTO events (topic, kind, payload, audience) VALUES ($1, 'user.updated', $2, '{}') RETURNING id::text`,
		"user:"+f.users["climber"], `{"record":{"id":"`+f.users["climber"]+`"},"changed":["firstname"]}`)
	f.exec(`SELECT pg_notify('gripello_events', '')::text`)
	testapp.WaitFor(t, func() bool { return name() == "Berta Muster" })
}

func TestGymBetas(t *testing.T) {
	f := newFixture(t)
	link := `{"url":"https://youtube.com/shorts/123"}`
	f.call("climber", "POST", "/routes/"+f.route+"/betas", link, http.StatusCreated)
	newest := f.call("shy", "POST", "/routes/"+f.route+"/betas", link, http.StatusCreated)["id"]
	f.call("climber", "POST", "/routes/"+f.routeB+"/betas", link, http.StatusCreated)
	guest := items(f.call("", "GET", "/gyms/alpha/betas?limit=1&include=route", "", http.StatusOK))
	if len(guest) != 1 || guest[0]["id"] != newest || guest[0]["author"] != nil {
		t.Fatalf("guest feed = %v", guest)
	}
	if route := guest[0]["expand"].(map[string]any)["route"].(map[string]any); route["name"] != "Crimp" || route["grade"] != "6a" {
		t.Errorf("route expand = %v", route)
	}
	signedIn := items(f.call("climber", "GET", "/gyms/alpha/betas?page=2&limit=1", "", http.StatusOK))
	if len(signedIn) != 1 || signedIn[0]["author"].(map[string]any)["name"] != "Anna Muster" || signedIn[0]["expand"] != nil {
		t.Errorf("signed-in feed = %v", signedIn)
	}
	f.call("", "GET", "/gyms/alpha/betas?include=wall", "", http.StatusBadRequest)
}

func TestGuestRatingsNeedCaptcha(t *testing.T) {
	f := newFixture(t)
	t.Setenv("CAP_SECRET", "cap-secret")
	guest := func(token string, status int) {
		t.Helper()
		request := httptest.NewRequest("POST", "/api/routes/"+f.route+"/ratings", strings.NewReader(`{"rating":4}`))
		request.Header.Set("Content-Type", "application/json")
		if token != "" {
			request.Header.Set(captcha.Header, token)
		}
		f.send("", request, status)
	}
	capToken := func(scope, jti string) string {
		token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"scope": scope, "jti": jti, "exp": time.Now().Add(time.Minute).Unix()}).SignedString([]byte("cap-secret"))
		return token
	}
	guest("", http.StatusBadRequest)
	guest(capToken("login", "a"), http.StatusBadRequest)
	token := capToken("rating", "b")
	guest(token, http.StatusCreated)
	guest(token, http.StatusBadRequest)
	f.rate("climber", `{"rating":5}`)
}
