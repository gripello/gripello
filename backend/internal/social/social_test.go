package social

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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
	users   map[string]string
	tokens  map[string]string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	app := testapp.App(t)
	f := &fixture{t: t, app: app, handler: testapp.Handler(app), users: map[string]string{}, tokens: map[string]string{}}
	for _, name := range []string{"climber", "setter", "admin", "hidden"} {
		f.user(name)
	}
	f.module = newModule(app)
	return f
}

func (f *fixture) exec(sql string, args ...any) string {
	f.t.Helper()
	var out string
	if err := f.app.DB.QueryRow(context.Background(), sql, args...).Scan(&out); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return out
}

func (f *fixture) user(name string) {
	f.t.Helper()
	id := f.exec(`INSERT INTO users (id, username, token_key) VALUES ($1, $2, $3) RETURNING id`, ids.New(), name, "key-"+name)
	token, err := f.app.Tokens.Sign(id, "key-"+name, "")
	if err != nil {
		f.t.Fatal(err)
	}
	f.users[name], f.tokens[name] = id, token
}

func (f *fixture) set(name, column string, value any) {
	f.t.Helper()
	f.exec(`UPDATE users SET `+column+` = $2 WHERE id = $1 RETURNING id`, f.users[name], value)
}

func (f *fixture) rename(name, first, last string) {
	f.set(name, "firstname", first)
	f.set(name, "name", last)
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

func (f *fixture) follow(follower, followee string, status int, contains ...string) Follow {
	f.t.Helper()
	var follow Follow
	json.Unmarshal([]byte(f.call(follower, "POST", "/follows", `{"followee":"`+f.users[followee]+`"}`, status, contains...)), &follow)
	return follow
}

func (f *fixture) outbox(topic string) []events.Event {
	f.t.Helper()
	rows, err := f.app.DB.Query(context.Background(), `SELECT topic, kind, payload, audience FROM events WHERE topic = $1 ORDER BY id`, topic)
	if err != nil {
		f.t.Fatal(err)
	}
	defer rows.Close()
	var out []events.Event
	for rows.Next() {
		var e events.Event
		var audience []byte
		rows.Scan(&e.Topic, &e.Kind, &e.Payload, &audience)
		json.Unmarshal(audience, &e.Audience)
		out = append(out, e)
	}
	return out
}

func (f *fixture) notified(kind, user string) bool {
	for _, e := range f.outbox(TopicNotify) {
		var n Notify
		json.Unmarshal(e.Payload, &n)
		if n.Type == kind && len(n.Users) == 1 && n.Users[0] == f.users[user] {
			return true
		}
	}
	return false
}

func TestFollowPolicies(t *testing.T) {
	f := newFixture(t)
	f.set("setter", "follow_policy", "open")
	f.set("hidden", "follow_policy", "closed")

	pending := f.follow("climber", "admin", http.StatusCreated, `"status":"pending"`)
	f.follow("climber", "setter", http.StatusCreated, `"status":"accepted"`)
	f.follow("climber", "hidden", http.StatusBadRequest, `can't be followed`)
	f.follow("climber", "climber", http.StatusBadRequest, `"followee"`)
	f.follow("climber", "admin", http.StatusBadRequest, `validation_not_unique`)
	f.call("climber", "POST", "/follows", `{"followee":"nobody"}`, http.StatusBadRequest, `can't be followed`)
	f.call("", "POST", "/follows", `{"followee":"`+f.users["admin"]+`"}`, http.StatusUnauthorized)

	if !f.notified("follow_requested", "admin") || !f.notified("new_follower", "setter") {
		t.Error("followees were not notified")
	}

	f.call("climber", "POST", "/follows/"+pending.ID+"/accept", "", http.StatusNotFound)
	f.call("setter", "POST", "/follows/"+pending.ID+"/accept", "", http.StatusNotFound)
	f.call("admin", "POST", "/follows/"+pending.ID+"/accept", "", http.StatusOK, `"status":"accepted"`)
	f.call("admin", "POST", "/follows/"+pending.ID+"/accept", "", http.StatusBadRequest)
	if !f.notified("follow_accepted", "climber") {
		t.Error("follower was not told about the accepted request")
	}

	f.call("hidden", "GET", "/me/follows", "", http.StatusOK, `[]`)
	f.call("climber", "GET", "/me/follows?direction=following&status=accepted", "", http.StatusOK, f.users["admin"], f.users["setter"])
	f.call("admin", "GET", "/me/follows?direction=following", "", http.StatusOK, `[]`)
	f.call("admin", "GET", "/me/follows?direction=sideways", "", http.StatusBadRequest)
	f.call("hidden", "DELETE", "/follows/"+pending.ID, "", http.StatusNotFound)
	f.call("admin", "DELETE", "/follows/"+pending.ID, "", http.StatusNoContent)

	changes := f.outbox(TopicFollowChanges)
	if len(changes) != 4 || changes[3].Kind != "follow.deleted" {
		t.Fatalf("follow_changes = %+v", changes)
	}
	if aud := changes[0].Audience.Users; len(aud) != 2 || aud[0] != f.users["climber"] || aud[1] != f.users["admin"] {
		t.Errorf("follow_changes audience = %v", aud)
	}
	var changed FollowChanged
	json.Unmarshal(f.outbox(TopicFollowChanged)[2].Payload, &changed)
	if changed != (FollowChanged{Follower: f.users["climber"], Followee: f.users["admin"], Status: "accepted", Action: "update"}) {
		t.Errorf("follow.changed = %+v", changed)
	}
}

func TestBlocksEndFollowsAndHideTheBlocker(t *testing.T) {
	f := newFixture(t)
	f.set("setter", "follow_policy", "open")
	f.set("climber", "follow_policy", "open")
	f.rename("setter", "Sam", "Setter")
	f.follow("climber", "setter", http.StatusCreated)
	f.follow("setter", "climber", http.StatusCreated)
	f.call("climber", "GET", "/climbers?q=sam", "", http.StatusOK, `"name":"Sam Setter"`)

	var block Block
	json.Unmarshal([]byte(f.call("setter", "POST", "/blocks", `{"blocked":"`+f.users["climber"]+`"}`, http.StatusCreated)), &block)
	f.call("setter", "POST", "/blocks", `{"blocked":"`+f.users["climber"]+`"}`, http.StatusBadRequest, `validation_not_unique`)
	f.call("setter", "POST", "/blocks", `{"blocked":"`+f.users["setter"]+`"}`, http.StatusBadRequest)
	f.call("climber", "GET", "/me/follows", "", http.StatusOK, `[]`)
	if deleted := f.outbox(TopicFollowChanges); len(deleted) != 4 || deleted[2].Kind != "follow.deleted" || deleted[3].Kind != "follow.deleted" {
		t.Errorf("block did not announce the ended follows: %+v", deleted)
	}

	f.follow("climber", "setter", http.StatusBadRequest, `can't be followed`)
	f.follow("setter", "climber", http.StatusBadRequest, `can't be followed`)
	f.call("climber", "GET", "/climbers?q=sam", "", http.StatusOK, `[]`)
	f.call("climber", "GET", "/climbers?ids="+f.users["setter"], "", http.StatusOK, `[]`)
	f.call("climber", "GET", "/climbers/"+f.users["setter"], "", http.StatusNotFound)
	f.call("setter", "GET", "/climbers/"+f.users["climber"], "", http.StatusOK)

	f.call("climber", "GET", "/me/blocks", "", http.StatusOK, `[]`)
	f.call("setter", "GET", "/me/blocks", "", http.StatusOK, block.ID)
	f.call("climber", "DELETE", "/blocks/"+block.ID, "", http.StatusNotFound)
	f.call("setter", "DELETE", "/blocks/"+block.ID, "", http.StatusNoContent)
	f.call("climber", "GET", "/climbers/"+f.users["setter"], "", http.StatusOK)
}

func TestClimberLookups(t *testing.T) {
	f := newFixture(t)
	f.rename("setter", "Sam", "Setter")
	f.rename("hidden", "Sam", "Hidden")
	f.rename("admin", "Ada", "Admin")
	f.set("hidden", "follow_policy", "closed")

	f.call("", "GET", "/climbers?q=sam", "", http.StatusUnauthorized)
	out := f.call("climber", "GET", "/climbers?q=sam", "", http.StatusOK, `"name":"Sam Setter"`)
	if strings.Contains(out, f.users["hidden"]) {
		t.Errorf("closed profile in search: %s", out)
	}
	f.call("climber", "GET", "/climbers?q=sam+set", "", http.StatusOK, `"name":"Sam Setter"`)
	f.call("climber", "GET", "/climbers?q=admi", "", http.StatusOK, f.users["admin"])
	f.call("climber", "GET", "/climbers?q=s", "", http.StatusOK, `[]`)
	f.call("climber", "GET", "/climbers?q=%25%25", "", http.StatusOK, `[]`)
	f.call("climber", "GET", "/climbers/"+f.users["hidden"], "", http.StatusNotFound)
	f.call("climber", "GET", "/climbers?ids="+f.users["hidden"]+","+f.users["admin"], "", http.StatusOK,
		`[{"id":"`+f.users["admin"]+`","name":"Ada Admin","avatar":"","banner":""}]`)

	f.call("climber", "GET", "/climbers?ids="+f.users["climber"], "", http.StatusOK, `"name":"climber"`)
	f.set("admin", "avatar", "a.png")
	f.set("admin", "banner", "b.png")
	for _, path := range []string{"/climbers?q=ada", "/climbers?ids=" + f.users["admin"], "/climbers/" + f.users["admin"]} {
		f.call("climber", "GET", path, "", http.StatusOK, `"name":"Ada Admin"`,
			`"avatar":"/api/files/users/`+f.users["admin"]+`/a.png?thumb=100x100"`,
			`"banner":"/api/files/users/`+f.users["admin"]+`/b.png?thumb=1600x400"`)
	}

	f.set("climber", "follow_policy", "open")
	f.follow("hidden", "climber", http.StatusCreated)
	f.call("climber", "GET", "/climbers/"+f.users["hidden"], "", http.StatusOK, `"closed":true`, `"following":1`, `"follow":null`, `"sends_visible":false`)
	f.call("climber", "GET", "/climbers/"+f.users["climber"], "", http.StatusOK, `"followers":1`, `"sends_visible":true`)
	f.call("hidden", "GET", "/climbers/"+f.users["climber"], "", http.StatusOK, `"status":"accepted"`, `"sends_visible":true`)
	f.set("climber", "ticks_private", true)
	f.call("hidden", "GET", "/climbers/"+f.users["climber"], "", http.StatusOK, `"private":true`, `"sends_visible":false`)
}

func TestPendingRequestsOnlyOpenProfilesToTheFollowee(t *testing.T) {
	f := newFixture(t)
	f.follow("climber", "hidden", http.StatusCreated)
	f.set("hidden", "follow_policy", "closed")
	f.set("climber", "follow_policy", "closed")

	f.call("climber", "GET", "/climbers/"+f.users["hidden"], "", http.StatusNotFound)
	request := f.call("hidden", "GET", "/me/follows?direction=followers&status=pending", "", http.StatusOK)
	f.call("hidden", "GET", "/climbers/"+f.users["climber"], "", http.StatusOK)

	var pending []Follow
	json.Unmarshal([]byte(request), &pending)
	if len(pending) != 1 {
		t.Fatalf("pending = %s", request)
	}
	f.call("hidden", "POST", "/follows/"+pending[0].ID+"/accept", "", http.StatusOK)
	f.call("climber", "GET", "/climbers/"+f.users["hidden"], "", http.StatusOK, `"status":"accepted"`)
}

func TestClimberLookupsAreLimitedPerUser(t *testing.T) {
	f := newFixture(t)
	now := time.Now()
	for range climberLookupsPerMinute {
		f.module.lookups.Allow(f.users["climber"], now)
	}
	f.call("climber", "GET", "/climbers?ids=x", "", http.StatusTooManyRequests)
	f.call("setter", "GET", "/climbers?ids=x", "", http.StatusOK)
	if !f.module.lookups.Allow(f.users["climber"], now.Add(time.Minute)) {
		t.Error("window did not reset")
	}
}

func TestSearchNeedsThreeCharactersAndIsLimited(t *testing.T) {
	f := newFixture(t)
	f.rename("setter", "Sam", "Setter")
	f.call("climber", "GET", "/climbers?q=sa", "", http.StatusOK, `[]`)
	f.call("climber", "GET", "/climbers?q=sam", "", http.StatusOK, `"name":"Sam Setter"`)
	for range climberSearchesPerMinute {
		f.module.searches.Allow(f.users["climber"], time.Now())
	}
	f.call("climber", "GET", "/climbers?q=sam", "", http.StatusTooManyRequests)
	f.call("climber", "GET", "/climbers?ids="+f.users["setter"], "", http.StatusOK)
}

func TestFollowChangesAreLimitedPerUser(t *testing.T) {
	f := newFixture(t)
	for range followChangesPerHour {
		f.module.follows.Allow(f.users["climber"], time.Now())
	}
	f.follow("climber", "admin", http.StatusTooManyRequests)
	f.call("climber", "DELETE", "/follows/x", "", http.StatusTooManyRequests)
	f.follow("setter", "admin", http.StatusCreated)
}
