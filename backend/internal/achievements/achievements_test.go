package achievements

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/events"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/jobs"
	"gripello/internal/platform/testapp"
)

func mustDay(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.DateOnly, value)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}

func TestActiveWeeksForgivesOneEmptyWeek(t *testing.T) {
	days := []string{"2026-09-07", "2026-09-14", "2026-09-28", "2026-10-05", "2026-11-02"}
	best, current := activeWeeks(days, mustDay(t, "2026-11-04"))
	if best != 4 || current != 1 {
		t.Fatalf("activeWeeks = %d, %d; want 4, 1", best, current)
	}
	if _, current := activeWeeks(days, mustDay(t, "2026-12-01")); current != 0 {
		t.Fatalf("current run after three empty weeks = %d, want 0", current)
	}
}

func TestPerfectMonthNeedsEveryWeek(t *testing.T) {
	full := []string{"2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22", "2026-06-29"}
	if got := perfectMonths(full, mustDay(t, "2026-07-10")); len(got) != 1 || got[0] != "2026-06-29" {
		t.Fatalf("perfectMonths(full June) = %v", got)
	}
	if got := perfectMonths(full[:4], mustDay(t, "2026-07-10")); len(got) != 0 {
		t.Fatalf("perfectMonths(missing week) = %v, want none", got)
	}
}

func TestComebacksAndPyramid(t *testing.T) {
	if got := comebacks([]string{"2026-01-01", "2026-01-10", "2026-02-15"}); len(got) != 1 || got[0] != "2026-02-15" {
		t.Fatalf("comebacks = %v", got)
	}
	if !hasPyramid(map[float64]int{16: 1, 15: 2, 14: 4}) {
		t.Fatal("1-2-4 should be a pyramid")
	}
	if hasPyramid(map[float64]int{16: 1, 15: 1, 14: 4}) {
		t.Fatal("1-1-4 is not a pyramid")
	}
}

func TestTickMetrics(t *testing.T) {
	ticks := []achievementTick{
		{Route: "a", Type: "attempt", Attempts: 4, Date: "2026-09-01", GradeSystem: "font", Grade: "6a", GradeIndex: 14},
		{Route: "a", Type: "top", Attempts: 2, Date: "2026-09-02", GradeSystem: "font", Grade: "6a", GradeIndex: 14, Gym: "g", Wall: "w1", Color: "red", ScrewDate: "2026-08-30"},
		{Route: "b", Type: "flash", Date: "2026-09-02", GradeSystem: "font", Grade: "6b", GradeIndex: 16, Gym: "g", Wall: "w2", Color: "blue", ArchivedAt: "2026-09-05"},
		{Route: "b", Type: "top", Date: "2026-09-03", GradeSystem: "font", Grade: "6b", GradeIndex: 16},
		{Route: "c", Type: "top", Date: "2026-09-04", GradeSystem: "uiaa", Grade: "6", GradeIndex: 12, Gym: "h"},
		{RouteName: "Gone", Type: "top", Date: "2026-09-04", GradeSystem: "font", Grade: "5", GradeIndex: 10},
	}
	metrics := tickMetrics(ticks, mustDay(t, "2026-09-10"))
	want := map[string]int{
		"sends": 4, "sessions": 4, "flashes": 1, "project": 6, "personal_bests": 1,
		"walls": 2, "colors": 2, "gyms": 2, "all_rounder": 1, "set_sweeper": 1, "before_strip": 1, "grade_ladder": 3,
	}
	for key, value := range want {
		if metrics[key].Value != value {
			t.Errorf("%s = %d, want %d", key, metrics[key].Value, value)
		}
	}
	if metrics["sends"].Days[0] != "2026-09-02" {
		t.Errorf("first send day = %s", metrics["sends"].Days[0])
	}
}

