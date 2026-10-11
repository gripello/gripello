package audit

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform"
	"gripello/internal/platform/events"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/tenancy"
	"gripello/internal/platform/testapp"
)

type fixture struct {
	t         *testing.T
	app       *platform.App
	m         *module
	handler   http.Handler
	tokenKeys map[string]string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	app := testapp.App(t)
	Register(app)
	return &fixture{t: t, app: app, m: &module{db: app.DB, perms: tenancy.New(app.DB)}, handler: testapp.Handler(app), tokenKeys: map[string]string{}}
}

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.app.DB.Exec(context.Background(), sql, args...); err != nil {
		f.t.Fatal(err)
	}
}

func (f *fixture) count(sql string, args ...any) int {
	f.t.Helper()
	var n int
	if err := f.app.DB.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		f.t.Fatal(err)
	}
	return n
}

func (f *fixture) user(email string, platformAdmin bool) string {
	id, key := ids.New(), ids.New()+ids.New()
	f.exec(`INSERT INTO users (id, email, token_key, username, platform_admin) VALUES ($1, $2, $3, $4, $5)`, id, email, key, id, platformAdmin)
	f.tokenKeys[id] = key
	return id
}

func (f *fixture) gym(slug string) string {
	id := ids.New()
	f.exec(`INSERT INTO gyms (id, slug, name, active) VALUES ($1, $2, $2, true)`, id, slug)
	return id
}

func (f *fixture) member(user, gym string, permissions ...string) {
	permissions = append([]string{}, permissions...)
	role := ids.New()
	f.exec(`INSERT INTO roles (id, gym, name, permissions) VALUES ($1, $2, $3, $4)`, role, gym, role, permissions)
	f.exec(`INSERT INTO memberships (id, "user", gym, role) VALUES ($1, $2, $3, $4)`, ids.New(), user, gym, role)
}

// publish writes the event to the outbox and hands it to the consumer directly (the bus may deliver it too).
func (f *fixture) publish(topic, kind string, payload any, audience events.Audience) events.Event {
	f.t.Helper()
	return f.publishAs("", topic, kind, payload, audience)
}

func (f *fixture) publishAs(actor, topic, kind string, payload any, audience events.Audience) events.Event {
	f.t.Helper()
	ctx := context.Background()
	err := pgx.BeginFunc(ctx, f.app.DB, func(tx pgx.Tx) error { return events.PublishAs(ctx, tx, actor, topic, kind, payload, audience) })
	if err != nil {
		f.t.Fatal(err)
	}
	e, err := f.app.Bus.Since(ctx, 0, 100000)
	if err != nil {
		f.t.Fatal(err)
	}
	last := e[len(e)-1]
	f.m.onEvent(last)
	return last
}

type row struct {
	Actor, Label, Action, Collection, Record, Gym, IP string
	Changed                                           []string
}

func (f *fixture) rows() []row {
	f.t.Helper()
	rows, err := f.app.DB.Query(context.Background(), `SELECT COALESCE(actor, ''), actor_label, action, collection_name, record_id, COALESCE(gym, ''), ip, changed_fields
		FROM audit_logs ORDER BY created, id`)
	if err != nil {
		f.t.Fatal(err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (row, error) {
		var x row
		return x, r.Scan(&x.Actor, &x.Label, &x.Action, &x.Collection, &x.Record, &x.Gym, &x.IP, &x.Changed)
	})
	if err != nil {
		f.t.Fatal(err)
	}
	return out
}

func (f *fixture) get(url, caller string, status int) map[string]any {
	f.t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api"+url, nil)
	if caller != "" {
		token, _ := f.app.Tokens.Sign(caller, f.tokenKeys[caller], "")
		request.Header.Set("Authorization", token)
	}
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, request)
	if recorder.Code != status {
		f.t.Fatalf("GET %s = %d, want %d: %s", url, recorder.Code, status, recorder.Body)
	}
	var body map[string]any
	json.Unmarshal(recorder.Body.Bytes(), &body)
	return body
}

