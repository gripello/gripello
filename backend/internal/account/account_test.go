package account

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"gripello/internal/platform"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/testapp"
)

type fixture struct {
	t       *testing.T
	app     *platform.App
	handler http.Handler
	gym     string
	admin   string
	climber string
	setter  string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	app := testapp.App(t)
	Register(app)
	f := &fixture{t: t, app: app, handler: testapp.Handler(app)}
	f.gym = f.id(`INSERT INTO gyms (id, slug, name, active) VALUES ($1, 'gym-a', 'A', true) RETURNING id`, ids.New())
	f.admin = f.user("admin")
	f.climber = f.user("climber")
	f.setter = f.user("setter")
	f.member(f.admin, "admin", "manage_users")
	f.member(f.setter, "routesetter", "manage_routes")
	return f
}

func (f *fixture) id(sql string, args ...any) string {
	f.t.Helper()
	var id string
	if err := f.app.DB.QueryRow(context.Background(), sql, args...).Scan(&id); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return id
}

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.app.DB.Exec(context.Background(), sql, args...); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
}

func (f *fixture) count(sql string, args ...any) int {
	f.t.Helper()
	var n int
	if err := f.app.DB.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return n
}

func (f *fixture) user(username string) string {
	return f.id(`INSERT INTO users (id, username, email, token_key, password_hash) VALUES ($1, $2, $2 || '@example.com', $3, 'secret-hash') RETURNING id`,
		ids.New(), username, ids.New())
}

