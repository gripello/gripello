package gyms

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"

	"gripello/internal/platform"
	"gripello/internal/platform/config"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/testapp"
)

type fixture struct {
	t        *testing.T
	app      *platform.App
	handler  http.Handler
	operator string
}

var allPermissions = []string{
	"judge_competitions", "manage_comments", "manage_competitions", "manage_reports", "manage_routes", "manage_settings",
	"manage_tasks", "manage_users", "run_inventory", "view_analytics", "view_audit_log",
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	app := testapp.App(t)
	Register(app)
	f := &fixture{t: t, app: app, handler: testapp.Handler(app)}
	f.operator = f.user("operator")
	f.exec(`UPDATE users SET platform_admin = true WHERE id = $1`, f.operator)
	return f
}

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.app.DB.Exec(context.Background(), sql, args...); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
}

func (f *fixture) scalar(sql string, dest any, args ...any) {
	f.t.Helper()
	if err := f.app.DB.QueryRow(context.Background(), sql, args...).Scan(dest); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
}

func (f *fixture) user(username string) string {
	id := ids.New()
	f.exec(`INSERT INTO users (id, username, email, token_key) VALUES ($1, $2, $2 || '@example.com', $3)`, id, username, ids.New())
	return id
}

func (f *fixture) member(userID, gymID, role string) {
	var roleID string
	f.scalar(`SELECT id FROM roles WHERE gym = $1 AND name = $2`, &roleID, gymID, role)
	f.exec(`INSERT INTO memberships (id, "user", gym, role) VALUES ($1, $2, $3, $4)`, ids.New(), userID, gymID, roleID)
}

func (f *fixture) token(userID string) string {
	var tokenKey string
	f.scalar(`SELECT token_key FROM users WHERE id = $1`, &tokenKey, userID)
	token, err := f.app.Tokens.Sign(userID, tokenKey, "")
	if err != nil {
		f.t.Fatal(err)
	}
	return token
}

type response struct {
	Status int
	Body   string
}

func (r response) json(t *testing.T) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal([]byte(r.Body), &out); err != nil {
		t.Fatalf("decoding %q: %v", r.Body, err)
	}
	return out
}

func (f *fixture) send(userID, method, path string, body io.Reader, contentType string) response {
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
	return response{rec.Code, rec.Body.String()}
}

// call sends JSON and asserts status plus substrings of the body, like the PocketBase hook tests did.
func (f *fixture) call(userID, method, path, body string, status int, contains ...string) response {
	f.t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	res := f.send(userID, method, path, reader, "application/json")
	if res.Status != status {
		f.t.Fatalf("%s %s %s: status %d, want %d: %s", method, path, body, res.Status, status, res.Body)
	}
	for _, want := range contains {
		if !strings.Contains(res.Body, want) {
			f.t.Errorf("%s %s: body %s lacks %q", method, path, res.Body, want)
		}
	}
	return res
}

func (f *fixture) createGym(slug, name string, active bool) string {
	f.t.Helper()
	body, _ := json.Marshal(map[string]any{"slug": slug, "name": name, "active": active})
	return f.call(f.operator, "POST", "/gyms", string(body), http.StatusCreated).json(f.t)["id"].(string)
}

func (f *fixture) stored(gymID, name string) bool {
	file, err := f.app.Blob.Open(context.Background(), "gyms/"+gymID+"/"+name)
	if err == nil {
		file.Close()
	}
	return err == nil
}

func (f *fixture) previousSlugs(gymID string) []string {
	var slugs []string
	f.scalar(`SELECT previous_slugs FROM gyms WHERE id = $1`, &slugs, gymID)
	return slugs
}

func TestValidateGymSlug(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/gymSlug.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		Reserved []string `json:"reserved"`
		Valid    []string `json:"valid"`
		Invalid  []string `json:"invalid"`
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(reservedGymSlugs, fixtures.Reserved) {
		t.Errorf("reservedGymSlugs = %v, want %v", reservedGymSlugs, fixtures.Reserved)
	}
	for _, slug := range fixtures.Valid {
		if message := validateGymSlug(slug); message != "" {
			t.Errorf("validateGymSlug(%q) = %s", slug, message)
		}
	}
	for _, slug := range fixtures.Invalid {
		if validateGymSlug(slug) == "" {
			t.Errorf("validateGymSlug(%q) accepted", slug)
		}
	}
}

