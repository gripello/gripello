package notifications

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/jackc/pgx/v5"

	"gripello/internal/platform"
	"gripello/internal/platform/events"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/jobs"
	"gripello/internal/platform/locales"
	"gripello/internal/platform/push"
	"gripello/internal/platform/testapp"
)

func TestPrefsDefaultToOn(t *testing.T) {
	var none prefs
	if !none.wants(pushChannel, "task_assigned") {
		t.Error("no prefs muted a notification")
	}
	p := prefs{"push": {"tasks": false}, "email": {"new_routes": false}}
	if p.wants(pushChannel, "task_assigned") {
		t.Error("muted tasks topic still pushed")
	}
	if !p.wants(pushChannel, "report_filed") || !p.wants(pushChannel, "wall_new_routes") || !p.wants(pushChannel, "some_future_type") {
		t.Error("mute leaked into another topic, channel or untyped notification")
	}
}

// Every type the bell can show and every type a module emits needs a topic, or it can't be muted.
func TestEveryNotificationTypeHasATopic(t *testing.T) {
	messages := locales.Load(filepath.Join("..", "..", "..", "i18n", "locales"))
	if len(messages) == 0 {
		t.Fatal("i18n/locales not found")
	}
	types := map[string]bool{}
	for notificationType := range messages.Group("en", "notifications.center.types") {
		if !strings.HasSuffix(notificationType, "_gym") {
			types[notificationType] = true
		}
	}
	emitted := regexp.MustCompile(`\bType:\s+"([a-z]+_[a-z_]+)"`)
	sources, _ := filepath.Glob(filepath.Join("..", "*", "*.go"))
	for _, source := range sources {
		if strings.HasSuffix(source, "_test.go") {
			continue
		}
		code, _ := os.ReadFile(source)
		for _, match := range emitted.FindAllSubmatch(code, -1) {
			types[string(match[1])] = true
		}
	}
	for notificationType := range types {
		if topicOf(notificationType) == "" {
			t.Errorf("%s belongs to no topic", notificationType)
		}
		if messages.Lookup("en", "notifications.center.types."+notificationType) == "" {
			t.Errorf("%s has no bell/push text", notificationType)
		}
	}
}

func TestNotificationIDIsStablePerEventAndUser(t *testing.T) {
	a := notificationID(7, "u1")
	if !ids.Valid(a) || a != notificationID(7, "u1") || a == notificationID(8, "u1") || a == notificationID(7, "u2") {
		t.Errorf("id %q", a)
	}
}

type fixture struct {
	t       *testing.T
	app     *platform.App
	m       *module
	handler http.Handler
	gym     string
	users   map[string]string
	tokens  map[string]string
}

