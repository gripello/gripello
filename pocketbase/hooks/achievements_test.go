package hooks

import (
	"net/http"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
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

func TestAchievementsAwardNotifyAndPrivacy(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id})
	route := saveRecord(t, f.app, "routes", map[string]any{"name": "Crimp", "grade": "6a", "grade_system": "font", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id})
	other := saveRecord(t, f.app, "routes", map[string]any{"name": "Sloper", "grade": "6b", "grade_system": "font", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id})
	today := time.Now().UTC().Format(time.DateOnly)
	notified := func(userID string) int {
		records, _ := f.app.FindAllRecords("notifications", dbx.HashExp{"user": userID, "type": "achievement_earned"})
		return len(records)
	}
	badges := func(userID string) int {
		records, _ := f.app.FindAllRecords("user_badges", dbx.HashExp{"user": userID})
		return len(records)
	}

	saveRecord(t, f.app, "ticks", map[string]any{"user": f.climber.Id, "route": route.Id, "type": "flash", "attempts": 1, "date": today + " 12:00:00.000Z"})
	waitForAchievements()
	if badges(f.climber.Id) == 0 || notified(f.climber.Id) != 1 {
		t.Fatalf("a new climber's first send: badges %d, notifications %d", badges(f.climber.Id), notified(f.climber.Id))
	}

	old := time.Now().UTC().AddDate(0, 0, -40).Format(time.DateOnly)
	saveRecord(t, f.app, "ticks", map[string]any{"user": f.setterA.Id, "route": route.Id, "type": "top", "attempts": 3, "date": old + " 12:00:00.000Z"})
	waitForAchievements()
	if badges(f.setterA.Id) == 0 || notified(f.setterA.Id) != 0 {
		t.Fatalf("history is seeded silently: badges %d, notifications %d", badges(f.setterA.Id), notified(f.setterA.Id))
	}
	saveRecord(t, f.app, "ticks", map[string]any{"user": f.setterA.Id, "route": other.Id, "type": "flash", "attempts": 1, "date": today + " 12:00:00.000Z"})
	waitForAchievements()
	if notified(f.setterA.Id) != 1 {
		t.Fatalf("a new tier after seeding notifies once, got %d", notified(f.setterA.Id))
	}

	url := "/api/climbers/" + f.climber.Id + "/achievements"
	call(t, f.app, f.climber, http.MethodGet, url, "", http.StatusOK, `"key":"grade_ladder"`, `"key":"sends"`)
	call(t, f.app, nil, http.MethodGet, url, "", http.StatusUnauthorized)
	call(t, f.app, f.setterA, http.MethodGet, url, "", http.StatusOK)
	block := saveRecord(t, f.app, "blocks", map[string]any{"blocker": f.climber.Id, "blocked": f.setterA.Id})
	call(t, f.app, f.setterA, http.MethodGet, url, "", http.StatusNotFound)
	if err := f.app.Delete(block); err != nil {
		t.Fatal(err)
	}
	f.climber.Set("ticks_private", true)
	if err := f.app.Save(f.climber); err != nil {
		t.Fatal(err)
	}
	call(t, f.app, f.setterA, http.MethodGet, url, "", http.StatusNotFound)
	call(t, f.app, f.setterA, http.MethodGet, "/api/climbers/"+f.setterA.Id+"/achievements", "", http.StatusOK, `"key":"flash_grades"`)
}

func countRecords(t *testing.T, app core.App, collection string, filter dbx.HashExp) int {
	t.Helper()
	records, err := app.FindAllRecords(collection, filter)
	if err != nil {
		t.Fatal(err)
	}
	return len(records)
}

