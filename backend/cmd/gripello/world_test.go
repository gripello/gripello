package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gripello/internal/platform"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/testapp"
)

var allGymPermissions = []string{
	"manage_users", "manage_settings", "manage_routes", "view_analytics", "manage_comments", "run_inventory",
	"manage_tasks", "manage_competitions", "judge_competitions", "manage_reports",
}

type world struct {
	t       *testing.T
	app     *platform.App
	handler http.Handler
	gymA    string
	gymB    string
	users   map[string]string
	records map[string]string
}

func newWorld(t *testing.T) *world {
	t.Helper()
	app := testapp.App(t)
	mount(app, func() bool { return false })
	w := &world{t: t, app: app, handler: testapp.Handler(app), users: map[string]string{}, records: map[string]string{}}
	w.gymA = w.insert(`INSERT INTO gyms (id, slug, name, active) VALUES ($1, 'gym-a', 'Gym A', true)`)
	w.gymB = w.insert(`INSERT INTO gyms (id, slug, name, active) VALUES ($1, 'gym-b', 'Gym B', true)`)
	adminRoleA := w.insert(`INSERT INTO roles (id, gym, name, permissions) VALUES ($1, $2, 'admin', $3)`, w.gymA, allGymPermissions)
	adminRoleB := w.insert(`INSERT INTO roles (id, gym, name, permissions) VALUES ($1, $2, 'admin', $3)`, w.gymB, allGymPermissions)
	helperRoleA := w.insert(`INSERT INTO roles (id, gym, name, permissions) VALUES ($1, $2, 'helper', '{manage_routes}')`, w.gymA)
	for _, name := range []string{"platform", "adminA", "adminB", "climber", "other"} {
		w.users[name] = w.insert(`INSERT INTO users (id, email, token_key, username, platform_admin, verified) VALUES ($1, $2, $3, $4, $5, true)`,
			strings.ToLower(name)+"@example.com", ids.New()+ids.New(), strings.ToLower(name), name == "platform")
	}
	w.insert(`INSERT INTO memberships (id, "user", gym, role) VALUES ($1, $2, $3, $4)`, w.users["adminA"], w.gymA, adminRoleA)
	w.insert(`INSERT INTO memberships (id, "user", gym, role) VALUES ($1, $2, $3, $4)`, w.users["adminB"], w.gymB, adminRoleB)
	climber := w.users["climber"]
	starts, ends := time.Now().Add(-time.Hour), time.Now().Add(time.Hour)
	w.records["role"] = helperRoleA
	w.records["membership"] = w.insert(`INSERT INTO memberships (id, "user", gym, role) VALUES ($1, $2, $3, $4)`, w.users["other"], w.gymA, helperRoleA)
	w.records["location"] = w.insert(`INSERT INTO locations (id, gym, name, map) VALUES ($1, $2, 'Hall', '{"width":30,"height":30,"shapes":[]}')`, w.gymA)
	w.records["wall"] = w.insert(`INSERT INTO walls (id, gym, location, name, outline, edge) VALUES ($1, $2, $3, 'Slab', '[[1,1],[2,1],[2,2]]', '[[1,1],[2,1]]')`, w.gymA, w.records["location"])
	w.records["route"] = w.insert(`INSERT INTO routes (id, gym, name, grade, type, location, wall) VALUES ($1, $2, 'Crimp', '6a', 'Boulder', $3, $4)`, w.gymA, w.records["location"], w.records["wall"])
	w.records["task"] = w.insert(`INSERT INTO tasks (id, gym, kind, status, priority, title) VALUES ($1, $2, 'other', 'open', 2, 'Clean')`, w.gymA)
	w.records["competition"] = w.insert(`INSERT INTO competitions (id, gym, name, location, status, starts_at, ends_at, scoring_format, discipline)
		VALUES ($1, $2, 'Jam', $3, 'open', $4, $5, 'dynamic', 'boulder')`, w.gymA, w.records["location"], starts, ends)
	w.records["category"] = w.insert(`INSERT INTO competition_categories (id, competition, name) VALUES ($1, $2, 'Open')`, w.records["competition"])
	w.records["entry"] = w.insert(`INSERT INTO competition_entries (id, competition, category, "user", display_name, status, birth_year)
		VALUES ($1, $2, $3, $4, 'Climber', 'registered', 1990)`, w.records["competition"], w.records["category"], climber)
	w.records["compRoute"] = w.insert(`INSERT INTO competition_routes (id, competition, route, number) VALUES ($1, $2, $3, 1)`, w.records["competition"], w.records["route"])
	w.records["score"] = w.insert(`INSERT INTO competition_scores (id, competition, entry, comp_route) VALUES ($1, $2, $3, $4)`,
		w.records["competition"], w.records["entry"], w.records["compRoute"])
	w.records["season"] = w.insert(`INSERT INTO seasons (id, gym, name, starts_at, ends_at) VALUES ($1, $2, 'Spring', $3, $4)`, w.gymA, starts, ends.AddDate(0, 0, 1))
	w.records["rating"] = w.insert(`INSERT INTO ratings (id, gym, route_id, "user", rating, comment) VALUES ($1, $2, $3, $4, 3, 'Nice')`, w.gymA, w.records["route"], climber)
	w.records["tick"] = w.insert(`INSERT INTO ticks (id, "user", route, type, attempts, date) VALUES ($1, $2, $3, 'top', 1, now())`, climber, w.records["route"])
	w.records["beta"] = w.insert(`INSERT INTO beta_videos (id, gym, route, "user", url) VALUES ($1, $2, $3, $4, 'https://youtube.com/shorts/abcdefghijk')`, w.gymA, w.records["route"], climber)
	w.records["invite"] = w.insert(`INSERT INTO invites (id, gym, role, email, token_hash, expires_at) VALUES ($1, $2, $3, 'new@example.com', 'hash', now() + interval '1 day')`, w.gymA, helperRoleA)
	w.records["moderation"] = w.insert(`INSERT INTO moderation_items (id, gym, content_type, content_id, author, state) VALUES ($1, $2, 'rating', $3, $4, 'unreviewed')`,
		w.gymA, w.records["rating"], climber)
	w.records["follow"] = w.insert(`INSERT INTO follows (id, follower, followee, status) VALUES ($1, $2, $3, 'pending')`, w.users["other"], climber)
	w.records["block"] = w.insert(`INSERT INTO blocks (id, blocker, blocked) VALUES ($1, $2, $3)`, climber, w.users["adminB"])
	w.records["notification"] = w.insert(`INSERT INTO notifications (id, "user", type) VALUES ($1, $2, 'follow_request')`, climber)
	w.records["pushSubscription"] = w.insert(`INSERT INTO push_subscriptions (id, "user", endpoint) VALUES ($1, $2, 'https://push.example.com/1')`, climber)
	w.records["mfa"] = w.insert(`INSERT INTO mfa_factors (id, "user", kind) VALUES ($1, $2, 'totp')`, climber)
	w.records["identity"] = w.insert(`INSERT INTO user_identities (id, "user", provider, subject) VALUES ($1, $2, 'google', 'subject')`, climber)
	w.records["session"] = w.insert(`INSERT INTO sessions (id, "user") VALUES ($1, $2)`, climber)
	w.records["onboarding"] = w.insert(`INSERT INTO gym_onboardings (id, email, token_hash, expires_at) VALUES ($1, 'owner@example.com', 'hash', now() + interval '1 day')`)
	w.records["retiredSlug"] = w.insert(`INSERT INTO retired_slugs (id, slug) VALUES ($1, 'old-gym')`)
	return w
}

