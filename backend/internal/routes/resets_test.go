package routes

import (
	"net/http"
	"testing"

	"gripello/internal/platform/ids"
)

func TestPlanRouteRemoval(t *testing.T) {
	f := newFixture(t)
	wall := f.wall(f.hall, "Slab")
	crimp := f.route(`,"wall":"` + wall + `"`)
	sloper := f.route(`,"wall":"` + wall + `"`)
	f.exec(`UPDATE users SET followed_walls = ARRAY[$1] WHERE username = 'climber' RETURNING id`, wall)
	plan := func(user, body string, status int) map[string]any {
		t.Helper()
		return f.call(user, "PUT", "/gyms/"+f.gymA+"/routes/removal", body, status)
	}
	notified := func() string {
		return f.exec(`SELECT COUNT(*)::text FROM events WHERE topic = 'notify' AND payload->>'type' = 'wall_reset_planned'`)
	}

	plan("climber", `{"ids":["`+crimp+`"],"planned_for":"2026-11-02"}`, http.StatusForbidden)
	plan("setterB", `{"ids":["`+crimp+`"],"planned_for":"2026-11-02"}`, http.StatusForbidden)
	plan("setter", `{"ids":["`+crimp+`"],"planned_for":"soon"}`, http.StatusBadRequest)

	planned := items(plan("setter", `{"ids":["`+crimp+`","`+sloper+`"],"planned_for":"2026-11-02"}`, http.StatusOK))
	if len(planned) != 2 || planned[0].(map[string]any)["removal_planned_for"] != "2026-11-02" {
		t.Fatalf("planned = %v", planned)
	}
	if got := f.exec(`SELECT payload->'params'->>'count' FROM events WHERE topic = 'notify' AND payload->>'type' = 'wall_reset_planned'`); got != "2" {
		t.Fatalf("notification count param = %s, want one notification for both routes", got)
	}
	plan("setter", `{"ids":["`+crimp+`"],"planned_for":"2026-11-02"}`, http.StatusOK)
	if got := notified(); got != "1" {
		t.Fatalf("followers notified %s times, want once per date", got)
	}

	cleared := items(plan("setter", `{"ids":["`+sloper+`"],"planned_for":null}`, http.StatusOK))
	if cleared[0].(map[string]any)["removal_planned_for"] != nil {
		t.Fatalf("cleared = %v", cleared)
	}

	f.call("setter", "POST", "/routes/"+crimp+"/archive", "", http.StatusOK)
	if f.exec(`SELECT COALESCE(removal_planned_for::text, 'none') FROM routes WHERE id = $1`, crimp) != "none" {
		t.Fatal("archiving should clear the planned removal")
	}
	plan("setter", `{"ids":["`+crimp+`"],"planned_for":"2026-11-02"}`, http.StatusNotFound)
}

func TestResetStats(t *testing.T) {
	f := newFixture(t)
	busy := f.route("")
	quiet := f.route("")
	climber := f.exec(`SELECT id FROM users WHERE username = 'climber'`)
	setter := f.exec(`SELECT id FROM users WHERE username = 'setter'`)
	for _, row := range []struct {
		user, date string
	}{{climber, "now()"}, {climber, "now() - interval '60 days'"}, {setter, "now() - interval '1 day'"}} {
		f.exec(`INSERT INTO ticks (id, "user", route, type, attempts, date) VALUES ($1, $2, $3, 'top', 1, `+row.date+`) RETURNING id`, ids.New(), row.user, busy)
	}
	f.exec(`UPDATE routes SET grade_index = 15 WHERE id = $1 RETURNING id`, busy)
	for _, vote := range []struct {
		user  string
		stars int
		grade float64
	}{{climber, 2, 16}, {setter, 3, 16.5}, {"", 0, 16.5}} {
		f.exec(`INSERT INTO ratings (id, gym, route_id, "user", rating, grade_index) VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6) RETURNING id`,
			ids.New(), f.gymA, busy, vote.user, vote.stars, vote.grade)
	}

	f.call("climber", "GET", "/gyms/"+f.gymA+"/routes/reset-stats", "", http.StatusForbidden)
	stats := map[string]map[string]any{}
	for _, item := range items(f.call("setter", "GET", "/gyms/"+f.gymA+"/routes/reset-stats?location="+f.hall, "", http.StatusOK)) {
		stat := item.(map[string]any)
		stats[stat["route"].(string)] = stat
	}
	got := stats[busy]
	if got["ticks"] != 3.0 || got["recent_ticks"] != 2.0 || got["climbers"] != 2.0 || got["ratings"] != 2.0 || got["average_rating"] != 2.5 {
		t.Fatalf("busy stats = %v", got)
	}
	if deviation, _ := got["grade_deviation"].(float64); deviation < 1.32 || deviation > 1.34 {
		t.Fatalf("grade_deviation = %v, want 16.33 - 15", got["grade_deviation"])
	}
	if stats[quiet]["ticks"] != 0.0 || stats[quiet]["last_tick"] != nil || stats[quiet]["grade_deviation"] != nil {
		t.Fatalf("quiet stats = %v", stats[quiet])
	}
}