func TestFirstTierAfterAttemptHistoryNotifies(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id})
	route := saveRecord(t, f.app, "routes", map[string]any{"name": "Crimp", "grade": "6a", "grade_system": "font", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id})
	notifications := dbx.HashExp{"user": f.climber.Id, "type": "achievement_earned"}

	saveRecord(t, f.app, "ticks", map[string]any{"user": f.climber.Id, "route": route.Id, "type": "attempt", "attempts": 3, "date": time.Now().AddDate(0, 0, -40)})
	waitForAchievements()
	if got := countRecords(t, f.app, "user_badges", dbx.HashExp{"user": f.climber.Id}); got != 0 {
		t.Fatalf("attempts alone earn nothing, got %d badges", got)
	}
	for range 5 {
		saveRecord(t, f.app, "ticks", map[string]any{"user": f.climber.Id, "route": route.Id, "type": "top", "attempts": 1, "date": time.Now()})
	}
	waitForAchievements()
	if got := countRecords(t, f.app, "notifications", notifications); got != 1 {
		t.Fatalf("a first tier earned today notifies once despite older attempts, got %d", got)
	}
}

func TestCommunityMetrics(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Bouldering", "gym": f.gymA.Id, "map": map[string]any{"width": 20, "height": 20, "shapes": []any{}}})
	newWall := func(name string) *core.Record {
		return saveRecord(t, f.app, "walls", map[string]any{"location": hall.Id, "name": name, "outline": [][2]float64{{1, 1}, {2, 1}, {2, 2}}, "edge": [][2]float64{{1, 1}, {2, 1}}})
	}
	slab, roof := newWall("Slab"), newWall("Roof")
	routesOn := func(wall *core.Record) []*core.Record {
		routes := []*core.Record{}
		for range wallClearMinimum {
			routes = append(routes, saveRecord(t, f.app, "routes", map[string]any{"name": "R", "grade": "6a", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id, "wall": wall.Id}))
		}
		return routes
	}
	slabRoutes, roofRoutes := routesOn(slab), routesOn(roof)
	saveRecord(t, f.app, "ticks", map[string]any{"user": f.setterA.Id, "route": slabRoutes[0].Id, "type": "top", "attempts": 1, "date": time.Now().AddDate(0, 0, -1)})
	for _, route := range slabRoutes {
		saveRecord(t, f.app, "ticks", map[string]any{"user": f.climber.Id, "route": route.Id, "type": "top", "attempts": 1, "date": time.Now()})
	}
	saveRecord(t, f.app, "ticks", map[string]any{"user": f.climber.Id, "route": roofRoutes[0].Id, "type": "attempt", "attempts": 1, "date": time.Now().AddDate(0, 0, -2)})

	saveRecord(t, f.app, "ratings", map[string]any{"user": f.climber.Id, "route_id": slabRoutes[0].Id, "rating": 4})
	saveRecord(t, f.app, "beta_videos", map[string]any{"user": f.climber.Id, "route": slabRoutes[0].Id, "url": "https://youtube.com/shorts/123"})
	saveRecord(t, f.app, "follows", map[string]any{"follower": f.climber.Id, "followee": f.setterA.Id})
	saveRecord(t, f.app, "follows", map[string]any{"follower": f.climber.Id, "followee": f.adminA.Id})
	accepted := followOf(t, f.app, f.climber, f.setterA)
	accepted.Set("status", "accepted")
	if err := f.app.Save(accepted); err != nil {
		t.Fatal(err)
	}
	for _, status := range []string{"done", "open"} {
		saveRecord(t, f.app, "tasks", map[string]any{"gym": f.gymA.Id, "kind": "defect", "category": "loose_hold", "priority": 4, "status": status, "route": slabRoutes[1].Id, "reporter": f.climber.Id, "description": "loose"})
	}
	competition, _ := saveCompetition(t, f.app, f.gymA.Id)
	category := saveRecord(t, f.app, "competition_categories", map[string]any{"name": "Open", "competition": competition.Id})
	saveRecord(t, f.app, "competition_entries", map[string]any{"competition": competition.Id, "category": category.Id, "user": f.climber.Id, "display_name": "C", "birth_year": 1990, "status": "registered", "bib": 1})
	waitForAchievements()

	metrics := communityMetrics(f.app, f.climber.Id)
	want := map[string]int{"first_ascents": 2, "wall_clears": 1, "reviews": 1, "betas": 1, "friends": 1, "helper": 1, "competitions": 1}
	for key, value := range want {
		if metrics[key].Value != value {
			t.Errorf("%s = %d, want %d", key, metrics[key].Value, value)
		}
	}
	if got := communityMetrics(f.app, f.setterA.Id); got["first_ascents"].Value != 1 || got["wall_clears"].Value != 0 || got["friends"].Value != 1 {
		t.Errorf("setter metrics = %+v", got)
	}
}