func TestRecordEventsBecomeOneRowEach(t *testing.T) {
	f := newFixture(t)
	gym := f.gym("north")
	alice := f.user("alice@example.com", false)
	f.member(alice, gym, "manage_users")

	f.publish("gym_changes:"+gym, "route.created", map[string]any{"collection": "routes", "action": "create", "record": map[string]any{"id": "route1"}}, events.Audience{Public: true})
	rating := map[string]any{"collection": "ratings", "action": "delete", "record": map[string]any{"id": "rating1", "user": alice}}
	f.publishAs(alice, "gym_changes:"+gym, "rating.deleted", rating, events.Audience{GuestsOnly: true})
	f.publish("gym_changes:"+gym, "rating.deleted", rating, events.Audience{SignedIn: true, NotUsers: []string{alice}})
	f.publish("gym_changes:"+gym, "rating.deleted", rating, events.Audience{Users: []string{alice}})
	f.publishAs(alice, "gym:"+gym, "membership.changed", map[string]any{"action": "updated", "id": "member1", "gym": gym, "actor": "ignored"}, events.Audience{GymPerm: gym + ":manage_users"})
	f.publish("gym:"+gym, "invite.changed", map[string]any{"action": "accepted", "id": "invite1", "gym": gym, "actor": alice}, events.Audience{})
	f.publish("user:"+alice, "user.updated", map[string]any{"record": map[string]any{"id": alice}, "changed": []string{"firstname"}}, events.Audience{Users: []string{alice}})
	f.publish("own_ticks", "tick.created", map[string]any{"action": "create", "record": map[string]any{"id": "tick1", "user": alice}}, events.Audience{Users: []string{alice}})
	f.publish("followed_ticks", "tick.created", map[string]any{"action": "create", "record": map[string]any{"id": "tick1", "user": alice}}, events.Audience{FollowersOf: alice})
	f.publish("tick.changed", "tick.created", map[string]any{"user": alice}, events.Audience{})
	f.publish("gym_changes:"+gym, "session.deleted", map[string]any{"collection": "sessions", "action": "delete", "record": map[string]any{"id": "s1"}}, events.Audience{Public: true})

	got := f.rows()
	want := []row{
		{Action: "create", Collection: "routes", Record: "route1", Gym: gym},
		{Actor: alice, Label: alice, Action: "delete", Collection: "ratings", Record: "rating1", Gym: gym},
		{Actor: alice, Label: alice, Action: "update", Collection: "memberships", Record: "member1", Gym: gym},
		{Actor: alice, Label: alice, Action: "update", Collection: "invites", Record: "invite1", Gym: gym},
		{Actor: alice, Label: "alice@example.com", Action: "update", Collection: "users", Record: alice, Changed: []string{"firstname"}},
		{Actor: alice, Label: "alice@example.com", Action: "create", Collection: "ticks", Record: "tick1"},
	}
	if len(got) != len(want) {
		t.Fatalf("rows = %+v, want %+v", got, want)
	}
	for i := range want {
		if strings.Join(got[i].Changed, ",") != strings.Join(want[i].Changed, ",") || got[i].Actor != want[i].Actor || got[i].Label != want[i].Label ||
			got[i].Action != want[i].Action || got[i].Collection != want[i].Collection || got[i].Record != want[i].Record || got[i].Gym != want[i].Gym {
			t.Errorf("row %d = %+v, want %+v", i, got[i], want[i])
		}
	}
	if got[0].Changed != nil {
		t.Errorf("create has changed_fields %v", got[0].Changed)
	}
}

func TestAuthEventsAreAuditedAndUnknownActionsSkipped(t *testing.T) {
	f := newFixture(t)
	alice := f.user("alice@example.com", true)
	f.publish("audit", "auth.login", map[string]any{"action": "login", "user": alice, "label": "alice@example.com", "ip": "10.0.0.1"}, events.Audience{})
	f.publish("audit", "auth.failed", map[string]any{"action": "login_failed", "label": "unknown:abcd", "ip": "10.0.0.2"}, events.Audience{})
	f.publish("audit", "auth.password_change", map[string]any{"action": "password_change", "user": alice}, events.Audience{})
	got := f.rows()
	if len(got) != 2 {
		t.Fatalf("rows = %+v", got)
	}
	if got[0].Actor != alice || got[0].Label != "alice@example.com" || got[0].Action != "login" || got[0].Collection != "users" || got[0].Record != alice || got[0].IP != "10.0.0.1" {
		t.Errorf("login row = %+v", got[0])
	}
	if got[1].Actor != "" || got[1].Label != "unknown:abcd" || got[1].Action != "login_failed" {
		t.Errorf("failed row = %+v", got[1])
	}
}