func TestIsValidOpeningHours(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/openingHours.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		Valid   []json.RawMessage `json:"valid"`
		Invalid []json.RawMessage `json:"invalid"`
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, hours := range fixtures.Valid {
		if !isValidOpeningHours(hours) {
			t.Errorf("isValidOpeningHours(%s) rejected", hours)
		}
	}
	for _, hours := range fixtures.Invalid {
		if isValidOpeningHours(hours) {
			t.Errorf("isValidOpeningHours(%s) accepted", hours)
		}
	}
}

func TestAmenitiesMirrorTheRegistry(t *testing.T) {
	raw, err := os.ReadFile("../../../shared/utils/gymAmenities.ts")
	if err != nil {
		t.Fatal(err)
	}
	var registry []string
	for _, match := range regexp.MustCompile(`(?m)^\s+(\w+): 'i-lucide`).FindAllStringSubmatch(string(raw), -1) {
		registry = append(registry, match[1])
	}
	if !slices.Equal(gymAmenities, registry) {
		t.Errorf("gymAmenities = %v, want %v", gymAmenities, registry)
	}
}

func TestGymLifecycle(t *testing.T) {
	f := newFixture(t)
	climber := f.user("climber")

	f.call("", "POST", "/gyms", `{"slug":"first","name":"First"}`, http.StatusUnauthorized)
	f.call(climber, "POST", "/gyms", `{"slug":"first","name":"First"}`, http.StatusForbidden)
	f.call(f.operator, "POST", "/gyms", `{"slug":"first"}`, http.StatusBadRequest, `"name"`)
	first := f.createGym("first", "First", true)
	second := f.createGym("second", "Second", true)

	for _, gym := range []string{first, second} {
		var admin, setter []string
		f.scalar(`SELECT permissions FROM roles WHERE gym = $1 AND name = 'admin'`, &admin, gym)
		f.scalar(`SELECT permissions FROM roles WHERE gym = $1 AND name = 'routesetter'`, &setter, gym)
		if !slices.Equal(admin, allPermissions) {
			t.Errorf("admin permissions = %v", admin)
		}
		if !slices.Equal(setter, []string{"judge_competitions", "manage_comments", "manage_competitions", "manage_routes", "manage_tasks", "run_inventory", "view_analytics"}) {
			t.Errorf("routesetter permissions = %v", setter)
		}
	}
	var created int
	f.scalar(`SELECT count(*) FROM events WHERE kind = 'gym.created' AND topic = 'gym:' || $1 AND actor = $2 AND payload->'record'->>'id' = $1`, &created, first, f.operator)
	if created != 1 {
		t.Errorf("%d gym.created events", created)
	}

	f.call(climber, "DELETE", "/gyms/"+first, "", http.StatusForbidden)
	f.call(f.operator, "DELETE", "/gyms/"+first, "", http.StatusNoContent)
	f.call("", "GET", "/gyms/first", "", http.StatusNotFound)
	var deleted int
	f.scalar(`SELECT count(*) FROM events WHERE kind = 'gym.deleted' AND topic = 'gym:' || $1`, &deleted, first)
	if deleted != 1 {
		t.Errorf("%d gym.deleted events", deleted)
	}
}

func TestGymReads(t *testing.T) {
	f := newFixture(t)
	open := f.createGym("open", "Open", true)
	closed := f.createGym("closed", "Closed", false)
	f.call(f.operator, "PATCH", "/gyms/"+open, `{"slug":"open-hall"}`, http.StatusOK)
	manager := f.user("manager")
	f.member(manager, closed, "admin")

	list := f.call("", "GET", "/gyms", "", http.StatusOK, `"open-hall"`)
	if strings.Contains(list.Body, `"closed"`) {
		t.Errorf("guest list shows the inactive gym: %s", list.Body)
	}
	if strings.Contains(f.call(manager, "GET", "/gyms?all=1", "", http.StatusOK).Body, `"closed"`) {
		t.Error("?all=1 shows inactive gyms to a gym admin")
	}
	f.call(f.operator, "GET", "/gyms?all=1", "", http.StatusOK, `"closed"`)

	f.call("", "GET", "/gyms/open-hall", "", http.StatusOK, `"id":"`+open)
	if strings.Contains(f.call("", "GET", "/gyms/"+open, "", http.StatusOK).Body, "redirect_to") {
		t.Error("lookup by id answers with a redirect")
	}
	f.call("", "GET", "/gyms/open", "", http.StatusOK, `"redirect_to":"open-hall"`)
	f.call("", "GET", "/gyms/nowhere", "", http.StatusNotFound)
	f.call("", "GET", "/gyms/closed", "", http.StatusNotFound)
	f.call(manager, "GET", "/gyms/closed", "", http.StatusOK)
	f.call(f.operator, "GET", "/gyms/closed", "", http.StatusOK)
}