func TestSeasonTopTens(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id})
	route := saveRecord(t, f.app, "routes", map[string]any{"name": "7A", "grade": "7A", "grade_system": "font", "grade_index": 18.5, "type": "Boulder", "creator": []string{"S"}, "location": hall.Id})
	now := time.Now()
	saveRecord(t, f.app, "ticks", map[string]any{"user": f.climber.Id, "route": route.Id, "type": "flash", "attempts": 1, "date": now.AddDate(0, 0, -5)})
	waitForAchievements()
	topTen := dbx.HashExp{"user": f.climber.Id, "key": "season_top10"}
	if got := countRecords(t, f.app, "user_badges", topTen); got != 0 {
		t.Fatalf("no season yet, got %d season badges", got)
	}

	saveRecord(t, f.app, "seasons", map[string]any{"gym": f.gymA.Id, "name": "Running", "starts_at": now.AddDate(0, 0, -3), "ends_at": now.AddDate(0, 0, 3)})
	if got := seasonTopTens(f.app, f.climber.Id, []string{f.gymA.Id}, now); got != 0 {
		t.Fatalf("a running season doesn't count, got %d", got)
	}
	saveRecord(t, f.app, "seasons", map[string]any{"gym": f.gymA.Id, "name": "Autumn", "starts_at": now.AddDate(0, 0, -30), "ends_at": now.AddDate(0, 0, -1)})
	evaluateFinishedSeasons(f.app, now)
	waitForAchievements()
	if got := countRecords(t, f.app, "user_badges", topTen); got != 1 {
		t.Fatalf("finished season awards its top ten, got %d", got)
	}
	if got := countRecords(t, f.app, "notifications", dbx.HashExp{"user": f.climber.Id, "type": "achievement_earned"}); got != 1 {
		t.Fatalf("the season placement notifies, got %d", got)
	}
	if got := seasonTopTens(f.app, f.climber.Id, []string{f.gymA.Id}, now); got != 1 {
		t.Fatalf("seasonTopTens = %d, want 1", got)
	}
	if got := seasonTopTens(f.app, f.setterA.Id, []string{f.gymA.Id}, now); got != 0 {
		t.Fatalf("a climber without sends placed in %d seasons", got)
	}
}

func TestAchievementRunsWaitForAFreeSlot(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id})
	route := saveRecord(t, f.app, "routes", map[string]any{"name": "Crimp", "grade": "6a", "grade_system": "font", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id})
	for range cap(achievementSlots) {
		achievementSlots <- struct{}{}
	}
	saveRecord(t, f.app, "ticks", map[string]any{"user": f.climber.Id, "route": route.Id, "type": "flash", "attempts": 1, "date": time.Now().UTC().Format(time.DateOnly) + " 12:00:00.000Z"})
	time.Sleep(100 * time.Millisecond)
	if got := countRecords(t, f.app, "user_badges", dbx.HashExp{"user": f.climber.Id}); got != 0 {
		t.Fatalf("evaluated without a free slot: %d badges", got)
	}
	for range cap(achievementSlots) {
		<-achievementSlots
	}
	waitForAchievements()
	if got := countRecords(t, f.app, "user_badges", dbx.HashExp{"user": f.climber.Id}); got == 0 {
		t.Fatal("queued evaluation never ran")
	}
}