func TestPlatformAdminsWithoutMembershipAreLabelled(t *testing.T) {
	f := newFixture(t)
	gym := f.gym("north")
	operator := f.user("op@example.com", true)
	member := f.user("member-op@example.com", true)
	f.member(member, gym)
	climber := f.user("climber@example.com", false)
	f.publishAs(operator, "gym:"+gym, "role.changed", map[string]any{"action": "deleted", "id": "r1", "gym": gym}, events.Audience{})
	f.publish("gym:"+gym, "role.changed", map[string]any{"action": "deleted", "id": "r2", "gym": gym, "actor": member}, events.Audience{})
	f.publish("user:"+climber, "user.updated", map[string]any{"record": map[string]any{"id": climber}, "changed": []string{"name"}, "actor": operator}, events.Audience{})
	f.publish("user:"+operator, "user.updated", map[string]any{"record": map[string]any{"id": operator}, "changed": []string{"name"}}, events.Audience{})
	got := f.rows()
	labels := []string{platformLabel, member, platformLabel, "op@example.com"}
	for i, label := range labels {
		if got[i].Label != label {
			t.Errorf("row %d label = %q, want %q", i, got[i].Label, label)
		}
	}
	if got[0].Actor != operator || got[2].Actor != operator || got[2].Record != climber {
		t.Errorf("platform rows keep the actor: %+v", got)
	}
}

func TestDuplicateDeliveryAndDeletedReferences(t *testing.T) {
	f := newFixture(t)
	gym := f.gym("north")
	alice := f.user("alice@example.com", false)
	e := f.publish("gym:"+gym, "gym.deleted", map[string]any{"id": gym, "slug": "north", "actor": alice}, events.Audience{})
	f.m.onEvent(e)
	f.exec(`DELETE FROM gyms WHERE id = $1`, gym)
	f.exec(`DELETE FROM users WHERE id = $1`, alice)
	f.publish("gym:"+gym, "gym.deleted", map[string]any{"id": gym, "slug": "north", "actor": alice}, events.Audience{})
	got := f.rows()
	if len(got) != 2 {
		t.Fatalf("rows = %+v", got)
	}
	if got[1].Actor != "" || got[1].Gym != "" || got[1].Record != gym || got[1].Action != "delete" || got[1].Collection != "gyms" {
		t.Errorf("row with deleted references = %+v", got[1])
	}
}

func TestRetentionUsesSettingsOrDefault(t *testing.T) {
	f := newFixture(t)
	insert := func(age string) {
		f.exec(`INSERT INTO audit_logs (id, created, action) VALUES ($1, now() - $2::interval, 'login')`, ids.New(), age)
	}
	insert("100 days")
	insert("60 days")
	insert("5 days")
	if err := f.m.prune(context.Background()); err != nil {
		t.Fatal(err)
	}
	if n := f.count(`SELECT count(*) FROM audit_logs`); n != 2 {
		t.Errorf("default retention kept %d rows, want 2", n)
	}
	f.exec(`INSERT INTO settings (id, audit_retention_days) VALUES ('platformsetting', 30) ON CONFLICT (id) DO UPDATE SET audit_retention_days = 30`)
	if err := f.m.prune(context.Background()); err != nil {
		t.Fatal(err)
	}
	if n := f.count(`SELECT count(*) FROM audit_logs`); n != 1 {
		t.Errorf("30-day retention kept %d rows, want 1", n)
	}
}