func TestGymSlugHistory(t *testing.T) {
	f := newFixture(t)
	gym := f.createGym("north", "North", true)
	rename := func(id, slug string, status int) {
		t.Helper()
		f.call(f.operator, "PATCH", "/gyms/"+id, `{"slug":"`+slug+`"}`, status)
	}

	rename(gym, "north-hall", http.StatusOK)
	rename(gym, "nord", http.StatusOK)
	if got := f.previousSlugs(gym); !slices.Equal(got, []string{"north", "north-hall"}) {
		t.Errorf("previous slugs after renames = %v", got)
	}
	rename(gym, "north", http.StatusOK)
	if got := f.previousSlugs(gym); !slices.Equal(got, []string{"north-hall", "nord"}) {
		t.Errorf("previous slugs after reclaim = %v", got)
	}

	for _, slug := range []string{"north", "nord"} {
		f.call(f.operator, "POST", "/gyms", `{"slug":"`+slug+`","name":"Other"}`, http.StatusBadRequest, "used by another gym")
	}
	other := f.createGym("south", "South", true)
	rename(other, "nord", http.StatusBadRequest)
	rename(other, "admin", http.StatusBadRequest)
}

func TestOnlyPlatformAdminsReleaseSlugs(t *testing.T) {
	for _, platformAdmin := range []bool{false, true} {
		f := newFixture(t)
		gym := f.createGym("gym-a", "Gym A", true)
		f.call(f.operator, "PATCH", "/gyms/"+gym, `{"slug":"gym-a-new"}`, http.StatusOK)
		caller := f.user("admin-a")
		f.member(caller, gym, "admin")
		status := http.StatusForbidden
		if platformAdmin {
			caller, status = f.operator, http.StatusOK
		}
		f.call(caller, "PATCH", "/gyms/"+gym, `{"previous_slugs":[]}`, status)
		reuse := f.send(f.operator, "POST", "/gyms", strings.NewReader(`{"slug":"gym-a","name":"Reuse"}`), "application/json")
		if released := reuse.Status == http.StatusCreated; released != platformAdmin {
			t.Errorf("platform admin %v: old slug reusable = %v", platformAdmin, released)
		}
	}
}

func TestOnlyPlatformAdminsChangeSlugsAndActivation(t *testing.T) {
	f := newFixture(t)
	gym := f.createGym("gym-a", "Gym A", true)
	admin := f.user("admin-a")
	f.member(admin, gym, "admin")
	setter := f.user("setter-a")
	f.member(setter, gym, "routesetter")
	stranger := f.user("stranger")

	f.call(admin, "PATCH", "/gyms/"+gym, `{"slug":"gym-a-renamed"}`, http.StatusForbidden, "slug")
	f.call(admin, "PATCH", "/gyms/"+gym, `{"slug":"gym-a","name":"Same slug"}`, http.StatusOK)
	f.call(admin, "PATCH", "/gyms/"+gym, `{"active":false}`, http.StatusForbidden)
	f.call(setter, "PATCH", "/gyms/"+gym, `{"name":"Setter"}`, http.StatusForbidden)
	f.call(stranger, "PATCH", "/gyms/"+gym, `{"name":"Stranger"}`, http.StatusForbidden)
	f.call("", "PATCH", "/gyms/"+gym, `{"name":"Guest"}`, http.StatusUnauthorized)
	f.call(f.operator, "PATCH", "/gyms/"+gym, `{"slug":"gym-a-renamed","active":false}`, http.StatusOK, `"slug":"gym-a-renamed"`, `"active":false`)

	var public, staff int
	f.scalar(`SELECT count(*) FROM events WHERE kind = 'gym.updated' AND topic = 'gym:' || $1 AND audience->>'public' = 'true'`, &public, gym)
	f.scalar(`SELECT count(*) FROM events WHERE kind = 'gym.updated' AND topic = 'gym:' || $1 AND audience->>'gym_perm' = $1 || ':manage_settings'`, &staff, gym)
	if public != 1 || staff != 1 {
		t.Errorf("gym.updated events: %d public, %d staff; want 1 each", public, staff)
	}
}