type fixture struct {
	t      *testing.T
	m      *module
	gym    string
	hall   string
	users  map[string]string
	tokens map[string]string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	app := testapp.App(t)
	f := &fixture{t: t, m: newModule(app), users: map[string]string{}, tokens: map[string]string{}}
	f.gym = f.exec(`INSERT INTO gyms (id, slug, name, active) VALUES ($1, 'alpha', 'Alpha', true) RETURNING id`, ids.New())
	f.hall = f.exec(`INSERT INTO locations (id, gym, name) VALUES ($1, $2, 'Hall') RETURNING id`, ids.New(), f.gym)
	for _, name := range []string{"climber", "setter", "admin"} {
		id := f.exec(`INSERT INTO users (id, username, token_key) VALUES ($1, $2, $3) RETURNING id`, ids.New(), name, "key-"+name)
		token, err := app.Tokens.Sign(id, "key-"+name, "")
		if err != nil {
			t.Fatal(err)
		}
		f.users[name], f.tokens[name] = id, token
	}
	return f
}

func (f *fixture) exec(sql string, args ...any) string {
	f.t.Helper()
	var id string
	if err := f.m.app.DB.QueryRow(context.Background(), sql, args...).Scan(&id); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return id
}

func (f *fixture) count(sql string, args ...any) int {
	f.t.Helper()
	var n int
	if err := f.m.app.DB.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return n
}

func (f *fixture) route(grade string, gradeIndex float64, wall any) string {
	return f.exec(`INSERT INTO routes (id, gym, name, grade, grade_system, grade_index, type, location, wall) VALUES ($1, $2, 'R', $3, 'font', $4, 'Boulder', $5, $6) RETURNING id`,
		ids.New(), f.gym, grade, gradeIndex, f.hall, wall)
}

func (f *fixture) tick(user, route, kind string, at time.Time) {
	f.exec(`INSERT INTO ticks (id, "user", route, type, attempts, date, grade, grade_system, grade_index)
		SELECT $1, $2, id, $3, 1, $4, grade, grade_system, grade_index FROM routes WHERE id = $5 RETURNING id`, ids.New(), user, kind, at, route)
}

// evaluate runs the worker the way the queue would, for a climber or every pending job.
func (f *fixture) evaluate(user string) {
	f.t.Helper()
	if err := f.m.evaluate(context.Background(), jobs.Job{Kind: jobKind, Key: user}); err != nil {
		f.t.Fatal(err)
	}
}

func (f *fixture) runQueued() {
	f.t.Helper()
	rows, _ := f.m.app.DB.Query(context.Background(), `DELETE FROM jobs WHERE kind = $1 RETURNING key`, jobKind)
	keys, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		f.t.Fatal(err)
	}
	for _, key := range keys {
		f.evaluate(key)
	}
}

func (f *fixture) queued(user string) bool {
	return f.count(`SELECT COUNT(*) FROM jobs WHERE kind = $1 AND key = $2`, jobKind, user) > 0
}

func (f *fixture) notified(user string) int {
	return f.count(`SELECT COUNT(*) FROM events WHERE topic = 'notify' AND payload->>'type' = 'achievement_earned' AND payload->'users' ? $1`, user)
}

func (f *fixture) badges(user string, key ...string) int {
	if len(key) > 0 {
		return f.count(`SELECT COUNT(*) FROM user_badges WHERE "user" = $1 AND key = $2`, user, key[0])
	}
	return f.count(`SELECT COUNT(*) FROM user_badges WHERE "user" = $1`, user)
}

func (f *fixture) get(user, path string, status int, contains ...string) {
	f.t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api"+path, nil)
	if user != "" {
		request.Header.Set("Authorization", f.tokens[user])
	}
	recorder := httptest.NewRecorder()
	testapp.Handler(f.m.app).ServeHTTP(recorder, request)
	if recorder.Code != status {
		f.t.Fatalf("GET %s as %q = %d, want %d: %s", path, user, recorder.Code, status, recorder.Body.String())
	}
	for _, want := range contains {
		if !strings.Contains(recorder.Body.String(), want) {
			f.t.Errorf("GET %s as %q lacks %s", path, user, want)
		}
	}
}