func TestListingScopesAndFilters(t *testing.T) {
	f := newFixture(t)
	north, south := f.gym("north"), f.gym("south")
	auditor := f.user("auditor@example.com", false)
	f.member(auditor, north, "view_audit_log")
	climber := f.user("climber@example.com", false)
	f.member(climber, north)
	operator := f.user("op@example.com", true)
	write := func(gym, actor, label, action, collection, created string) {
		var actorArg any
		if actor != "" {
			actorArg = actor
		}
		f.exec(`INSERT INTO audit_logs (id, created, actor, actor_label, action, collection_name, record_id, gym)
			VALUES ($1, $2::timestamptz, $3, $4, $5, $6, 'rec', $7)`, ids.New(), created, actorArg, label, action, collection, gym)
	}
	write(north, climber, "climber@example.com", "create", "ratings", "2026-01-01 10:00:00Z")
	write(north, auditor, "auditor@example.com", "update", "routes", "2026-02-01 10:00:00Z")
	write(north, "", "", "create", "tasks", "2026-03-01 10:00:00Z")
	write(north, operator, platformLabel, "delete", "roles", "2026-04-01 10:00:00Z")
	write(south, climber, "climber@example.com", "create", "ratings", "2026-05-01 10:00:00Z")

	total := func(body map[string]any) int { return int(body["total"].(float64)) }
	f.get("/gyms/north/audit", "", http.StatusUnauthorized)
	f.get("/gyms/nowhere/audit", auditor, http.StatusNotFound)
	if n := total(f.get("/gyms/north/audit", auditor, http.StatusOK)); n != 4 {
		t.Errorf("auditor sees %d rows, want 4", n)
	}
	if n := total(f.get("/gyms/"+north+"/audit", climber, http.StatusOK)); n != 1 {
		t.Errorf("climber sees %d rows, want own 1", n)
	}
	if n := total(f.get("/gyms/south/audit", auditor, http.StatusOK)); n != 0 {
		t.Errorf("auditor sees %d rows of another gym", n)
	}
	if n := total(f.get("/gyms/south/audit", operator, http.StatusOK)); n != 1 {
		t.Errorf("platform admin sees %d rows of south, want 1", n)
	}
	for query, want := range map[string]int{
		"action=create":                 2,
		"collection=routes":             1,
		"actor=me":                      1,
		"actor=guest":                   1,
		"actor=platform":                1,
		"actor=" + climber:              1,
		"from=2026-02-01&to=2026-03-15": 2,
		"from=2026-02-01T00:00:00Z":     3,
		"q=AUDITOR":                     1,
		"q=tas":                         1,
		"limit=3&page=2":                4,
	} {
		body := f.get("/gyms/north/audit?"+query, auditor, http.StatusOK)
		if total(body) != want {
			t.Errorf("%s: total = %d, want %d", query, total(body), want)
		}
	}
	body := f.get("/gyms/north/audit?limit=3&page=2", auditor, http.StatusOK)
	items := body["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["collection_name"] != "ratings" {
		t.Errorf("page 2 = %v", items)
	}
	first := f.get("/gyms/north/audit?limit=1", auditor, http.StatusOK)["items"].([]any)[0].(map[string]any)
	if first["expand"].(map[string]any)["gym"].(map[string]any)["slug"] != "north" || first["action"] != "delete" {
		t.Errorf("newest entry = %v", first)
	}
	f.get("/gyms/north/audit?action=hack", auditor, http.StatusBadRequest)
	f.get("/gyms/north/audit?from=yesterday", auditor, http.StatusBadRequest)

	f.get("/me/audit", "", http.StatusUnauthorized)
	f.exec(`INSERT INTO audit_logs (id, actor, actor_label, action, collection_name, record_id) VALUES ($1, $2, 'climber@example.com', 'login', 'users', $2)`, ids.New(), climber)
	if n := total(f.get("/me/audit", climber, http.StatusOK)); n != 3 {
		t.Errorf("own audit = %d rows, want 3 across gyms incl. the gym-less login", n)
	}
	if n := total(f.get("/me/audit?action=login", climber, http.StatusOK)); n != 1 {
		t.Errorf("own logins = %d, want 1", n)
	}
	f.exec(`DELETE FROM audit_logs WHERE gym IS NULL`)

	f.get("/platform/audit", auditor, http.StatusForbidden)
	if n := total(f.get("/platform/audit", operator, http.StatusOK)); n != 5 {
		t.Errorf("platform audit = %d rows, want 5", n)
	}
	if n := total(f.get("/platform/audit?gym=south", operator, http.StatusOK)); n != 1 {
		t.Errorf("platform audit of south = %d rows, want 1", n)
	}
}