func TestOnlyPlatformAdminsChangeFeatureFlags(t *testing.T) {
	f := newFixture(t)
	gym := f.createGym("gym-a", "Gym A", true)
	f.call(f.operator, "PATCH", "/gyms/"+gym, `{"features":{"beta_videos":true}}`, http.StatusOK)
	admin := f.user("admin-a")
	f.member(admin, gym, "admin")
	path := "/gyms/" + gym

	f.call(admin, "PATCH", path, `{"features":{"beta_videos":false}}`, http.StatusForbidden, "feature flags")
	f.call(admin, "PATCH", path, `{"name":"Renamed","features":{"beta_videos":true}}`, http.StatusOK)
	f.call(f.operator, "PATCH", path, `{"features":{"beta_videos":false}}`, http.StatusOK, `"beta_videos":false`)
	f.call(admin, "PATCH", path, `{"features":{"beta_videos":1}}`, http.StatusForbidden)
	f.call(admin, "PATCH", path, `{"features":{}}`, http.StatusForbidden)
	f.call(f.operator, "PATCH", path, `{"features":{"beta_videos":1}}`, http.StatusBadRequest, "true/false")
}

func TestGymAdminsSaveGymInfo(t *testing.T) {
	f := newFixture(t)
	gym := f.createGym("gym-a", "Gym A", true)
	admin := f.user("admin-a")
	f.member(admin, gym, "admin")
	path := "/gyms/" + gym

	f.call(admin, "PATCH", path, `{"opening_hours":{"mon":[["07:00","23:00"]]},"amenities":["showers","toilets","showers"],"latitude":52.5}`,
		http.StatusOK, `"amenities":["showers","toilets"]`, `"latitude":52.5`)
	f.call(admin, "PATCH", path, `{"opening_hours":{"mon":[["7","23"]]}}`, http.StatusBadRequest, "HH:MM")
	f.call(admin, "PATCH", path, `{"amenities":["jacuzzi"]}`, http.StatusBadRequest)
	f.call(admin, "PATCH", path, `{"latitude":91}`, http.StatusBadRequest)
	f.call(admin, "PATCH", path, `{"contact_email":"nope"}`, http.StatusBadRequest, `"contact_email"`)
	f.call(admin, "PATCH", path, `{"website_url":"javascript:alert(1)"}`, http.StatusBadRequest)
	f.call(admin, "PATCH", path, `{"name":""}`, http.StatusBadRequest)
	f.call(admin, "PATCH", path, `{"language":"it"}`, http.StatusBadRequest)
	f.call(admin, "PATCH", path, `{"opening_hours":null,"boulder_bands":[{"from":0}],"description":"Hi","premoderate_betas":true}`,
		http.StatusOK, `"opening_hours":null`, `"premoderate_betas":true`)
}

func TestGymFiles(t *testing.T) {
	f := newFixture(t)
	gym := f.createGym("gym-a", "Gym A", true)
	upload := func(field, filename string, content []byte, payload string) response {
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		form.WriteField("@jsonPayload", payload)
		part, _ := form.CreateFormFile(field, filename)
		part.Write(content)
		form.Close()
		return f.send(f.operator, "PATCH", "/gyms/"+gym, &body, form.FormDataContentType())
	}
	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")

	res := upload("page_logo", "Logo Big.PNG", png, `{"name":"With logo"}`)
	if res.Status != http.StatusOK {
		t.Fatalf("upload: %d %s", res.Status, res.Body)
	}
	logo := res.json(t)["page_logo"].(string)
	if !strings.HasPrefix(logo, "logo_big_") || !strings.HasSuffix(logo, ".png") || !f.stored(gym, logo) {
		t.Fatalf("logo %q not stored", logo)
	}
	if res := upload("cover_image", "cover.svg", []byte("<svg xmlns='http://www.w3.org/2000/svg'/>"), ""); res.Status != http.StatusBadRequest {
		t.Errorf("svg cover accepted: %d %s", res.Status, res.Body)
	}
	if res := upload("page_logo", "huge.png", append(png, make([]byte, maxFileSize)...), ""); res.Status != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized logo accepted: %d", res.Status)
	}

	f.call(f.operator, "PATCH", "/gyms/"+gym, `{"page_logo":null}`, http.StatusOK, `"page_logo":""`)
	if f.stored(gym, logo) {
		t.Error("cleared logo still stored")
	}
}