func TestAchievementsAwardNotifyAndPrivacy(t *testing.T) {
	f := newFixture(t)
	route, other := f.route("6a", 14, nil), f.route("6b", 16, nil)
	climber, setter := f.users["climber"], f.users["setter"]

	f.tick(climber, route, "flash", time.Now())
	f.evaluate(climber)
	if f.badges(climber) == 0 || f.notified(climber) != 1 {
		t.Fatalf("a new climber's first send: badges %d, notifications %d", f.badges(climber), f.notified(climber))
	}

	f.tick(setter, route, "top", time.Now().AddDate(0, 0, -40))
	f.evaluate(setter)
	if f.badges(setter) == 0 || f.notified(setter) != 0 {
		t.Fatalf("history is seeded silently: badges %d, notifications %d", f.badges(setter), f.notified(setter))
	}
	f.tick(setter, other, "flash", time.Now())
	f.evaluate(setter)
	if f.notified(setter) != 1 {
		t.Fatalf("a new tier after seeding notifies once, got %d", f.notified(setter))
	}

	path := "/climbers/" + climber + "/achievements"
	f.get("climber", path, http.StatusOK, `"key":"grade_ladder"`, `"key":"sends"`)
	f.get("", path, http.StatusUnauthorized)
	f.get("setter", path, http.StatusNotFound)
	f.get("setter", "/climbers/missing/achievements", http.StatusNotFound)
	follow := f.exec(`INSERT INTO follows (id, follower, followee, status) VALUES ($1, $2, $3, 'pending') RETURNING id`, ids.New(), setter, climber)
	f.get("setter", path, http.StatusNotFound)
	f.exec(`UPDATE follows SET status = 'accepted' WHERE id = $1 RETURNING id`, follow)
	f.get("setter", path, http.StatusOK, `"current":0`, `"earned":[""]`)
	block := f.exec(`INSERT INTO blocks (id, blocker, blocked) VALUES ($1, $2, $3) RETURNING id`, ids.New(), climber, setter)
	f.get("setter", path, http.StatusNotFound)
	f.exec(`DELETE FROM blocks WHERE id = $1 RETURNING id`, block)
	f.exec(`DELETE FROM follows WHERE id = $1 RETURNING id`, follow)
	f.exec(`INSERT INTO follows (id, follower, followee, status) VALUES ($1, $2, $3, 'pending') RETURNING id`, ids.New(), climber, setter)
	f.get("setter", path, http.StatusOK)
	f.exec(`UPDATE users SET ticks_private = true WHERE id = $1 RETURNING id`, climber)
	f.get("setter", path, http.StatusNotFound)
	f.get("setter", "/climbers/"+setter+"/achievements", http.StatusOK, `"key":"flash_grades"`)
}

func TestOtherViewersAreLimitedAndShareACache(t *testing.T) {
	f := newFixture(t)
	climber, setter := f.users["climber"], f.users["setter"]
	f.exec(`INSERT INTO follows (id, follower, followee, status) VALUES ($1, $2, $3, 'accepted') RETURNING id`, ids.New(), setter, climber)
	path := "/climbers/" + climber + "/achievements"
	sends := func(now time.Time) int {
		views, err := f.m.publicViews(context.Background(), climber, now)
		if err != nil {
			t.Fatal(err)
		}
		for _, view := range views {
			if view.Key == "sends" {
				return view.Value
			}
		}
		return -1
	}
	now := time.Now()
	if sends(now) != 0 {
		t.Fatal("no sends yet")
	}
	f.tick(climber, f.route("6a", 14, nil), "top", now)
	if sends(now.Add(time.Second)) != 0 || sends(now.Add(2*publicCacheTTL)) != 1 {
		t.Error("other viewers should see the cached result for a minute")
	}
	f.get("climber", path, http.StatusOK, `"current":1`)
	for range lookupsPerMinute {
		f.m.lookups.Allow(setter, time.Now())
	}
	f.get("setter", path, http.StatusTooManyRequests)
}