func TestNewRowsAreSentLiveToActorAuditorsAndPlatformAdmins(t *testing.T) {
	f := newFixture(t)
	gym := f.gym("north")
	alice := f.user("alice@example.com", false)
	operator := f.user("op@example.com", true)
	e := f.publishAs(alice, "gym:"+gym, "role.changed", map[string]any{"action": "deleted", "id": "r1", "gym": gym}, events.Audience{})
	f.m.onEvent(e)
	if n := f.count(`SELECT count(*) FROM events WHERE topic = 'audit_logs'`); n != 1 {
		t.Fatalf("%d live events, want 1 even after redelivery", n)
	}
	var payload struct {
		Action string `json:"action"`
		Record Entry  `json:"record"`
	}
	var audience events.Audience
	var raw, aud []byte
	f.app.DB.QueryRow(context.Background(), `SELECT payload, audience FROM events WHERE topic = 'audit_logs'`).Scan(&raw, &aud)
	json.Unmarshal(raw, &payload)
	json.Unmarshal(aud, &audience)
	if payload.Action != "create" || payload.Record.Actor != alice || payload.Record.CollectionName != "roles" || payload.Record.Expand == nil {
		t.Errorf("payload = %+v", payload)
	}
	if audience.GymPerm != gym+":view_audit_log" || !slices.Contains(audience.Users, alice) || !slices.Contains(audience.Users, operator) {
		t.Errorf("audience = %+v", audience)
	}
}

func TestTaskChangesAreAudited(t *testing.T) {
	f := newFixture(t)
	gym := f.gym("north")
	alice := f.user("alice@example.com", false)
	f.publishAs(alice, "tasks:"+gym, "task.updated", map[string]any{"action": "update", "record": map[string]any{"id": "task1", "gym": gym}}, events.Audience{})
	f.publishAs(alice, "tasks:"+gym, "task.deleted", map[string]any{"action": "delete", "record": map[string]any{"id": "task2"}}, events.Audience{})
	got := f.rows()
	if len(got) != 2 || got[0].Collection != "tasks" || got[0].Action != "update" || got[0].Record != "task1" || got[0].Gym != gym || got[0].Actor != alice ||
		got[1].Action != "delete" || got[1].Gym != gym {
		t.Errorf("rows = %+v", got)
	}
}

func TestDeletedAccountsKeepTheirLabel(t *testing.T) {
	f := newFixture(t)
	alice := f.user("alice@example.com", false)
	f.publishAs(alice, "audit", "auth.login", map[string]any{"action": "login", "user": alice, "label": "alice@example.com"}, events.Audience{})
	f.publishAs(alice, "user:"+alice, "user.updated", map[string]any{"record": map[string]any{"id": alice}, "changed": []string{"name"}}, events.Audience{})
	f.exec(`DELETE FROM users WHERE id = $1`, alice)
	f.publishAs(alice, "user:"+alice, "user.deleted", map[string]any{"id": alice}, events.Audience{})
	got := f.rows()
	if len(got) != 3 {
		t.Fatalf("rows = %+v", got)
	}
	for _, r := range got {
		if r.Actor != "" || r.Label != "alice@example.com" {
			t.Errorf("row of a deleted account = %+v", r)
		}
	}
	if got[2].Action != "delete" || got[2].Record != alice {
		t.Errorf("deletion row = %+v", got[2])
	}
}

func TestGymRowsNeverCarryTheEmail(t *testing.T) {
	f := newFixture(t)
	gym := f.gym("north")
	alice := f.user("alice@example.com", false)
	f.publishAs(alice, "audit", "auth.login", map[string]any{"action": "login", "user": alice, "label": "alice@example.com"}, events.Audience{})
	f.exec(`DELETE FROM users WHERE id = $1`, alice)
	f.publishAs(alice, "gym_changes:"+gym, "rating.deleted", map[string]any{"collection": "ratings", "action": "delete", "record": map[string]any{"id": "r1"}}, events.Audience{Public: true})
	got := f.rows()
	if len(got) != 2 || got[1].Gym != gym || got[1].Label != "" {
		t.Errorf("rows = %+v", got)
	}
}

func TestGymChangeUpdatesListChangedFields(t *testing.T) {
	f := newFixture(t)
	gym := f.gym("north")
	f.publish("gym_changes:"+gym, "route.updated", map[string]any{"collection": "routes", "action": "update", "record": map[string]any{"id": "r1"}, "changed": []string{"archived"}}, events.Audience{Public: true})
	f.publish("gym_changes:"+gym, "route.updated", map[string]any{"collection": "routes", "action": "update", "record": map[string]any{"id": "r2"}}, events.Audience{Public: true})
	got := f.rows()
	if len(got) != 2 || strings.Join(got[0].Changed, ",") != "archived" || got[1].Changed != nil {
		t.Errorf("rows = %+v", got)
	}
}