func (f *fixture) member(userID, role, permission string) {
	roleID := f.id(`INSERT INTO roles (id, gym, name, permissions) VALUES ($1, $2, $3, $4) ON CONFLICT (gym, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
		ids.New(), f.gym, role, []string{permission})
	f.exec(`INSERT INTO memberships (id, "user", gym, role) VALUES ($1, $2, $3, $4)`, ids.New(), userID, f.gym, roleID)
}

func (f *fixture) token(userID string) string {
	var tokenKey string
	f.app.DB.QueryRow(context.Background(), `SELECT token_key FROM users WHERE id = $1`, userID).Scan(&tokenKey)
	token, _ := f.app.Tokens.Sign(userID, tokenKey, "")
	return token
}

func (f *fixture) send(userID, method, path string, body io.Reader, contentType string) *httptest.ResponseRecorder {
	f.t.Helper()
	req := httptest.NewRequest(method, "/api"+path, body)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if userID != "" {
		req.Header.Set("Authorization", f.token(userID))
	}
	rec := httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	return rec
}

func (f *fixture) call(userID, method, path, body string, status int, contains ...string) string {
	f.t.Helper()
	rec := f.send(userID, method, path, strings.NewReader(body), "application/json")
	if rec.Code != status {
		f.t.Fatalf("%s %s %s: status %d, want %d: %s", method, path, body, rec.Code, status, rec.Body)
	}
	for _, want := range contains {
		if !strings.Contains(rec.Body.String(), want) {
			f.t.Errorf("%s %s: body lacks %s: %s", method, path, want, rec.Body)
		}
	}
	return rec.Body.String()
}

func TestGetMe(t *testing.T) {
	f := newFixture(t)
	f.call("", http.MethodGet, "/me", "", http.StatusUnauthorized)
	body := f.call(f.climber, http.MethodGet, "/me", "", http.StatusOK, `"username":"climber"`, `"platform_admin":false`, `"verified":false`, "climber@example.com")
	if strings.Contains(body, "secret-hash") || strings.Contains(body, "token_key") {
		t.Errorf("record leaks credentials: %s", body)
	}
}

func TestUpdateProfile(t *testing.T) {
	f := newFixture(t)
	location := f.id(`INSERT INTO locations (id, gym, name) VALUES ($1, $2, 'Hall') RETURNING id`, ids.New(), f.gym)
	wall := f.id(`INSERT INTO walls (id, gym, location, name, outline, edge) VALUES ($1, $2, $3, 'Slab', '[]', '[]') RETURNING id`, ids.New(), f.gym, location)

	f.call(f.climber, http.MethodPatch, "/me", `{"firstname":"Cleo","name":"Climber","language":"de","follow_policy":"open","followed_walls":["`+wall+`"],"notification_prefs":{"push":{"tasks":false}},"ticks_private":true}`,
		http.StatusOK, `"firstname":"Cleo"`, `"followed_walls":["`+wall+`"]`, `"tasks":false`, `"ticks_private":true`)

	for _, field := range []string{`"platform_admin":true`, `"verified":true`, `"suspended_until":null`, `"email":"x@example.com"`, `"password":"newpassword"`} {
		f.call(f.climber, http.MethodPatch, "/me", "{"+field+"}", http.StatusForbidden)
	}
	if f.count(`SELECT count(*) FROM users WHERE platform_admin`) != 0 {
		t.Fatal("platform_admin was set")
	}

	f.call(f.climber, http.MethodPatch, "/me", `{"username":"Setter","language":"xx","followed_walls":["missing"],"notification_prefs":"no"}`, http.StatusBadRequest,
		`"username":{"code":"validation_not_unique"`, `"language":{"code":"validation_invalid_value"`, `"followed_walls":{"code":"validation_missing_rel_records"`, `"notification_prefs":{"code":"validation_invalid_value"`)
	f.call(f.climber, http.MethodPatch, "/me", `{"username":"a b"}`, http.StatusBadRequest, "validation_invalid_format")
	f.call(f.climber, http.MethodPatch, "/me", `{"username":"cleo.c"}`, http.StatusOK, `"username":"cleo.c"`)
}

func TestProfileUpdatePublishesChangedFields(t *testing.T) {
	f := newFixture(t)
	f.call(f.climber, http.MethodPatch, "/me", `{"firstname":"Cleo","ticks_private":false}`, http.StatusOK)
	var payload UserUpdated
	if err := f.app.DB.QueryRow(context.Background(), `SELECT payload FROM events WHERE topic = $1 AND kind = $2`, "user:"+f.climber, KindUserUpdated).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	if strings.Join(payload.Changed, ",") != "firstname" || strings.Contains(string(payload.Record), "secret-hash") || !strings.Contains(string(payload.Record), f.climber) {
		t.Errorf("payload = %s %v", payload.Record, payload.Changed)
	}
	f.call(f.climber, http.MethodPatch, "/me", `{"firstname":"Cleo"}`, http.StatusOK)
	if n := f.count(`SELECT count(*) FROM events WHERE kind = $1`, KindUserUpdated); n != 1 {
		t.Errorf("%d events for an unchanged profile", n)
	}
}

func pngBytes() []byte {
	var buf bytes.Buffer
	png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 4, 4)))
	return buf.Bytes()
}

func TestAvatarUploadAndClear(t *testing.T) {
	f := newFixture(t)
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	mw.WriteField("@jsonPayload", `{"firstname":"Ava"}`)
	part, _ := mw.CreateFormFile("avatar", "Me Photo.PNG")
	part.Write(pngBytes())
	mw.Close()
	rec := f.send(f.climber, http.MethodPatch, "/me", &body, mw.FormDataContentType())
	if rec.Code != http.StatusOK {
		t.Fatalf("upload = %d %s", rec.Code, rec.Body)
	}
	var record struct{ Avatar, Firstname string }
	json.Unmarshal(rec.Body.Bytes(), &record)
	if !regexp.MustCompile(`^me_photo_[a-z0-9]{10}\.png$`).MatchString(record.Avatar) || record.Firstname != "Ava" {
		t.Fatalf("record = %+v", record)
	}
	ctx := context.Background()
	if r, err := f.app.Blob.Open(ctx, "users/"+f.climber+"/"+record.Avatar); err != nil {
		t.Fatalf("stored file missing: %v", err)
	} else {
		r.Close()
	}

	f.call(f.climber, http.MethodDelete, "/me/avatar", "", http.StatusOK, `"avatar":""`)
	if _, err := f.app.Blob.Open(ctx, "users/"+f.climber+"/"+record.Avatar); err == nil {
		t.Error("cleared avatar file kept")
	}

	body.Reset()
	mw = multipart.NewWriter(&body)
	part, _ = mw.CreateFormFile("banner", "banner.svg")
	part.Write([]byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`))
	mw.Close()
	if rec := f.send(f.climber, http.MethodPatch, "/me", &body, mw.FormDataContentType()); rec.Code != http.StatusBadRequest {
		t.Errorf("svg banner = %d %s", rec.Code, rec.Body)
	}
}

func TestDeleteAccount(t *testing.T) {
	f := newFixture(t)
	hash, _ := bcrypt.GenerateFromPassword([]byte("right-password"), bcrypt.MinCost)
	f.exec(`UPDATE users SET password_hash = $1`, string(hash))
	const confirmed = `{"password":"right-password"}`
	f.call(f.admin, http.MethodDelete, "/me", confirmed, http.StatusBadRequest, "at least one admin")

	f.exec(`INSERT INTO sessions (id, "user") VALUES ('sess1', $1)`, f.climber)
	f.call(f.climber, http.MethodDelete, "/me", `{}`, http.StatusBadRequest, "validation_invalid_password")
	f.call(f.climber, http.MethodDelete, "/me", `{"password":"wrong"}`, http.StatusBadRequest, "validation_invalid_password")
	f.call(f.climber, http.MethodDelete, "/me", confirmed, http.StatusNoContent)
	if f.count(`SELECT count(*) FROM users WHERE id = $1`, f.climber) != 0 {
		t.Error("user still exists")
	}
	if f.count(`SELECT count(*) FROM events WHERE kind = 'session.revoked' AND payload->>'session' = 'sess1'`) != 1 ||
		f.count(`SELECT count(*) FROM events WHERE kind = $1 AND topic = $2`, KindUserDeleted, "user:"+f.climber) != 1 {
		t.Error("deletion events missing")
	}

	f.member(f.user("second"), "admin", "manage_users")
	f.call(f.admin, http.MethodDelete, "/me", confirmed, http.StatusNoContent)
}

func TestExportOverTheCapAnswers413(t *testing.T) {
	f := newFixture(t)
	f.exec(`UPDATE users SET avatar = 'big.png' WHERE id = $1`, f.climber)
	if err := f.app.Blob.Put(context.Background(), "users/"+f.climber+"/big.png", bytes.NewReader(make([]byte, 64<<10))); err != nil {
		t.Fatal(err)
	}
	defer func(max int64) { exportMaxBytes = max }(exportMaxBytes)
	exportMaxBytes = 32 << 10
	f.call(f.climber, http.MethodGet, "/me/export", "", http.StatusRequestEntityTooLarge)
	m := &module{db: f.app.DB, blob: f.app.Blob}
	parts, _, err := m.collectExport(context.Background(), f.climber)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.streamExport(context.Background(), io.Discard, parts); err != errExportTooLarge {
		t.Errorf("stream past the cap = %v", err)
	}
	exportMaxBytes = 1 << 20
	if rec := f.send(f.climber, http.MethodGet, "/me/export", nil, ""); rec.Code != http.StatusOK || rec.Body.Len() < 64<<10 {
		t.Errorf("export under the cap = %d, %d bytes", rec.Code, rec.Body.Len())
	}
}

func TestContributions(t *testing.T) {
	f := newFixture(t)
	route := f.route("Crimp")
	f.exec(`INSERT INTO ratings (id, gym, route_id, "user", rating, comment) VALUES ($1, $2, $3, $4, 4, 'Mine'), ($5, $2, $3, $6, 2, 'Theirs')`,
		ids.New(), f.gym, route, f.climber, ids.New(), f.setter)
	f.exec(`INSERT INTO beta_videos (id, gym, route, "user", url) VALUES ($1, $2, $3, $4, 'https://youtube.com/shorts/123')`, ids.New(), f.gym, route, f.climber)

	f.call("", http.MethodGet, "/me/contributions", "", http.StatusUnauthorized)
	f.call(f.climber, http.MethodGet, "/me/contributions", "", http.StatusOK, `"comment":"Mine"`, `"name":"Crimp"`, `"url":"https://youtube.com/shorts/123"`)
	f.call(f.setter, http.MethodGet, "/me/contributions", "", http.StatusOK, `"comment":"Theirs"`, `"betas":[]`)
}

func (f *fixture) route(name string) string {
	location := f.id(`INSERT INTO locations (id, gym, name) VALUES ($1, $2, $3) RETURNING id`, ids.New(), f.gym, name+" hall")
	return f.id(`INSERT INTO routes (id, gym, name, grade, type, location) VALUES ($1, $2, $3, '6a', 'Boulder', $4) RETURNING id`, ids.New(), f.gym, name, location)
}

func (f *fixture) export(userID string) map[string]string {
	f.t.Helper()
	m := &module{db: f.app.DB, blob: f.app.Blob}
	parts, _, err := m.collectExport(context.Background(), userID)
	if err != nil {
		f.t.Fatal(err)
	}
	var archive bytes.Buffer
	if err := m.streamExport(context.Background(), &archive, parts); err != nil {
		f.t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(archive.Bytes()), int64(archive.Len()))
	if err != nil {
		f.t.Fatal(err)
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

func TestExportContainsOnlyOwnData(t *testing.T) {
	f := newFixture(t)
	route := f.route("Crimpy")
	now := time.Now()
	f.exec(`INSERT INTO ticks (id, "user", route, type, attempts, date, note) VALUES ($1, $2, $3, 'top', 2, $4, 'my send'), ($5, $6, $3, 'flash', 1, $4, 'other send')`,
		ids.New(), f.climber, route, now, ids.New(), f.setter)
	f.exec(`INSERT INTO tasks (id, gym, kind, category, priority, status, route, reporter, description, photo) VALUES
		($1, $2, 'defect', 'loose_hold', 4, 'open', $3, $4, 'my defect', 'hold.jpg'), ($5, $2, 'defect', 'loose_hold', 4, 'open', $3, $6, 'other defect', '')`,
		ids.New(), f.gym, route, f.climber, ids.New(), f.setter)
	f.exec(`INSERT INTO reports (id, gym, content_type, content_id, content_url, reason, explanation, notifier_name, notifier_email, status, good_faith, decided_by)
		VALUES ($1, $2, 'route', $3, '/x', 'other', 'my report', 'n', 'CLIMBER@EXAMPLE.COM', 'open', true, $4)`, ids.New(), f.gym, route, f.admin)
	f.exec(`UPDATE gyms SET contact_email = 'gym@example.com' WHERE id = $1`, f.gym)
	location := f.id(`INSERT INTO locations (id, gym, name) VALUES ($1, $2, 'Hall') RETURNING id`, ids.New(), f.gym)
	competition := f.id(`INSERT INTO competitions (id, gym, name, location, status, starts_at, ends_at, scoring_format, discipline)
		VALUES ($1, $2, 'Jam', $3, 'open', now(), now() + interval '1 day', 'tops', 'boulder') RETURNING id`, ids.New(), f.gym, location)
	category := f.id(`INSERT INTO competition_categories (id, competition, name) VALUES ($1, $2, 'Open') RETURNING id`, ids.New(), competition)
	f.exec(`INSERT INTO competition_entries (id, competition, category, "user", display_name, birth_year, status, bib) VALUES ($1, $2, $3, $4, 'C', 1990, 'registered', 1)`,
		ids.New(), competition, category, f.climber)
	wall := f.id(`INSERT INTO walls (id, gym, location, name, outline, edge) VALUES ($1, $2, $3, 'Slab', '[[1,1],[2,1],[2,2]]', '[]') RETURNING id`, ids.New(), f.gym, location)
	f.exec(`UPDATE users SET followed_walls = $2, avatar = 'missing.png' WHERE id = $1`, f.climber, []string{wall})
	f.app.Blob.Put(context.Background(), "tasks/"+f.id(`SELECT id FROM tasks WHERE reporter = $1`, f.climber)+"/hold.jpg", strings.NewReader("jpeg"))

	files := f.export(f.climber)
	for _, name := range []string{"profile.json", "ticks.json", "logbook.csv", "memberships.json", "competition_entries.json", "notifications.json", "devices.json", "activity_log.json", "tasks.json", "reports.json", "sessions.json", "two_factor.json", "follows.json", "beta_videos.json", "achievements.json", "reviews.json", "blocked_climbers.json", "moderation.json"} {
		if _, ok := files[name]; !ok {
			t.Errorf("missing %s", name)
		}
	}
	if !strings.Contains(files["profile.json"], "climber@example.com") || strings.Contains(files["profile.json"], "token_key") || strings.Contains(files["profile.json"], "secret-hash") {
		t.Errorf("profile = %s", files["profile.json"])
	}
	if !strings.Contains(files["logbook.csv"], "Crimpy") || !strings.Contains(files["logbook.csv"], "my send") || !strings.Contains(files["logbook.csv"], ",A\n") {
		t.Errorf("logbook = %q", files["logbook.csv"])
	}
	if strings.Contains(files["logbook.csv"]+files["ticks.json"], "other send") {
		t.Error("export contains another user's tick")
	}
	if !strings.Contains(files["tasks.json"], "my defect") || strings.Contains(files["tasks.json"], "other defect") || !strings.Contains(files["tasks.json"], `"route": "Crimpy"`) || strings.Contains(files["tasks.json"], f.climber) {
		t.Errorf("tasks = %s", files["tasks.json"])
	}
	if files["task_photos/"+f.id(`SELECT id FROM tasks WHERE reporter = $1`, f.climber)+"_hold.jpg"] != "jpeg" {
		t.Error("task photo not exported")
	}
	if strings.Contains(files["reports.json"], "my report") {
		t.Error("unverified user received reports filed under their email")
	}
	if !strings.Contains(files["profile.json"], `"wall": "Slab"`) || !strings.Contains(files["profile.json"], `"gym": "A"`) || strings.Contains(files["profile.json"], "[1, 1]") {
		t.Errorf("followed walls should be names only: %s", files["profile.json"])
	}
	if _, ok := files["avatar.png"]; ok {
		t.Error("missing avatar file produced an entry")
	}
	if !strings.Contains(files["competition_entries.json"], `"competition": "Jam"`) || !strings.Contains(files["competition_entries.json"], `"category": "Open"`) || strings.Contains(files["competition_entries.json"], "scoring_format") {
		t.Errorf("competition entries = %s", files["competition_entries.json"])
	}

	memberships := f.export(f.setter)["memberships.json"]
	for _, want := range []string{`"gym": "A"`, `"gym_slug": "gym-a"`, `"role": "routesetter"`, `"manage_routes"`} {
		if !strings.Contains(memberships, want) {
			t.Errorf("memberships lack %s: %s", want, memberships)
		}
	}
	if strings.Contains(memberships, "gym@example.com") {
		t.Errorf("memberships leak gym data: %s", memberships)
	}

	f.exec(`UPDATE users SET verified = true WHERE id = $1`, f.climber)
	reports := f.export(f.climber)["reports.json"]
	if !strings.Contains(reports, "my report") || strings.Contains(reports, f.admin) {
		t.Errorf("verified user's reports (any email case, no moderator id) = %s", reports)
	}
}

func TestExportRoute(t *testing.T) {
	f := newFixture(t)
	f.call("", http.MethodGet, "/me/export", "", http.StatusUnauthorized)
	for range 3 {
		rec := f.send(f.climber, http.MethodGet, "/me/export", nil, "")
		if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/zip" || !strings.HasPrefix(rec.Header().Get("Content-Disposition"), `attachment; filename="gripello-data-`) {
			t.Fatalf("export = %d %v", rec.Code, rec.Header())
		}
	}
	if rec := f.send(f.climber, http.MethodGet, "/me/export", nil, ""); rec.Code != http.StatusTooManyRequests {
		t.Errorf("fourth export in an hour = %d", rec.Code)
	}
	if rec := f.send(f.setter, http.MethodGet, "/me/export", nil, ""); rec.Code != http.StatusOK {
		t.Errorf("other user's export = %d", rec.Code)
	}
}

func TestExportFailsInsteadOfSendingPartialData(t *testing.T) {
	f := newFixture(t)
	f.exec(`DROP TABLE push_subscriptions`)
	f.call(f.climber, http.MethodGet, "/me/export", "", http.StatusInternalServerError, "Exporting your data failed.")
}

var fileColumn = regexp.MustCompile(`^(avatar|banner|photo|file|files|attachments?|.*_(image|logo|icon|file|photo|plan))$`)

func TestExportCoversEveryUserLink(t *testing.T) {
	f := newFixture(t)
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
		"beta_videos.file":             true,
		"user_badges.user":             true,
		"ratings.user":                 true,
		"reports.decided_by":           false, // moderation of other people's reports, holds the notifiers' data
		"blocks.blocker":               true,
		"blocks.blocked":               false, // who blocked you is the blocker's own data
		"moderation_items.author":      true,
		"moderation_items.files":       true,
		"moderation_items.reviewed_by": false, // moderator identity
		"sessions.user":                true,
		"mfa_factors.user":             true,
		"mfa_recovery_codes.user":      false, // only hashes of one-time secrets
		"mfa_challenges.user":          false, // sign-in challenges that expire after 10 minutes
	}
	rows, err := f.app.DB.Query(context.Background(), `
		SELECT DISTINCT c.table_name, c.column_name, true FROM information_schema.referential_constraints rc
		JOIN information_schema.key_column_usage c ON c.constraint_name = rc.constraint_name AND c.constraint_schema = rc.constraint_schema
		JOIN information_schema.key_column_usage u ON u.constraint_name = rc.unique_constraint_name AND u.constraint_schema = rc.unique_constraint_schema
		WHERE rc.constraint_schema = current_schema() AND u.table_name = 'users'
		UNION ALL
		SELECT table_name, column_name, false FROM information_schema.columns
		WHERE table_schema = current_schema() AND data_type IN ('text', 'ARRAY')`)
	if err != nil {
		t.Fatal(err)
	}
	linked := map[string]bool{"users": true}
	var files []string
	found := map[string]bool{}
	for rows.Next() {
		var table, column string
		var relation bool
		if err := rows.Scan(&table, &column, &relation); err != nil {
			t.Fatal(err)
		}
		if relation {
			found[table+"."+column] = true
			linked[table] = true
		} else if fileColumn.MatchString(column) {
			files = append(files, table+"."+column)
		}
	}
	for _, file := range files {
		if linked[strings.Split(file, ".")[0]] {
			found[file] = true
		}
	}
	for key := range found {
		if _, ok := exported[key]; !ok {
			t.Errorf("%s holds user data: add it to exportQueries/exportFilesQuery (export.go) and this list, or list it as not exported with a reason", key)
		}
	}
	for key := range exported {
		if !found[key] {
			t.Errorf("%s no longer exists: drop it from this list", key)
		}
	}
}

func TestLimiterWindow(t *testing.T) {
	l := &limiter{max: 2, window: time.Hour, hits: map[string][]time.Time{}}
	now := time.Now()
	if !l.allow("a", now) || !l.allow("a", now) || l.allow("a", now) || !l.allow("b", now) {
		t.Fatal("limit not applied per key")
	}
	if !l.allow("a", now.Add(time.Hour+time.Second)) {
		t.Error("window did not slide")
	}
	if _, kept := l.hits["b"]; kept {
		t.Error("expired key b not evicted")
	}
}

func TestMeIncludesMemberships(t *testing.T) {
	f := newFixture(t)
	body := f.call(f.setter, http.MethodGet, "/me?include=memberships", "", http.StatusOK, `"slug":"gym-a"`, `"name":"routesetter"`, `"permissions":["manage_routes"]`, `"username":"setter"`)
	if strings.Contains(body, "secret-hash") {
		t.Error("record leaks credentials")
	}
	f.call(f.climber, http.MethodGet, "/me?include=memberships", "", http.StatusOK, `"memberships":[]`)
	if strings.Contains(f.call(f.setter, http.MethodGet, "/me", "", http.StatusOK), "memberships") {
		t.Error("memberships without include")
	}
}

func TestFollowAndUnfollowWall(t *testing.T) {
	f := newFixture(t)
	location := f.id(`INSERT INTO locations (id, gym, name) VALUES ($1, $2, 'Hall') RETURNING id`, ids.New(), f.gym)
	wall := f.id(`INSERT INTO walls (id, gym, location, name, outline, edge) VALUES ($1, $2, $3, 'Slab', '[]', '[]') RETURNING id`, ids.New(), f.gym, location)

	f.call("", http.MethodPost, "/me/followed-walls/"+wall, "", http.StatusUnauthorized)
	f.call(f.climber, http.MethodPost, "/me/followed-walls/missing", "", http.StatusNotFound)
	f.call(f.climber, http.MethodPost, "/me/followed-walls/"+wall, "", http.StatusOK, `"followed_walls":["`+wall+`"]`)
	f.call(f.climber, http.MethodPost, "/me/followed-walls/"+wall, "", http.StatusOK, `"followed_walls":["`+wall+`"]`)
	f.call(f.climber, http.MethodDelete, "/me/followed-walls/"+wall, "", http.StatusOK, `"followed_walls":[]`)

	rows, _ := f.app.DB.Query(context.Background(), `SELECT payload FROM events WHERE kind = $1 ORDER BY id`, KindUserUpdated)
	var changes []string
	for rows.Next() {
		var payload UserUpdated
		rows.Scan(&payload)
		changes = append(changes, strings.Join(payload.Changed, ","))
	}
	if strings.Join(changes, "|") != "followed_walls|followed_walls" {
		t.Errorf("events = %v", changes)
	}
}