func TestFirstTierAfterAttemptHistoryNotifies(t *testing.T) {
	f := newFixture(t)
	route := f.route("6a", 14, nil)
	climber := f.users["climber"]

	f.tick(climber, route, "attempt", time.Now().AddDate(0, 0, -40))
	f.evaluate(climber)
	if got := f.badges(climber); got != 0 {
		t.Fatalf("attempts alone earn nothing, got %d badges", got)
	}
	for range 5 {
		f.tick(climber, route, "top", time.Now())
	}
	f.evaluate(climber)
	if got := f.notified(climber); got != 1 {
		t.Fatalf("a first tier earned today notifies once despite older attempts, got %d", got)
	}
}

func TestCommunityMetrics(t *testing.T) {
	f := newFixture(t)
	climber, setter, admin := f.users["climber"], f.users["setter"], f.users["admin"]
	newWall := func(name string) string {
		return f.exec(`INSERT INTO walls (id, gym, location, name, outline, edge) VALUES ($1, $2, $3, $4, '[[1,1],[2,1],[2,2]]', '[[1,1],[2,1]]') RETURNING id`,
			ids.New(), f.gym, f.hall, name)
	}
	routesOn := func(wall string) []string {
		routes := []string{}
		for range wallClearMinimum {
			routes = append(routes, f.route("6a", 14, wall))
		}
		return routes
	}
	slabRoutes, roofRoutes := routesOn(newWall("Slab")), routesOn(newWall("Roof"))
	f.tick(setter, slabRoutes[0], "top", time.Now().AddDate(0, 0, -1))
	for _, route := range slabRoutes {
		f.tick(climber, route, "top", time.Now())
	}
	f.tick(climber, roofRoutes[0], "attempt", time.Now().AddDate(0, 0, -2))

	f.exec(`INSERT INTO ratings (id, gym, route_id, "user", rating) VALUES ($1, $2, $3, $4, 4) RETURNING id`, ids.New(), f.gym, slabRoutes[0], climber)
	f.exec(`INSERT INTO beta_videos (id, gym, route, "user", url) VALUES ($1, $2, $3, $4, 'https://youtube.com/shorts/123') RETURNING id`, ids.New(), f.gym, slabRoutes[0], climber)
	f.exec(`INSERT INTO follows (id, follower, followee, status) VALUES ($1, $2, $3, 'accepted') RETURNING id`, ids.New(), climber, setter)
	f.exec(`INSERT INTO follows (id, follower, followee, status) VALUES ($1, $2, $3, 'pending') RETURNING id`, ids.New(), climber, admin)
	for _, status := range []string{"done", "open"} {
		f.exec(`INSERT INTO tasks (id, gym, kind, category, priority, status, route, reporter, description) VALUES ($1, $2, 'defect', 'loose_hold', 4, $3, $4, $5, 'loose') RETURNING id`,
			ids.New(), f.gym, status, slabRoutes[1], climber)
	}
	competition := f.exec(`INSERT INTO competitions (id, gym, name, location, status, starts_at, ends_at, scoring_format, discipline)
		VALUES ($1, $2, 'Cup', $3, 'open', now(), now() + interval '1 day', 'tops', 'boulder') RETURNING id`, ids.New(), f.gym, f.hall)
	category := f.exec(`INSERT INTO competition_categories (id, competition, name) VALUES ($1, $2, 'Open') RETURNING id`, ids.New(), competition)
	f.exec(`INSERT INTO competition_entries (id, competition, category, "user", display_name, birth_year, status, bib) VALUES ($1, $2, $3, $4, 'C', 1990, 'registered', 1) RETURNING id`,
		ids.New(), competition, category, climber)

	ctx := context.Background()
	metrics, err := communityMetrics(ctx, f.m.app.DB, climber)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]int{"first_ascents": 2, "wall_clears": 1, "reviews": 1, "betas": 1, "friends": 1, "helper": 1, "competitions": 1}
	for key, value := range want {
		if metrics[key].Value != value {
			t.Errorf("%s = %d, want %d", key, metrics[key].Value, value)
		}
	}
	got, err := communityMetrics(ctx, f.m.app.DB, setter)
	if err != nil {
		t.Fatal(err)
	}
	if got["first_ascents"].Value != 1 || got["wall_clears"].Value != 0 || got["friends"].Value != 1 {
		t.Errorf("setter metrics = %+v", got)
	}
}