func (w *world) insert(sql string, args ...any) string {
	w.t.Helper()
	id := ids.New()
	if _, err := w.app.DB.Exec(context.Background(), sql, append([]any{id}, args...)...); err != nil {
		w.t.Fatalf("%s: %v", sql, err)
	}
	return id
}

func (w *world) exec(sql string, args ...any) {
	w.t.Helper()
	if _, err := w.app.DB.Exec(context.Background(), sql, args...); err != nil {
		w.t.Fatal(err)
	}
}

var pathRecords = []struct{ prefix, record string }{
	{"/betas/", "beta"}, {"/blocks/", "block"}, {"/competition-categories/", "category"}, {"/competition-entries/", "entry"},
	{"/competition-routes/", "compRoute"}, {"/competition-scores/", "score"}, {"/competitions/", "competition"}, {"/follows/", "follow"},
	{"/invites/", "invite"}, {"/locations/", "location"}, {"/me/followed-walls/", "wall"}, {"/me/identities/", "identity"},
	{"/memberships/", "membership"}, {"/me/mfa/", "mfa"}, {"/me/notifications/", "notification"}, {"/me/push-subscriptions/", "pushSubscription"},
	{"/me/sessions/", "session"}, {"/platform/gym-onboardings/", "onboarding"}, {"/platform/retired-slugs/", "retiredSlug"},
	{"/ratings/", "rating"}, {"/roles/", "role"}, {"/routes/", "route"}, {"/seasons/", "season"}, {"/tasks/", "task"},
	{"/ticks/", "tick"}, {"/walls/", "wall"}, {"/moderation/authors/", "user:climber"}, {"/moderation/", "moderation"},
	{"/platform/users/", "user:climber"}, {"/platform/admins/", "user:other"}, {"/platform/gyms/", "gymA"},
}

// path fills a route pattern's placeholder with a record of gym A.
func (w *world) path(pattern string) string {
	start := strings.Index(pattern, "{")
	if start < 0 {
		return pattern
	}
	end := strings.Index(pattern, "}")
	prefix, param := pattern[:start], pattern[start+1:end]
	value := map[string]string{"gym": w.gymA, "provider": "google", "token": "unknown-token", "name": "gripello-20260101-000000.tar", "clientId": "client"}[param]
	if value == "" {
		for _, candidate := range pathRecords {
			if strings.HasPrefix(prefix, candidate.prefix) {
				if user, ok := strings.CutPrefix(candidate.record, "user:"); ok {
					value = w.users[user]
				} else if candidate.record == "gymA" {
					value = w.gymA
				} else {
					value = w.records[candidate.record]
				}
				break
			}
		}
	}
	if value == "" {
		value = "unknown00000000"
	}
	return w.path(prefix + value + pattern[end+1:])
}

func (w *world) token(user string) string {
	w.t.Helper()
	var key string
	if err := w.app.DB.QueryRow(context.Background(), `SELECT token_key FROM users WHERE id = $1`, w.users[user]).Scan(&key); err != nil {
		w.t.Fatal(err)
	}
	return testapp.Token(w.t, w.app, w.users[user], key)
}

func (w *world) call(user, method, path, body string) *httptest.ResponseRecorder {
	w.t.Helper()
	request := httptest.NewRequest(method, "/api"+path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if user != "" {
		request.Header.Set("Authorization", w.token(user))
	}
	recorder := httptest.NewRecorder()
	w.handler.ServeHTTP(recorder, request)
	return recorder
}

func writeRoutes(app *platform.App) []string {
	var routes []string
	for _, route := range app.Routes {
		if !strings.HasPrefix(route, "GET ") {
			routes = append(routes, route)
		}
	}
	return routes
}