func TestDeleteGymCascadesAndRetiresSlugs(t *testing.T) {
	f := newFixture(t)
	gym := f.createGym("doomed", "Doomed", true)
	f.call(f.operator, "PATCH", "/gyms/"+gym, `{"slug":"doomed-hall"}`, http.StatusOK)
	keeper := f.createGym("keeper", "Keeper", true)
	climber := f.user("climber")
	f.member(climber, gym, "routesetter")

	location, wall, route, competition, category := ids.New(), ids.New(), ids.New(), ids.New(), ids.New()
	f.exec(`INSERT INTO locations (id, gym, name) VALUES ($1, $2, 'Hall')`, location, gym)
	f.exec(`INSERT INTO walls (id, gym, location, name, outline, edge) VALUES ($1, $2, $3, 'Left', '[]', '[]')`, wall, gym, location)
	f.exec(`INSERT INTO routes (id, gym, name, grade, location, wall) VALUES ($1, $2, 'Crimp', '6a', $3, $4)`, route, gym, location, wall)
	f.exec(`INSERT INTO ratings (id, gym, route_id, rating) VALUES ($1, $2, $3, 4)`, ids.New(), gym, route)
	f.exec(`INSERT INTO ticks (id, "user", route, type, attempts, date, route_name) VALUES ($1, $2, $3, 'top', 1, now(), 'Crimp')`, ids.New(), climber, route)
	f.exec(`INSERT INTO competitions (id, gym, name, location, status, starts_at, ends_at, scoring_format, discipline)
		VALUES ($1, $2, 'Cup', $3, 'open', now(), now(), 'tops', 'boulder')`, competition, gym, location)
	f.exec(`INSERT INTO competition_categories (id, competition, name) VALUES ($1, $2, 'Open')`, category, competition)
	f.exec(`INSERT INTO competition_entries (id, competition, "user", category, display_name, birth_year, status)
		VALUES ($1, $2, $3, $4, 'C', 1990, 'registered')`, ids.New(), competition, climber, category)

	beta, task, item := ids.New(), ids.New(), ids.New()
	f.exec(`INSERT INTO beta_videos (id, gym, route, "user", file) VALUES ($1, $2, $3, $4, 'clip.mp4')`, beta, gym, route, climber)
	f.exec(`INSERT INTO tasks (id, gym, kind, priority, status, photo) VALUES ($1, $2, 'defect', 2, 'open', 'photo.jpg')`, task, gym)
	f.exec(`INSERT INTO moderation_items (id, gym, content_type, content_id, state, files) VALUES ($1, $2, 'rating', 'x', 'hidden', '{shot.jpg}')`, item, gym)
	files := []string{"beta_videos/" + beta + "/clip.mp4", "tasks/" + task + "/photo.jpg", "moderation_items/" + item + "/shot.jpg", "locations/" + location + "/trace.png"}
	for _, key := range files {
		if err := f.app.Blob.Put(context.Background(), key, strings.NewReader("x")); err != nil {
			t.Fatal(err)
		}
	}

	f.call(f.operator, "DELETE", "/gyms/"+gym, "", http.StatusNoContent)

	for _, key := range files {
		if file, err := f.app.Blob.Open(context.Background(), key); err == nil {
			file.Close()
			t.Errorf("%s survived the gym delete", key)
		}
	}
	var leftovers int
	f.scalar(`SELECT (SELECT count(*) FROM roles WHERE gym = $1) + (SELECT count(*) FROM memberships WHERE gym = $1)
		+ (SELECT count(*) FROM locations WHERE gym = $1) + (SELECT count(*) FROM competitions WHERE gym = $1)`, &leftovers, gym)
	if leftovers != 0 {
		t.Errorf("%d rows of the deleted gym left", leftovers)
	}
	var tickRoute *string
	f.scalar(`SELECT route FROM ticks WHERE "user" = $1`, &tickRoute, climber)
	if tickRoute != nil {
		t.Errorf("tick still points at route %s", *tickRoute)
	}
	var retired []string
	f.scalar(`SELECT array_agg(slug ORDER BY slug) FROM retired_slugs WHERE gym_name = 'Doomed'`, &retired)
	if !slices.Equal(retired, []string{"doomed", "doomed-hall"}) {
		t.Errorf("retired slugs = %v", retired)
	}
	f.call(f.operator, "POST", "/gyms", `{"slug":"doomed","name":"Reborn"}`, http.StatusBadRequest, "used by another gym")
	f.call(f.operator, "PATCH", "/gyms/"+keeper, `{"slug":"doomed-hall"}`, http.StatusBadRequest)
}