func TestSeasonTopTens(t *testing.T) {
	f := newFixture(t)
	climber, setter := f.users["climber"], f.users["setter"]
	route := f.route("7A", 18.5, nil)
	now := time.Now()
	f.tick(climber, route, "flash", now.AddDate(0, 0, -5))
	f.evaluate(climber)
	if got := f.badges(climber, "season_top10"); got != 0 {
		t.Fatalf("no season yet, got %d season badges", got)
	}
	placements := func(user string) int {
		metrics, err := communityMetrics(context.Background(), f.m.app.DB, user)
		if err != nil {
			t.Fatal(err)
		}
		return metrics["season_top10"].Value
	}

	f.exec(`INSERT INTO seasons (id, gym, name, starts_at, ends_at) VALUES ($1, $2, 'Running', $3, $4) RETURNING id`, ids.New(), f.gym, now.AddDate(0, 0, -3), now.AddDate(0, 0, 3))
	if got := placements(climber); got != 0 {
		t.Fatalf("a running season doesn't count, got %d", got)
	}
	f.exec(`INSERT INTO seasons (id, gym, name, starts_at, ends_at) VALUES ($1, $2, 'Autumn', $3, $4) RETURNING id`, ids.New(), f.gym, now.AddDate(0, 0, -30), now.AddDate(0, 0, -1))
	if err := f.m.queueSeasonPlacements(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	if !f.queued(climber) || f.queued(setter) {
		t.Fatal("the cron queues exactly the season's top ten")
	}
	f.runQueued()
	if got := f.badges(climber, "season_top10"); got != 1 {
		t.Fatalf("finished season awards its top ten, got %d", got)
	}
	if got := f.notified(climber); got != 1 {
		t.Fatalf("the season placement notifies, got %d", got)
	}
	if got := placements(climber); got != 1 {
		t.Fatalf("season_top10 = %d, want 1", got)
	}
	if got := placements(setter); got != 0 {
		t.Fatalf("a climber without sends placed in %d seasons", got)
	}
	if err := f.m.queueSeasonPlacements(context.Background(), now.AddDate(0, 0, 3)); err != nil || f.queued(climber) {
		t.Fatalf("seasons ended over 48 h ago are not re-queued (err %v)", err)
	}
}

func TestEventsQueueTheClimber(t *testing.T) {
	f := newFixture(t)
	climber, setter, admin := f.users["climber"], f.users["setter"], f.users["admin"]
	publish := func(topic, kind string, payload any) {
		err := pgx.BeginFunc(context.Background(), f.m.app.DB, func(tx pgx.Tx) error {
			return events.Publish(context.Background(), tx, topic, kind, payload, events.Audience{})
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, topic := range []string{"tick.changed", "rating.created", "beta.created", "entry.created"} {
		publish(topic, topic, map[string]string{"user": climber, "gym": f.gym})
		testapp.WaitFor(t, func() bool { return f.queued(climber) })
		f.exec(`DELETE FROM jobs RETURNING key`)
	}

	publish("follow.changed", "follow.changed", map[string]string{"follower": climber, "followee": setter, "status": "pending", "action": "create"})
	publish("notify", "notify", Notify{Type: "task_wish_done", Users: []string{admin}})
	publish("follow.changed", "follow.changed", map[string]string{"follower": climber, "followee": setter, "status": "accepted", "action": "update"})
	testapp.WaitFor(t, func() bool { return f.queued(climber) && f.queued(setter) })
	if f.queued(admin) {
		t.Fatal("only defect fixes queue the notified reporter")
	}
	publish("notify", "notify", Notify{Type: "task_defect_fixed", Users: []string{admin}})
	testapp.WaitFor(t, func() bool { return f.queued(admin) })

	f.tick(climber, f.route("6a", 14, nil), "flash", time.Now())
	f.runQueued()
	if f.badges(climber) == 0 || f.count(`SELECT COUNT(*) FROM jobs`) != 0 {
		t.Fatal("queued climbers are evaluated")
	}
}