func newFixture(t *testing.T, pushEnabled bool) *fixture {
	t.Helper()
	app := testapp.App(t)
	if pushEnabled {
		private, public, err := webpush.GenerateVAPIDKeys()
		if err != nil {
			t.Fatal(err)
		}
		app.Push = push.New(public, private, "test@example.com")
	}
	Register(app)
	f := &fixture{t: t, app: app, m: &module{app: app}, handler: testapp.Handler(app), users: map[string]string{}, tokens: map[string]string{}}
	f.gym = f.exec(`INSERT INTO gyms (id, slug, name, active) VALUES ($1, 'alpha', 'Alpha', true) RETURNING id`, ids.New())
	f.user("climber")
	f.user("other")
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

func (f *fixture) user(name string) {
	f.t.Helper()
	id := f.exec(`INSERT INTO users (id, username, email, token_key) VALUES ($1, $2, $3, $4) RETURNING id`, ids.New(), name, name+"@example.com", "key-"+name)
	token, err := f.app.Tokens.Sign(id, "key-"+name, "")
	if err != nil {
		f.t.Fatal(err)
	}
	f.users[name], f.tokens[name] = id, token
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

func (f *fixture) count(sql string, args ...any) int {
	f.t.Helper()
	var n int
	if err := f.app.DB.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		f.t.Fatal(err)
	}
	return n
}

func (f *fixture) notify(n Notify) {
	f.t.Helper()
	err := pgx.BeginFunc(context.Background(), f.app.DB, func(tx pgx.Tx) error {
		return events.PublishAs(context.Background(), tx, "", TopicNotify, KindNotify, n, events.Audience{})
	})
	if err != nil {
		f.t.Fatal(err)
	}
}

func (f *fixture) subscribe(user, endpoint string) string {
	f.t.Helper()
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		f.t.Fatal(err)
	}
	secret := make([]byte, 16)
	rand.Read(secret)
	return f.exec(`INSERT INTO push_subscriptions (id, "user", endpoint, p256dh, auth) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		ids.New(), f.users[user], endpoint,
		base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()), base64.RawURLEncoding.EncodeToString(secret))
}

func (f *fixture) runPushJobs() {
	f.t.Helper()
	rows, err := f.app.DB.Query(context.Background(), `DELETE FROM jobs WHERE kind = $1 RETURNING id, kind, key, payload`, pushJob)
	if err != nil {
		f.t.Fatal(err)
	}
	queued, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (jobs.Job, error) {
		var j jobs.Job
		return j, row.Scan(&j.ID, &j.Kind, &j.Key, &j.Payload)
	})
	if err != nil {
		f.t.Fatal(err)
	}
	for _, job := range queued {
		if err := f.m.pushWorker(context.Background(), job); err != nil {
			f.t.Fatal(err)
		}
	}
}

func device(status int, pushed *atomic.Int32) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		pushed.Add(1)
		w.WriteHeader(status)
	}))
}

func TestNotifyEventStoresPublishesAndPushes(t *testing.T) {
	f := newFixture(t, true)
	var pushed atomic.Int32
	alive := device(http.StatusCreated, &pushed)
	defer alive.Close()
	gone := device(http.StatusGone, &pushed)
	defer gone.Close()
	f.subscribe("climber", alive.URL+"/a")
	f.subscribe("climber", gone.URL+"/b")

	f.notify(Notify{Type: "task_defect_fixed", Users: []string{f.users["climber"], "unknownuser0000"}, Gym: f.gym,
		Params: map[string]any{"route": "Crimp"}, URL: "/route?id=x"})
	testapp.WaitFor(t, func() bool { return f.count(`SELECT COUNT(*) FROM jobs WHERE kind = 'push'`) == 1 })

	body := f.call("climber", "GET", "/me/notifications", "", http.StatusOK)
	items := body["items"].([]any)
	if len(items) != 1 || body["total"] != float64(1) {
		t.Fatalf("notifications = %v", body)
	}
	item := items[0].(map[string]any)
	if item["type"] != "task_defect_fixed" || item["url"] != "/route?id=x" || item["read"] != false || item["params"].(map[string]any)["route"] != "Crimp" {
		t.Errorf("notification = %v", item)
	}
	var audience events.Audience
	var payload Change
	var raw, rawAudience []byte
	if err := f.app.DB.QueryRow(context.Background(), `SELECT payload, audience FROM events WHERE topic = $1`, TopicOwnNotifications).Scan(&raw, &rawAudience); err != nil {
		t.Fatal(err)
	}
	json.Unmarshal(raw, &payload)
	json.Unmarshal(rawAudience, &audience)
	if payload.Action != "create" || payload.Record.ID != item["id"] || len(audience.Users) != 1 || audience.Users[0] != f.users["climber"] {
		t.Errorf("own_notifications = %s %s", raw, rawAudience)
	}

	f.runPushJobs()
	if pushed.Load() != 2 {
		t.Errorf("pushes = %d", pushed.Load())
	}
	if n := f.count(`SELECT COUNT(*) FROM push_subscriptions`); n != 1 {
		t.Errorf("gone subscription kept, %d left", n)
	}
	if n := f.count(`SELECT COUNT(*) FROM events WHERE topic = $1 AND kind = 'push_subscription.delete'`, TopicPushSubscriptions); n != 1 {
		t.Errorf("gone subscription delete events = %d", n)
	}

	f.m.onNotify(events.Event{ID: 0, Kind: KindNotify})
	var lastID int64
	f.app.DB.QueryRow(context.Background(), `SELECT id FROM events WHERE topic = $1`, TopicNotify).Scan(&lastID)
	if err := f.m.deliver(context.Background(), lastID, Notify{Type: "task_defect_fixed", Users: []string{f.users["climber"]}}); err != nil {
		t.Fatal(err)
	}
	if n := f.count(`SELECT COUNT(*) FROM notifications`); n != 1 {
		t.Errorf("redelivered event stored again: %d rows", n)
	}
}

func TestMutedPushTopicStillLandsInTheBell(t *testing.T) {
	f := newFixture(t, true)
	var pushed atomic.Int32
	alive := device(http.StatusCreated, &pushed)
	defer alive.Close()
	f.subscribe("climber", alive.URL)
	f.call("climber", "PUT", "/me/notification-prefs", `{"push":{"tasks":false}}`, http.StatusOK)

	f.notify(Notify{Type: "task_assigned", Users: []string{f.users["climber"]}, Gym: f.gym})
	f.notify(Notify{Type: "task_defect_fixed", Users: []string{f.users["climber"]}, Gym: f.gym})
	testapp.WaitFor(t, func() bool { return f.count(`SELECT COUNT(*) FROM jobs WHERE kind = 'push'`) == 2 })
	f.runPushJobs()
	if pushed.Load() != 1 {
		t.Errorf("pushes = %d, want only the unmuted one", pushed.Load())
	}
	if n := f.count(`SELECT COUNT(*) FROM notifications`); n != 2 {
		t.Errorf("bell rows = %d", n)
	}
	got := f.call("climber", "GET", "/me/notification-prefs", "", http.StatusOK)
	if got["push"].(map[string]any)["tasks"] != false {
		t.Errorf("prefs = %v", got)
	}
	f.call("climber", "PUT", "/me/notification-prefs", `{"email":{"tasks":false}}`, http.StatusBadRequest)
	f.call("climber", "PUT", "/me/notification-prefs", `{"push":{"nope":false}}`, http.StatusBadRequest)
}

func TestPushDisabledQueuesNothing(t *testing.T) {
	f := newFixture(t, false)
	f.notify(Notify{Type: "task_assigned", Users: []string{f.users["climber"]}, Gym: f.gym})
	testapp.WaitFor(t, func() bool { return f.count(`SELECT COUNT(*) FROM notifications`) == 1 })
	if n := f.count(`SELECT COUNT(*) FROM jobs`); n != 0 {
		t.Errorf("jobs = %d", n)
	}
	settings := f.call("", "GET", "/notifications/settings", "", http.StatusOK)
	if settings["enabled"] != false || len(settings["topics"].([]any)) != len(topics) {
		t.Errorf("settings = %v", settings)
	}
}

func TestReadAndDeleteOwnNotifications(t *testing.T) {
	f := newFixture(t, false)
	insert := func(user string) string {
		return f.exec(`INSERT INTO notifications (id, "user", type) VALUES ($1, $2, 'task_assigned') RETURNING id`, ids.New(), f.users[user])
	}
	first, second, foreign := insert("climber"), insert("climber"), insert("other")

	f.call("", "GET", "/me/notifications", "", http.StatusUnauthorized)
	f.call("climber", "POST", "/me/notifications/read", `{"ids":["`+first+`","`+foreign+`"]}`, http.StatusNoContent)
	if body := f.call("climber", "GET", "/me/notifications?unread=true", "", http.StatusOK); body["total"] != float64(1) {
		t.Errorf("unread = %v", body)
	}
	if n := f.count(`SELECT COUNT(*) FROM notifications WHERE read`); n != 1 {
		t.Errorf("read rows = %d, foreign one must stay unread", n)
	}
	f.call("climber", "POST", "/me/notifications/read", `{"all":true}`, http.StatusNoContent)
	if n := f.count(`SELECT COUNT(*) FROM notifications WHERE read`); n != 2 {
		t.Errorf("read rows = %d", n)
	}
	if n := f.count(`SELECT COUNT(*) FROM events WHERE topic = $1 AND kind = 'notification.update' AND actor = $2`, TopicOwnNotifications, f.users["climber"]); n != 2 {
		t.Errorf("update events = %d", n)
	}
	f.call("climber", "DELETE", "/me/notifications/"+foreign, "", http.StatusNotFound)
	f.call("climber", "DELETE", "/me/notifications/"+second, "", http.StatusNoContent)
	if body := f.call("climber", "GET", "/me/notifications?limit=1", "", http.StatusOK); body["total"] != float64(1) || len(body["items"].([]any)) != 1 {
		t.Errorf("after delete = %v", body)
	}
}

func TestSubscriptionsAllowOnlyPushServicesAndMoveToTheLatestUser(t *testing.T) {
	f := newFixture(t, false)
	keys := `"p256dh":"BKey","auth":"secret"`
	f.call("climber", "POST", "/me/push-subscriptions", `{"endpoint":"https://127.0.0.1/api",`+keys+`}`, http.StatusBadRequest)
	f.call("climber", "POST", "/me/push-subscriptions", `{"endpoint":"https://fcm.googleapis.com/fcm/send/x"}`, http.StatusBadRequest)
	created := f.call("climber", "POST", "/me/push-subscriptions", `{"endpoint":"https://fcm.googleapis.com/fcm/send/x",`+keys+`,"device":"Pixel"}`, http.StatusCreated)
	f.call("other", "POST", "/me/push-subscriptions", `{"endpoint":"https://fcm.googleapis.com/fcm/send/x","p256dh":"BOther","auth":"guess"}`, http.StatusConflict)
	moved := f.call("other", "POST", "/me/push-subscriptions", `{"endpoint":"https://fcm.googleapis.com/fcm/send/x",`+keys+`}`, http.StatusCreated)
	if moved["id"] != created["id"] || moved["user"] != f.users["other"] || f.count(`SELECT COUNT(*) FROM push_subscriptions`) != 1 {
		t.Errorf("subscription not moved: %v", moved)
	}
	if body := f.call("climber", "GET", "/me/push-subscriptions", "", http.StatusOK); len(body["items"].([]any)) != 0 {
		t.Errorf("previous owner still lists it: %v", body)
	}
	if _, leaked := moved["p256dh"]; leaked {
		t.Error("keys returned")
	}
	f.call("climber", "DELETE", "/me/push-subscriptions/"+created["id"].(string), "", http.StatusNotFound)
	f.call("other", "DELETE", "/me/push-subscriptions/"+created["id"].(string), "", http.StatusNoContent)

	rows, err := f.app.DB.Query(context.Background(), `SELECT kind, audience->'users'->>0, actor FROM events WHERE topic = $1 ORDER BY id`, TopicPushSubscriptions)
	if err != nil {
		t.Fatal(err)
	}
	got, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (string, error) {
		var kind, user, actor string
		err := row.Scan(&kind, &user, &actor)
		return kind + ">" + user + "@" + actor, err
	})
	if err != nil {
		t.Fatal(err)
	}
	c, o := f.users["climber"], f.users["other"]
	want := []string{
		"push_subscription.create>" + c + "@" + c,
		"push_subscription.delete>" + c + "@" + o,
		"push_subscription.create>" + o + "@" + o,
		"push_subscription.delete>" + o + "@" + o,
	}
	if strings.Join(got, " ") != strings.Join(want, " ") {
		t.Errorf("push_subscriptions events =\n%v\nwant\n%v", got, want)
	}
}

func TestTestPushOnlyReachesTheCallersOwnDeviceAndIsLimited(t *testing.T) {
	f := newFixture(t, true)
	var pushed atomic.Int32
	server := device(http.StatusCreated, &pushed)
	defer server.Close()
	f.subscribe("climber", server.URL+"/mine")
	f.subscribe("other", server.URL+"/theirs")

	f.call("", "POST", "/me/push/test", `{"endpoint":"`+server.URL+`/mine"}`, http.StatusUnauthorized)
	f.call("climber", "POST", "/me/push/test", `{"endpoint":"`+server.URL+`/theirs"}`, http.StatusNotFound)
	f.call("climber", "POST", "/me/push/test", `{"endpoint":"`+server.URL+`/mine"}`, http.StatusNoContent)
	f.call("climber", "POST", "/me/push/test", `{"endpoint":"`+server.URL+`/mine"}`, http.StatusNoContent)
	f.call("climber", "POST", "/me/push/test", `{"endpoint":"`+server.URL+`/mine"}`, http.StatusTooManyRequests)
	if pushed.Load() != 2 {
		t.Errorf("pushes = %d", pushed.Load())
	}
}

func TestWallDigestNotifiesFollowersOncePerWall(t *testing.T) {
	f := newFixture(t, false)
	hall := f.exec(`INSERT INTO locations (id, gym, name) VALUES ($1, $2, 'Hall') RETURNING id`, ids.New(), f.gym)
	wall := f.exec(`INSERT INTO walls (id, gym, location, name, outline, edge) VALUES ($1, $2, $3, 'North', '[]', '[]') RETURNING id`, ids.New(), f.gym, hall)
	for _, name := range []string{"One", "Two", "Three"} {
		f.exec(`INSERT INTO routes (id, gym, name, grade, location, wall) VALUES ($1, $2, $3, '6a', $4, $5) RETURNING id`, ids.New(), f.gym, name, hall, wall)
	}
	f.exec(`UPDATE users SET followed_walls = ARRAY[$1] WHERE id = $2 RETURNING id`, wall, f.users["climber"])

	if err := f.m.notifyWallNewRoutes(context.Background(), time.Now().Add(wallDigestEvery)); err != nil {
		t.Fatal(err)
	}
	testapp.WaitFor(t, func() bool { return f.count(`SELECT COUNT(*) FROM notifications`) == 1 })
	var params map[string]any
	var url, user string
	f.app.DB.QueryRow(context.Background(), `SELECT params, url, "user" FROM notifications WHERE type = 'wall_new_routes'`).Scan(&params, &url, &user)
	if params["wall"] != "North" || params["count"] != float64(3) || url != "/alpha/map?wall="+wall || user != f.users["climber"] {
		t.Errorf("digest = %v %s %s", params, url, user)
	}

	if err := f.m.notifyWallNewRoutes(context.Background(), time.Now().Add(3*wallDigestEvery)); err != nil {
		t.Fatal(err)
	}
	if n := f.count(`SELECT COUNT(*) FROM events WHERE topic = $1`, TopicNotify); n != 1 {
		t.Errorf("later window repeated the digest: %d", n)
	}
}

func TestRetentionDropsOldReadAndAncientNotifications(t *testing.T) {
	f := newFixture(t, false)
	insert := func(age time.Duration, read bool) string {
		return f.exec(`INSERT INTO notifications (id, "user", type, read, created) VALUES ($1, $2, 'task_assigned', $3, $4) RETURNING id`,
			ids.New(), f.users["climber"], read, time.Now().Add(-age))
	}
	day := 24 * time.Hour
	keptUnread := insert(60*day, false)
	keptRead := insert(10*day, true)
	insert(31*day, true)
	insert(91*day, false)
	if err := f.m.pruneNotifications(context.Background()); err != nil {
		t.Fatal(err)
	}
	if n := f.count(`SELECT COUNT(*) FROM notifications WHERE id IN ($1, $2)`, keptUnread, keptRead); n != 2 || f.count(`SELECT COUNT(*) FROM notifications`) != 2 {
		t.Error("retention removed the wrong rows")
	}
}

func TestDeliveryRetriesWithBackoff(t *testing.T) {
	calls := 0
	failTwice := func() error {
		if calls++; calls < 3 {
			return errors.New("db down")
		}
		return nil
	}
	if err := withRetries(3, time.Millisecond, failTwice); err != nil || calls != 3 {
		t.Errorf("withRetries = %v after %d calls", err, calls)
	}
	calls = -10
	if err := withRetries(3, time.Millisecond, failTwice); err == nil || calls != -7 {
		t.Errorf("gave up = %v after %d calls, want 3", err, calls+10)
	}
}