func TestSettings(t *testing.T) {
	f := newFixture(t)
	gym := f.createGym("gym-a", "Gym A", true)
	admin := f.user("admin-a")
	f.member(admin, gym, "admin")

	f.call("", "GET", "/settings", "", http.StatusOK, `"allow_registration":false`, `"audit_retention_days":90`)
	f.call("", "PATCH", "/settings", `{"allow_registration":true}`, http.StatusUnauthorized)
	f.call(admin, "PATCH", "/settings", `{"allow_registration":true}`, http.StatusForbidden)
	f.call(f.operator, "PATCH", "/settings", `{"contact_email":"bad"}`, http.StatusBadRequest)
	f.call(f.operator, "PATCH", "/settings", `{"audit_retention_days":0.5}`, http.StatusBadRequest)
	f.call(f.operator, "PATCH", "/settings", `{"allow_registration":true,"contact_email":"ops@example.com","audit_retention_days":30}`,
		http.StatusOK, `"allow_registration":true`, `"audit_retention_days":30`)
	f.call("", "GET", "/settings", "", http.StatusOK, `"contact_email":"ops@example.com"`)
}

func TestPermissionsNeedSignIn(t *testing.T) {
	f := newFixture(t)
	f.call("", "GET", "/permissions", "", http.StatusUnauthorized)
	f.call(f.user("climber"), "GET", "/permissions", "", http.StatusOK, `"name":"manage_settings"`)
}

func TestPlatformAdminGymGuards(t *testing.T) {
	f := newFixture(t)
	gym := f.createGym("gym-a", "Gym A", true)
	other := f.createGym("gym-b", "Gym B", true)
	path := "/gyms/" + gym

	f.call(f.operator, "PATCH", path, `{"previous_slugs":["gym-b"]}`, http.StatusBadRequest, "previous_slugs")
	f.call(f.operator, "PATCH", path, `{"previous_slugs":["Not A Slug"]}`, http.StatusBadRequest, "previous_slugs")
	f.call(f.operator, "PATCH", path, `{"previous_slugs":["gym-a-old"]}`, http.StatusOK, `"gym-a-old"`)
	f.call(f.operator, "PATCH", "/gyms/"+other, `{"previous_slugs":["gym-a-old"]}`, http.StatusBadRequest, "previous_slugs")
	f.call(f.operator, "PATCH", path, `{"features":{"teleport":true}}`, http.StatusBadRequest, "teleport")
	f.call(f.operator, "POST", "/gyms", `{"slug":"gym-c","name":"C","features":{"teleport":true}}`, http.StatusBadRequest, "teleport")

	f.call(f.operator, "PATCH", path, `{"active":false}`, http.StatusOK)
	f.call(f.operator, "PATCH", path, `{"name":"Hidden"}`, http.StatusOK)
	var leaked int
	f.scalar(`SELECT count(*) FROM events WHERE topic = 'gym:' || $1 AND payload->'record'->>'active' = 'false' AND audience->>'public' = 'true'`, &leaked, gym)
	if leaked != 0 {
		t.Errorf("%d public events of an inactive gym", leaked)
	}
}

func TestRoutesAnswerWithTheServerVersion(t *testing.T) {
	previous := config.Version
	config.Version = "1.5.0"
	t.Cleanup(func() { config.Version = previous })
	f := newFixture(t)

	req := httptest.NewRequest("GET", "/api/gyms", nil)
	rec := httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Header().Get(httpx.VersionHeader) != "1.5.0" {
		t.Fatalf("status %d, version header %q", rec.Code, rec.Header().Get(httpx.VersionHeader))
	}

	req = httptest.NewRequest("GET", "/api/gyms", nil)
	req.Header.Set(httpx.VersionHeader, "2.0.0")
	rec = httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "unsupported_version") {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
}
