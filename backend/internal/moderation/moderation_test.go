package moderation

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform"
	"gripello/internal/platform/events"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/testapp"
)

type fixture struct {
	t       *testing.T
	app     *platform.App
	handler http.Handler
	users   map[string]string
	tokens  map[string]string
	gymA    string
	gymB    string
	route   string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	t.Setenv("CAP_SECRET", "")
	app := testapp.App(t)
	Register(app)
	f := &fixture{t: t, app: app, handler: testapp.Handler(app), users: map[string]string{}, tokens: map[string]string{}}
	f.gymA = f.exec(`INSERT INTO gyms (id, slug, name, active) VALUES ($1, 'alpha', 'Alpha', true) RETURNING id`, ids.New())
	f.gymB = f.exec(`INSERT INTO gyms (id, slug, name, active) VALUES ($1, 'beta', 'Beta', true) RETURNING id`, ids.New())
	f.user("setterA", f.gymA, "manage_comments", "manage_routes")
	f.user("adminA", f.gymA, "manage_comments", "manage_reports", "manage_users")
	f.user("setterB", f.gymB, "manage_comments")
	f.user("adminB", f.gymB, "manage_comments", "manage_reports")
	f.user("climber", "")
	f.user("operator", "")
	f.exec(`UPDATE users SET platform_admin = true WHERE id = $1 RETURNING id`, f.users["operator"])
	hall := f.exec(`INSERT INTO locations (id, gym, name) VALUES ($1, $2, 'Hall') RETURNING id`, ids.New(), f.gymA)
	f.route = f.exec(`INSERT INTO routes (id, gym, name, grade, color, location) VALUES ($1, $2, 'Crimp', '6a', 'red', $3) RETURNING id`,
		ids.New(), f.gymA, hall)
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

func (f *fixture) count(sql string, args ...any) int {
	f.t.Helper()
	var n int
	if err := f.app.DB.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return n
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

func (f *fixture) request(user, method, path, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, "/api"+path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if user != "" {
		request.Header.Set("Authorization", f.tokens[user])
	}
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, request)
	return recorder
}

func (f *fixture) call(user, method, path, body string, status int, contains ...string) map[string]any {
	f.t.Helper()
	recorder := f.request(user, method, path, body)
	if recorder.Code != status {
		f.t.Fatalf("%s %s as %q = %d, want %d: %s", method, path, user, recorder.Code, status, recorder.Body.String())
	}
	for _, part := range contains {
		if !strings.Contains(recorder.Body.String(), part) {
			f.t.Errorf("%s %s as %q: body lacks %s: %s", method, path, user, part, recorder.Body.String())
		}
	}
	out := map[string]any{}
	json.Unmarshal(recorder.Body.Bytes(), &out)
	return out
}

func (f *fixture) publish(topic, kind string, payload any, audience events.Audience) {
	f.t.Helper()
	err := pgx.BeginFunc(context.Background(), f.app.DB, func(tx pgx.Tx) error {
		return events.Publish(context.Background(), tx, topic, kind, payload, audience)
	})
	if err != nil {
		f.t.Fatal(err)
	}
}

// rating stores a review the way the ratings module does, including its rating.created event.
func (f *fixture) rating(user, comment string) string {
	f.t.Helper()
	id := f.exec(`INSERT INTO ratings (id, gym, route_id, "user", rating, comment) VALUES ($1, $2, $3, $4, 3, $5) RETURNING id`,
		ids.New(), f.gymA, f.route, f.users[user], comment)
	f.publish("rating.created", "rating.created", map[string]string{"id": id, "gym": f.gymA, "route": f.route, "user": f.users[user]}, events.Audience{})
	return id
}

func (f *fixture) beta(user, url, file string) string {
	f.t.Helper()
	id := f.exec(`INSERT INTO beta_videos (id, gym, route, "user", url, file) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		ids.New(), f.gymA, f.route, f.users[user], url, file)
	f.publish("beta.created", "beta.created", map[string]string{"id": id, "gym": f.gymA, "route": f.route, "user": f.users[user]}, events.Audience{})
	return id
}

func (f *fixture) editProfile(user, firstname string) {
	f.t.Helper()
	f.exec(`UPDATE users SET firstname = $2 WHERE id = $1 RETURNING id`, f.users[user], firstname)
	f.publish("user:"+f.users[user], "user.updated", map[string]any{"record": map[string]string{"id": f.users[user]}, "changed": []string{"firstname"}},
		events.Audience{Users: []string{f.users[user]}})
}

func (f *fixture) gymChange(kind, id string) {
	f.publish("gym_changes:"+f.gymA, kind, map[string]any{"record": map[string]string{"id": id}}, events.Audience{Public: true})
}

func (f *fixture) find(kind, contentID string) (Item, bool) {
	it, err := itemOf(context.Background(), f.app.DB, kind, contentID)
	return it, err == nil
}

func (f *fixture) item(kind, contentID string) Item {
	f.t.Helper()
	testapp.WaitFor(f.t, func() bool { _, ok := f.find(kind, contentID); return ok })
	it, _ := f.find(kind, contentID)
	return it
}

func (f *fixture) notifications(kind, user string) int {
	return f.count(`SELECT count(*) FROM events WHERE kind = 'notify' AND payload->>'type' = $1 AND payload->'users' ? $2`, kind, f.users[user])
}

func (f *fixture) report(contentType, contentID, reason string) string {
	f.t.Helper()
	body := `{"content_type":"` + contentType + `","content_id":"` + contentID + `","reason":"` + reason +
		`","explanation":"Bad","notifier_name":"Nora","notifier_email":"n@example.com","good_faith":true,"language":"de"}`
	return f.call("", "POST", "/reports", body, http.StatusCreated)["id"].(string)
}

func action(name string) string { return `{"action":"` + name + `","reason":"spam"}` }

func TestModerationQueuesAndHidesReviews(t *testing.T) {
	f := newFixture(t)
	silent := f.rating("setterB", "")
	rating := f.rating("climber", "buy pills")
	it := f.item("rating", rating)
	if _, ok := f.find("rating", silent); ok {
		t.Error("a rating without comment was queued")
	}
	if it.State != "unreviewed" || it.Gym != f.gymA || it.Author != f.users["climber"] {
		t.Fatalf("queued item = %+v", it)
	}
	url := "/moderation/" + it.ID

	f.call("climber", "POST", url, action("hide"), http.StatusNotFound)
	f.call("setterB", "POST", url, action("hide"), http.StatusNotFound)
	f.call("setterB", "GET", url, "", http.StatusNotFound)
	f.call("setterA", "GET", url, "", http.StatusOK)
	f.call("setterA", "POST", url, action("approve"), http.StatusOK, `"state":"approved"`)

	f.exec(`UPDATE ratings SET comment = 'buy more pills' WHERE id = $1 RETURNING id`, rating)
	f.gymChange("rating.updated", rating)
	testapp.WaitFor(t, func() bool { it, _ := f.find("rating", rating); return it.State == "unreviewed" })

	f.call("setterA", "POST", url, action("hide"), http.StatusOK, `"hidden_by":"gym"`)
	if f.count(`SELECT count(*) FROM events WHERE kind = $1 AND actor = $2`, KindContentHidden, f.users["setterA"]) != 1 {
		t.Error("the hide is not attributed to the moderator")
	}
	if f.count(`SELECT count(*) FROM ratings WHERE id = $1`, rating) != 0 {
		t.Error("hidden review is still public")
	}
	if f.count(`SELECT count(*) FROM events WHERE topic = $1 AND kind = 'rating.deleted'`, "gym_changes:"+f.gymA) != 1 {
		t.Error("hiding sent no rating.deleted gym change")
	}
	if f.count(`SELECT count(*) FROM events WHERE topic = 'moderation' AND kind = $1 AND payload->>'content_id' = $2`, KindContentHidden, rating) != 1 {
		t.Error("hiding sent no content.hidden event")
	}
	f.call("setterA", "POST", url, action("restore"), http.StatusOK, `"state":"approved"`)
	var comment, author string
	if err := f.app.DB.QueryRow(context.Background(), `SELECT comment, "user" FROM ratings WHERE id = $1`, rating).Scan(&comment, &author); err != nil ||
		comment != "buy more pills" || author != f.users["climber"] {
		t.Fatalf("restored review = %q by %q (%v)", comment, author, err)
	}

	f.call("operator", "POST", url, action("hide"), http.StatusOK, `"hidden_by":"platform"`)
	f.call("setterA", "POST", url, action("restore"), http.StatusForbidden)
	f.call("operator", "POST", url, action("restore"), http.StatusOK)

	f.exec(`DELETE FROM ratings WHERE id = $1 RETURNING id`, rating)
	f.gymChange("rating.deleted", rating)
	testapp.WaitFor(t, func() bool { _, ok := f.find("rating", rating); return !ok })
}

func TestModerationQuarantinesFiles(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	video := f.exec(`INSERT INTO beta_videos (id, gym, route, "user", file) VALUES ($1, $2, $3, $4, 'beta.mp4') RETURNING id`,
		ids.New(), f.gymA, f.route, f.users["climber"])
	if err := f.app.Blob.Put(ctx, "beta_videos/"+video+"/beta.mp4", strings.NewReader("video")); err != nil {
		t.Fatal(err)
	}
	f.publish("beta.created", "beta.created", map[string]string{"id": video}, events.Audience{})
	url := "/moderation/" + f.item("beta_video", video).ID

	f.call("setterA", "POST", url, action("hide"), http.StatusOK)
	hidden := f.item("beta_video", video)
	if len(hidden.Files) != 1 || !f.exists("moderation_items/"+hidden.ID+"/beta.mp4") || f.exists("beta_videos/"+video+"/beta.mp4") {
		t.Fatalf("quarantined files = %v", hidden.Files)
	}
	f.call("setterA", "POST", url, action("restore"), http.StatusOK)
	if f.count(`SELECT count(*) FROM beta_videos WHERE id = $1 AND file = 'beta.mp4'`, video) != 1 || !f.exists("beta_videos/"+video+"/beta.mp4") {
		t.Fatal("restored beta lost its file")
	}
	if settled := f.item("beta_video", video); len(settled.Files) != 0 || f.exists("moderation_items/"+settled.ID+"/beta.mp4") {
		t.Errorf("restore left quarantined files: %v", settled.Files)
	}
}

func (f *fixture) exists(key string) bool {
	r, err := f.app.Blob.Open(context.Background(), key)
	if err != nil {
		return false
	}
	defer r.Close()
	_, err = io.ReadAll(r)
	return err == nil
}

func TestModerationOfProfilesIsPlatformOnly(t *testing.T) {
	f := newFixture(t)
	f.editProfile("climber", "Rude")
	url := "/moderation/" + f.item("profile", f.users["climber"]).ID

	f.call("adminA", "POST", url, action("hide"), http.StatusNotFound)
	f.call("operator", "POST", url, action("hide"), http.StatusOK)
	if f.count(`SELECT count(*) FROM users WHERE id = $1 AND firstname = '' AND username = 'climber_' || id`, f.users["climber"]) != 1 {
		t.Error("hidden profile kept its name")
	}
	f.call("operator", "POST", url, action("restore"), http.StatusOK)
	if f.count(`SELECT count(*) FROM users WHERE id = $1 AND firstname = 'Rude' AND username = 'climber'`, f.users["climber"]) != 1 {
		t.Error("restored profile lost its name")
	}
}

func TestPendingBetaNeedsTheGym(t *testing.T) {
	f := newFixture(t)
	f.exec(`INSERT INTO moderation_items (id, gym, content_type, content_id, author, state, snapshot) VALUES ($1, $2, 'beta_video', 'pendingbeta0001', $3, 'pending', $4) RETURNING id`,
		"pendingitem0001", f.gymA, f.users["climber"], map[string]any{"gym": f.gymA, "route": f.route, "url": "https://youtube.com/shorts/1"})
	url := "/moderation/pendingitem0001"

	f.call("operator", "POST", url, action("approve"), http.StatusForbidden)
	f.call("operator", "POST", url, action("hide"), http.StatusOK, `"hidden_by":"platform"`)
	f.call("operator", "POST", url, action("restore"), http.StatusOK, `"state":"pending"`)
	if f.count(`SELECT count(*) FROM beta_videos WHERE id = 'pendingbeta0001'`) != 0 {
		t.Fatal("restoring a pending upload published it")
	}
	f.call("setterA", "POST", url, action("approve"), http.StatusOK, `"state":"approved"`)
	if f.count(`SELECT count(*) FROM beta_videos WHERE id = 'pendingbeta0001' AND "user" = $1`, f.users["climber"]) != 1 {
		t.Fatal("approved beta missing")
	}
}

func TestReportsRaiseTheQueue(t *testing.T) {
	f := newFixture(t)
	rating := f.rating("climber", "spam")
	f.call("setterA", "POST", "/moderation/"+f.item("rating", rating).ID, action("approve"), http.StatusOK)
	f.report("rating", rating, "spam_fraud")
	f.report("rating", rating, "spam_fraud")
	if it := f.item("rating", rating); it.ReportsCount != 2 || it.State != "unreviewed" {
		t.Errorf("reported item = %d reports, %s", it.ReportsCount, it.State)
	}

	profileReport := f.report("profile", f.users["climber"], "harassment")
	var gym *string
	var link string
	f.app.DB.QueryRow(context.Background(), `SELECT gym, content_url FROM reports WHERE id = $1`, profileReport).Scan(&gym, &link)
	if gym != nil || link != "/climber?id="+f.users["climber"] {
		t.Errorf("profile report gym = %v, url = %q", gym, link)
	}
	f.call("operator", "GET", "/platform/reports", "", http.StatusOK, profileReport)
	if body := f.request("adminA", "GET", "/gyms/alpha/reports", "").Body.String(); strings.Contains(body, profileReport) || !strings.Contains(body, rating) {
		t.Errorf("gym reports = %s", body)
	}
	f.call("setterA", "GET", "/gyms/alpha/reports", "", http.StatusForbidden)
	f.call("adminA", "GET", "/platform/reports", "", http.StatusForbidden)
}

func TestReportsAreValidatedAndAcknowledged(t *testing.T) {
	f := newFixture(t)
	rating := f.rating("climber", "rude")
	f.call("", "POST", "/reports", `{"content_type":"rating","content_id":"`+rating+`","reason":"spam_fraud","explanation":"x","notifier_name":"N","notifier_email":"nope","good_faith":true}`, http.StatusBadRequest, "notifier_email")
	f.call("", "POST", "/reports", `{"content_type":"rating","content_id":"`+rating+`","reason":"spam_fraud","explanation":"x","notifier_name":"N","notifier_email":"n@example.com"}`, http.StatusBadRequest, "good_faith")
	f.call("", "POST", "/reports", `{"content_type":"task","content_id":"`+rating+`","reason":"spam_fraud","explanation":"x","notifier_name":"N","notifier_email":"n@example.com","good_faith":true}`, http.StatusBadRequest)

	report := f.report("rating", rating, "harassment")
	testapp.WaitFor(t, func() bool {
		return f.count(`SELECT count(*) FROM reports WHERE id = $1 AND receipt_sent`, report) == 1
	})
	var receipt, alert bool
	for _, m := range testapp.Mails(f.app) {
		receipt = receipt || slices.Contains(m.To, "n@example.com")
		alert = alert || slices.Contains(m.To, "adminA@example.com")
	}
	if !receipt || !alert {
		t.Errorf("receipt sent %v, alert sent %v", receipt, alert)
	}
	if f.notifications("report_filed", "adminA") != 1 || f.notifications("report_filed", "setterA") != 0 {
		t.Error("report_filed went to the wrong people")
	}
	var snapshot, link string
	f.app.DB.QueryRow(context.Background(), `SELECT content_snapshot, content_url FROM reports WHERE id = $1`, report).Scan(&snapshot, &link)
	if snapshot != "rude" || link != "/route?id="+f.route+"#comment-"+rating {
		t.Errorf("report snapshot %q, url %q", snapshot, link)
	}
	other := f.report("rating", rating, "other")
	if f.count(`SELECT count(*) FROM events WHERE kind = 'notify' AND payload->>'type' = 'report_filed_platform'`) != 1 {
		t.Errorf("reason other escalated to the platform (%s)", other)
	}
}

func TestRemovingReportedContentHidesIt(t *testing.T) {
	f := newFixture(t)
	rating := f.rating("climber", "hate")
	report := f.report("rating", rating, "hate_speech")
	if f.notifications("report_filed_platform", "operator") != 1 {
		t.Error("platform admin got no escalation")
	}
	url := "/moderation/" + f.item("rating", rating).ID
	removal := `{"action":"hide","reason":"hate speech"}`

	f.call("adminB", "POST", url, removal, http.StatusNotFound)
	f.call("adminA", "POST", url, removal, http.StatusOK)
	if f.count(`SELECT count(*) FROM ratings WHERE id = $1`, rating) != 0 {
		t.Error("removed review is still public")
	}
	if it := f.item("rating", rating); it.State != "hidden" || it.Reason != "hate speech" || it.ReviewedBy != f.users["adminA"] {
		t.Errorf("hidden item = %+v", it)
	}
	if f.count(`SELECT count(*) FROM reports WHERE id = $1 AND status = 'actioned' AND decision = 'content_removed'`, report) != 1 {
		t.Error("report not actioned")
	}
	if f.notifications("content_hidden", "climber") != 1 {
		t.Error("author not informed")
	}
	testapp.WaitFor(t, func() bool {
		return f.count(`SELECT count(*) FROM reports WHERE id = $1 AND notified_at IS NOT NULL`, report) == 1
	})
}

func TestPremoderatedUploadsWaitForTheGym(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	video := ids.New()
	staged := "moderation_items/" + video + "/beta.mp4"
	if err := f.app.Blob.Put(ctx, staged, strings.NewReader("video")); err != nil {
		t.Fatal(err)
	}
	f.publish("beta.pending", "beta.pending", map[string]string{"id": video, "gym": f.gymA, "route": f.route, "user": f.users["climber"], "file": "beta.mp4", "file_key": staged}, events.Audience{})
	pending := f.item("beta_video", video)
	testapp.WaitFor(t, func() bool { return !f.exists(staged) })
	if pending.State != "pending" || len(pending.Files) != 1 || !f.exists("moderation_items/"+pending.ID+"/beta.mp4") || f.exists("beta_videos/"+video+"/beta.mp4") {
		t.Fatalf("held upload = %+v", pending)
	}
	if f.count(`SELECT count(*) FROM beta_videos`) != 0 {
		t.Fatal("a held upload was published")
	}
	if f.notifications("moderation_pending", "setterA") != 1 {
		t.Error("gym staff got no pending notice")
	}
	f.call("setterA", "POST", "/moderation/"+pending.ID, action("approve"), http.StatusOK)
	if f.count(`SELECT count(*) FROM beta_videos WHERE id = $1 AND "user" = $2 AND gym = $3 AND file = 'beta.mp4'`, video, f.users["climber"], f.gymA) != 1 ||
		!f.exists("beta_videos/"+video+"/beta.mp4") {
		t.Fatal("approved upload missing")
	}
	if f.notifications("beta_approved", "climber") != 1 {
		t.Error("author got no approval notice")
	}
	if f.count(`SELECT count(*) FROM events WHERE topic = 'beta.created'`) != 1 || f.count(`SELECT count(*) FROM events WHERE kind = 'beta.created' AND topic LIKE 'gym_changes:%'`) != 2 {
		t.Error("approval sent no beta.created events")
	}
	if it := f.item("beta_video", video); it.State != "approved" {
		t.Errorf("the beta.created event reopened the case: %s", it.State)
	}
}

func TestRejectedUploadsAreDropped(t *testing.T) {
	f := newFixture(t)
	video := ids.New()
	f.publish("beta.pending", "beta.pending", map[string]string{"id": video, "gym": f.gymA, "route": f.route, "user": f.users["climber"], "url": "https://youtube.com/shorts/2"}, events.Audience{})
	url := "/moderation/" + f.item("beta_video", video).ID
	f.call("setterA", "POST", url, `{"action":"reject"}`, http.StatusBadRequest)
	f.call("operator", "POST", url, action("reject"), http.StatusForbidden)
	f.call("setterA", "POST", url, action("reject"), http.StatusOK)
	if _, ok := f.find("beta_video", video); ok || f.notifications("beta_rejected", "climber") != 1 {
		t.Error("rejected upload kept or author not told")
	}
}

func TestQuarantineExpires(t *testing.T) {
	f := newFixture(t)
	old := f.exec(`INSERT INTO moderation_items (id, gym, content_type, content_id, state, reviewed_at) VALUES ($1, $2, 'rating', 'oldrating000001', 'hidden', now() - interval '181 days') RETURNING id`, ids.New(), f.gymA)
	recent := f.exec(`INSERT INTO moderation_items (id, gym, content_type, content_id, state, reviewed_at) VALUES ($1, $2, 'rating', 'newrating000001', 'hidden', now() - interval '1 day') RETURNING id`, ids.New(), f.gymA)
	m := &module{app: f.app}
	if err := m.pruneQuarantine(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.count(`SELECT count(*) FROM moderation_items WHERE id = $1`, old) != 0 || f.count(`SELECT count(*) FROM moderation_items WHERE id = $1`, recent) != 1 {
		t.Error("retention pruned the wrong items")
	}
}

func TestDecisionsCloseReports(t *testing.T) {
	f := newFixture(t)
	rating := f.rating("climber", "rude")
	first, second := f.report("rating", rating, "harassment"), f.report("rating", rating, "harassment")
	url := "/moderation/" + f.item("rating", rating).ID

	f.call("setterA", "POST", url, `{"action":"hide","reason":"  "}`, http.StatusBadRequest)
	f.call("setterA", "POST", url, `{"action":"approve"}`, http.StatusOK)
	for _, report := range []string{first, second} {
		if f.count(`SELECT count(*) FROM reports WHERE id = $1 AND status = 'rejected' AND decision = 'content_kept' AND decided_by = $2`, report, f.users["setterA"]) != 1 {
			t.Errorf("report %s not kept", report)
		}
	}
	if f.notifications("report_decided_kept", "adminA") != 2 {
		t.Error("report handlers not told about the decision")
	}

	third := f.report("rating", rating, "harassment")
	f.call("setterA", "POST", url, action("hide"), http.StatusOK)
	if f.count(`SELECT count(*) FROM reports WHERE id = $1 AND status = 'actioned' AND decision_reason = 'spam'`, third) != 1 {
		t.Error("hidden report not actioned")
	}
	testapp.WaitFor(t, func() bool { return f.count(`SELECT count(*) FROM reports WHERE notified_at IS NOT NULL`) == 3 })
}

func TestInboxContextAndSummary(t *testing.T) {
	f := newFixture(t)
	rating := f.rating("climber", "spam")
	f.report("rating", rating, "spam_fraud")
	url := "/moderation/" + f.item("rating", rating).ID
	f.call("setterA", "GET", url, "", http.StatusOK,
		`"route":{"id":"`+f.route+`","name":"Crimp"`, `"reason":"spam_fraud","explanation":"","notifier_name":""`, `"history":{"items":1,"hidden":0}`, `"gym_name":"Alpha"`)
	f.call("adminA", "GET", url, "", http.StatusOK, `"explanation":"Bad","notifier_name":"Nora"`)
	f.call("setterA", "GET", "/moderation/summary?gym="+f.gymA, "", http.StatusOK, `"decide":1`)
	f.call("setterB", "GET", "/moderation/summary?gym="+f.gymA, "", http.StatusForbidden)
	f.call("setterA", "GET", "/moderation/summary", "", http.StatusForbidden)
	f.call("operator", "GET", "/moderation/summary", "", http.StatusOK, `"legal_reports":1`, `"open":1`)

	list := f.call("setterA", "GET", "/moderation/cases?gym=alpha&state=unreviewed", "", http.StatusOK)
	if items, _ := list["items"].([]any); len(items) != 1 {
		t.Errorf("inbox = %v", list)
	}
	latest := f.rating("adminA", "latest")
	f.item("rating", latest)
	newest := f.call("setterA", "GET", "/moderation/cases?gym=alpha&sort=newest&limit=1&total=true", "", http.StatusOK)
	if items, _ := newest["items"].([]any); len(items) != 1 || items[0].(map[string]any)["content_id"] != latest || newest["total"] != float64(2) {
		t.Errorf("newest page = %v", newest)
	}
	if _, ok := list["total"]; ok {
		t.Error("total sent without total=true")
	}
	f.call("setterA", "GET", "/moderation/cases?gym=alpha&sort=author", "", http.StatusBadRequest)
	f.call("setterA", "GET", "/moderation/cases", "", http.StatusForbidden)
	f.call("setterB", "GET", "/moderation/cases?gym=alpha", "", http.StatusForbidden)
	f.call("setterA", "GET", "/moderation/cases?gym=nosuchgym", "", http.StatusNotFound)
	if items := f.call("operator", "GET", "/moderation/cases?gym=nosuchgym", "", http.StatusOK)["items"].([]any); len(items) != 0 {
		t.Errorf("unknown gym filter listed %d cases", len(items))
	}
	f.call("operator", "GET", "/moderation/cases?queue=platform&state=unreviewed", "", http.StatusOK, rating)
	if f.count(`SELECT count(*) FROM events WHERE topic = $1 AND audience->'users' ? $2`, "moderation:"+f.gymA, f.users["operator"]) == 0 || f.count(`SELECT count(*) FROM events WHERE topic = 'moderation:platform' AND audience->'users' ? $1`, f.users["operator"]) == 0 {
		t.Error("inbox got no realtime events")
	}
}

func TestHidingAllContentOfAnAuthor(t *testing.T) {
	f := newFixture(t)
	rating := f.rating("climber", "buy now")
	f.item("rating", rating)
	video := f.exec(`INSERT INTO beta_videos (id, gym, route, "user", url) VALUES ($1, $2, $3, $4, 'https://youtube.com/shorts/9') RETURNING id`,
		ids.New(), f.gymA, f.route, f.users["climber"])
	hide := "/moderation/authors/" + f.users["climber"] + "/hide"

	f.call("adminA", "POST", hide, `{"reason":"spam"}`, http.StatusForbidden)
	f.call("operator", "POST", hide, `{"reason":""}`, http.StatusBadRequest)
	f.call("operator", "POST", hide, `{"reason":"spam"}`, http.StatusOK, `"hidden":2`)
	if f.count(`SELECT count(*) FROM ratings WHERE id = $1`, rating)+f.count(`SELECT count(*) FROM beta_videos WHERE id = $1`, video) != 0 {
		t.Error("content is still public")
	}
	if f.notifications("content_hidden", "climber") != 1 {
		t.Error("author should get one hide notice for the whole batch")
	}
}

func TestReportedRoutesAreArchivedOnHide(t *testing.T) {
	f := newFixture(t)
	f.report("route", f.route, "ip_infringement")
	url := "/moderation/" + f.item("route", f.route).ID
	f.call("setterA", "POST", url, action("hide"), http.StatusOK)
	if f.count(`SELECT count(*) FROM routes WHERE id = $1 AND archived AND archived_at IS NOT NULL`, f.route) != 1 {
		t.Error("hidden route stays on the wall")
	}
	if f.count(`SELECT count(*) FROM events WHERE topic = 'route.archived'`) != 1 || f.count(`SELECT count(*) FROM events WHERE kind = 'route.updated'`) != 1 {
		t.Error("archiving sent no route events")
	}
	f.call("setterA", "POST", url, action("restore"), http.StatusOK)
	if f.count(`SELECT count(*) FROM routes WHERE id = $1 AND NOT archived AND archived_at IS NULL`, f.route) != 1 {
		t.Error("restored route stays archived")
	}
}

func TestAnonymousReviewersStayAnonymousToGymStaff(t *testing.T) {
	f := newFixture(t)
	f.exec(`UPDATE users SET reviews_anonymous = true WHERE id = $1 RETURNING id`, f.users["climber"])
	rating := f.rating("climber", "meh")
	url := "/moderation/" + f.item("rating", rating).ID
	if body := f.request("setterA", "GET", url, "").Body.String(); strings.Contains(body, f.users["climber"]) {
		t.Errorf("gym staff learn the anonymous author: %s", body)
	}
	f.call("operator", "GET", url, "", http.StatusOK, `"author":{"id":"`+f.users["climber"]+`"`)
}

func TestOpeningACaseForOlderContent(t *testing.T) {
	f := newFixture(t)
	rating := f.exec(`INSERT INTO ratings (id, gym, route_id, "user", comment) VALUES ($1, $2, $3, $4, 'old') RETURNING id`,
		ids.New(), f.gymA, f.route, f.users["climber"])
	body := `{"content_type":"rating","content_id":"` + rating + `"}`

	f.call("setterB", "POST", "/moderation/cases", body, http.StatusNotFound)
	f.call("climber", "POST", "/moderation/cases", body, http.StatusNotFound)
	f.call("setterA", "POST", "/moderation/cases", `{"content_type":"seasons","content_id":"x"}`, http.StatusBadRequest)
	f.call("setterA", "POST", "/moderation/cases", body, http.StatusOK, `"state":"unreviewed"`)
	opened := f.item("rating", rating)
	f.call("operator", "POST", "/moderation/cases", body, http.StatusOK, `"id":"`+opened.ID+`"`)

	task := f.exec(`INSERT INTO tasks (id, gym, kind, priority, status, route, description, reporter) VALUES ($1, $2, 'defect', 2, 'open', $3, 'insult', $4) RETURNING id`,
		ids.New(), f.gymA, f.route, f.users["climber"])
	url := "/moderation/" + f.call("setterA", "POST", "/moderation/cases", `{"content_type":"task","content_id":"`+task+`"}`, http.StatusOK)["id"].(string)
	f.call("setterA", "POST", url, action("hide"), http.StatusOK)
	if f.count(`SELECT count(*) FROM tasks WHERE id = $1 AND description = ''`, task) != 1 {
		t.Error("hidden task kept its description")
	}
}

func TestLongReviewsStillGetACase(t *testing.T) {
	f := newFixture(t)
	rating := f.rating("climber", strings.Repeat("<&", 2500))
	it := f.item("rating", rating)
	if _, ok := it.Snapshot["user"]; ok {
		t.Error("snapshot keeps the author")
	}
	f.call("setterA", "POST", "/moderation/"+it.ID, action("hide"), http.StatusOK)
	f.call("setterA", "POST", "/moderation/"+it.ID, action("restore"), http.StatusOK)
	if f.count(`SELECT count(*) FROM ratings WHERE id = $1 AND "user" = $2`, rating, f.users["climber"]) != 1 {
		t.Error("restored review lost its author")
	}
}

func TestEditingHiddenContentReopensTheCase(t *testing.T) {
	f := newFixture(t)
	f.editProfile("climber", "Rude")
	it := f.item("profile", f.users["climber"])
	f.call("operator", "POST", "/moderation/"+it.ID, action("hide"), http.StatusOK)
	if state := f.item("profile", f.users["climber"]).State; state != "hidden" {
		t.Fatalf("hiding reopened the case: %s", state)
	}
	f.editProfile("climber", "Ruder")
	testapp.WaitFor(t, func() bool {
		reopened, _ := f.find("profile", f.users["climber"])
		return reopened.State == "unreviewed" && reopened.HiddenBy == ""
	})
}

func TestReportsAlwaysGetADecision(t *testing.T) {
	f := newFixture(t)
	f.call("", "POST", "/reports", `{"content_type":"rating","content_id":"missing00000000","reason":"spam_fraud","explanation":"x","notifier_name":"N","notifier_email":"n@example.com","good_faith":true}`,
		http.StatusBadRequest, "does not exist")

	rating := f.rating("climber", "gone soon")
	f.report("rating", rating, "spam_fraud")
	f.exec(`DELETE FROM ratings WHERE id = $1 RETURNING id`, rating)
	f.gymChange("rating.deleted", rating)
	testapp.WaitFor(t, func() bool {
		return f.count(`SELECT count(*) FROM reports WHERE content_id = $1 AND status = 'actioned'`, rating) == 1
	})

	f.editProfile("climber", "Rude")
	f.call("operator", "POST", "/moderation/"+f.item("profile", f.users["climber"]).ID, action("hide"), http.StatusOK)
	f.report("profile", f.users["climber"], "spam_fraud")
	if f.count(`SELECT count(*) FROM reports WHERE content_id = $1 AND status = 'open'`, f.users["climber"]) != 0 {
		t.Error("a report on hidden content stayed open")
	}
}

func TestOnlyThePlatformFiltersCasesByAuthor(t *testing.T) {
	f := newFixture(t)
	f.item("rating", f.rating("climber", "x"))
	f.call("setterA", "GET", "/moderation/cases?gym=alpha&author="+f.users["climber"], "", http.StatusForbidden)
	list := f.call("operator", "GET", "/moderation/cases?author="+f.users["climber"], "", http.StatusOK)
	if items, _ := list["items"].([]any); len(items) != 1 {
		t.Errorf("author cases = %v", list)
	}
}

func TestConcurrentDecisionsApplyOnce(t *testing.T) {
	f := newFixture(t)
	f.editProfile("climber", "Rude")
	it := f.item("profile", f.users["climber"])
	codes := make(chan int, 2)
	var wait sync.WaitGroup
	for range 2 {
		wait.Go(func() { codes <- f.request("operator", "POST", "/moderation/"+it.ID, action("hide")).Code })
	}
	wait.Wait()
	close(codes)
	var results []int
	for code := range codes {
		results = append(results, code)
	}
	slices.Sort(results)
	if !slices.Equal(results, []int{http.StatusOK, http.StatusForbidden}) {
		t.Fatalf("concurrent hides answered %v, want one success and one refusal", results)
	}
	if hidden := f.item("profile", f.users["climber"]); hidden.Snapshot["firstname"] != "Rude" {
		t.Errorf("the losing request overwrote the quarantine: %v", hidden.Snapshot["firstname"])
	}
	if f.notifications("content_hidden", "climber") != 1 {
		t.Error("author should get one hide notice")
	}
}

func (f *fixture) hiddenCase(kind, contentID string) {
	f.t.Helper()
	f.exec(`INSERT INTO moderation_items (id, gym, content_type, content_id, snapshot, files, state, hidden_by)
		VALUES ($1, $2, $3, $4, '{}', '{}', 'hidden', 'platform') RETURNING id`, ids.New(), f.gymA, kind, contentID)
}

func (f *fixture) entry() string {
	f.t.Helper()
	location := f.exec(`SELECT location FROM routes WHERE id = $1`, f.route)
	competition := f.exec(`INSERT INTO competitions (id, gym, name, location, status, starts_at, ends_at, scoring_format, discipline)
		VALUES ($1, $2, 'Jam', $3, 'open', now(), now() + interval '1 hour', 'dynamic', 'boulder') RETURNING id`, ids.New(), f.gymA, location)
	category := f.exec(`INSERT INTO competition_categories (id, competition, name) VALUES ($1, $2, 'Open') RETURNING id`, ids.New(), competition)
	return f.exec(`INSERT INTO competition_entries (id, competition, "user", category, display_name, birth_year, status)
		VALUES ($1, $2, $3, $4, 'Rude', 1990, 'registered') RETURNING id`, ids.New(), competition, f.users["climber"], category)
}

func TestContentShownAgainIsHiddenAgain(t *testing.T) {
	f := newFixture(t)
	f.hiddenCase("route", f.route)
	f.gymChange("route.updated", f.route)
	testapp.WaitFor(t, func() bool { return f.count(`SELECT count(*) FROM routes WHERE id = $1 AND archived`, f.route) == 1 })

	task := f.exec(`INSERT INTO tasks (id, gym, kind, priority, status, route, description, photo, reporter)
		VALUES ($1, $2, 'defect', 2, 'open', $3, 'insult', 'p.png', $4) RETURNING id`, ids.New(), f.gymA, f.route, f.users["climber"])
	if err := f.app.Blob.Put(context.Background(), "tasks/"+task+"/p.png", strings.NewReader("x")); err != nil {
		t.Fatal(err)
	}
	f.hiddenCase("task", task)
	f.publish("tasks:"+f.gymA, "task.updated", map[string]any{"action": "update", "record": map[string]string{"id": task}}, events.Audience{})
	testapp.WaitFor(t, func() bool {
		return f.count(`SELECT count(*) FROM tasks WHERE id = $1 AND description = '' AND photo = ''`, task) == 1
	})
	testapp.WaitFor(t, func() bool { return !f.exists("tasks/" + task + "/p.png") })

	entry := f.entry()
	f.hiddenCase("competition_entry", entry)
	f.publish("competition_changes:x", "competition.changed", map[string]any{"kind": "entries", "entry": entry}, events.Audience{})
	testapp.WaitFor(t, func() bool {
		return f.count(`SELECT count(*) FROM competition_entries WHERE id = $1 AND hidden`, entry) == 1
	})
}

func TestCasesFollowDeletedTasksEntriesAndRoutes(t *testing.T) {
	f := newFixture(t)
	task := f.exec(`INSERT INTO tasks (id, gym, kind, priority, status, route, description, reporter)
		VALUES ($1, $2, 'defect', 2, 'open', $3, 'hm', $4) RETURNING id`, ids.New(), f.gymA, f.route, f.users["climber"])
	entry := f.entry()
	rating := f.rating("climber", "meh")
	f.item("rating", rating)
	f.call("operator", "POST", "/moderation/cases", `{"content_type":"task","content_id":"`+task+`"}`, http.StatusOK)
	f.call("operator", "POST", "/moderation/cases", `{"content_type":"competition_entry","content_id":"`+entry+`"}`, http.StatusOK)

	f.exec(`DELETE FROM tasks WHERE id = $1 RETURNING id`, task)
	f.publish("tasks:"+f.gymA, "task.deleted", map[string]any{"action": "delete", "record": map[string]string{"id": task}}, events.Audience{})
	f.exec(`DELETE FROM competition_entries WHERE id = $1 RETURNING id`, entry)
	f.publish("entry.deleted", "entry.deleted", map[string]string{"id": entry}, events.Audience{})
	f.exec(`DELETE FROM routes WHERE id = $1 RETURNING id`, f.route)
	f.gymChange("route.deleted", f.route)
	testapp.WaitFor(t, func() bool {
		return f.count(`SELECT count(*) FROM moderation_items WHERE content_id IN ($1, $2, $3)`, task, entry, rating) == 0
	})
}

func TestHidingAnAuthorSkipsVanishedContent(t *testing.T) {
	f := newFixture(t)
	gone := f.rating("climber", "spam")
	f.item("rating", gone)
	f.exec(`DELETE FROM ratings WHERE id = $1 RETURNING id`, gone)
	kept := f.rating("climber", "more spam")
	f.item("rating", kept)
	f.call("operator", "POST", "/moderation/authors/"+f.users["climber"]+"/hide", `{"reason":"spam"}`, http.StatusOK, `"hidden":1`)
}

func TestContactAddressGetsNoNotifierIdentity(t *testing.T) {
	f := newFixture(t)
	f.exec(`UPDATE gyms SET contact_email = 'desk@example.com' WHERE id = $1 RETURNING id`, f.gymA)
	report := f.report("rating", f.rating("climber", "rude"), "harassment")
	testapp.WaitFor(t, func() bool {
		return f.count(`SELECT count(*) FROM reports WHERE id = $1 AND receipt_sent`, report) == 1
	})
	testapp.WaitFor(t, func() bool {
		var desk, handler bool
		for _, m := range testapp.Mails(f.app) {
			desk = desk || slices.Contains(m.To, "desk@example.com")
			handler = handler || slices.Contains(m.To, "adminA@example.com")
		}
		return desk && handler
	})
	for _, m := range testapp.Mails(f.app) {
		if slices.Contains(m.To, "desk@example.com") && strings.Contains(m.Text, "n@example.com") {
			t.Error("contact address got the notifier's e-mail")
		}
		if slices.Contains(m.To, "adminA@example.com") && !strings.Contains(m.Text, "n@example.com") {
			t.Error("report handler lost the notifier's e-mail")
		}
	}
}
