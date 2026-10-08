package hooks

import (
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func TestRankLeaderboard(t *testing.T) {
	sends := []leaderboardSend{
		{User: "a", Grade: "7A", GradeIndex: 18.5},
		{User: "b", Grade: "7A", GradeIndex: 18.5, Flash: true},
		{User: "c", Grade: "6A", GradeIndex: 15.7},
		{User: "c", Grade: "6A", GradeIndex: 15.7},
		{User: "d", Grade: "7A", GradeIndex: 18.5},
	}
	for range 12 {
		sends = append(sends, leaderboardSend{User: "e", Grade: "5", GradeIndex: 14.2})
	}
	rows := rankLeaderboard(sends)
	byUser := map[string]leaderboardRow{}
	for _, row := range rows {
		byUser[row.User] = row
	}

	if rows[0].User != "e" || rows[0].Score != 14200 || rows[0].Sends != 12 {
		t.Errorf("only the best 10 of 12 sends count: %+v", rows[0])
	}
	if b := byUser["b"]; b.Score != 1850+leaderboardFlashBonus || b.Flashes != 1 || b.Rank != 3 {
		t.Errorf("flash bonus: %+v", b)
	}
	if a, d := byUser["a"], byUser["d"]; a.Rank != d.Rank || a.Rank != 4 {
		t.Errorf("equal scores share a rank: a=%d d=%d", a.Rank, d.Rank)
	}
	if c := byUser["c"]; c.Rank != 2 || c.Score != 3140 || c.Hardest != "6A" {
		t.Errorf("c = %+v", c)
	}
}

func TestSummarizeSends(t *testing.T) {
	sends := []leaderboardSend{
		{User: "a", Route: "r1", Grade: "7A", GradeIndex: 18.5, Flash: true},
		{User: "b", Route: "r1", Grade: "7A", GradeIndex: 18.5},
		{User: "b", Route: "r2", Grade: "6A", GradeIndex: 15.7},
		{User: "c", Route: "r3", Grade: "6A", GradeIndex: 15.7, Flash: true},
	}
	board := summarizeSends(sends)
	if board.stats != (leaderboardStats{Climbers: 3, Sends: 4, Flashes: 2, Hardest: "7A"}) {
		t.Errorf("stats = %+v", board.stats)
	}
	if len(board.grades) != 2 || board.grades[0] != (leaderboardGrade{Grade: "6A", Sends: 2, Flashes: 1}) || board.grades[1].Grade != "7A" {
		t.Errorf("grades go from easy to hard: %+v", board.grades)
	}
	if top := board.topRoutes; top[0].ID != "r1" || top[0].Sends != 2 || top[0].Flashes != 1 || top[1].ID != "r3" {
		t.Errorf("most sent first, flashes break ties: %+v", top)
	}
	if mine := board.sends["b"]; len(mine) != 2 || mine[0].Route != "r1" {
		t.Errorf("best sends first: %+v", mine)
	}
	rows := rankLeaderboard(sends)
	if gap := pointsToNextRank(rows, 0); gap != nil {
		t.Errorf("the leader has nobody ahead: %d", *gap)
	}
	if gap := pointsToNextRank(rows, 2); gap == nil || *gap != rows[1].Score-rows[2].Score {
		t.Errorf("gap to the next rank = %v", gap)
	}
}

func TestShortName(t *testing.T) {
	users := core.NewAuthCollection("users")
	user := core.NewRecord(users)
	user.Set("firstname", "Ännie")
	user.Set("name", "Örtel")
	if got := shortName(user); got != "Ännie Ö." {
		t.Errorf("shortName = %q", got)
	}
	user.Set("name", "")
	if got := shortName(user); got != "Ännie" {
		t.Errorf("shortName without last name = %q", got)
	}
	user.Set("firstname", "")
	user.Set("name", "Mia von Fischer")
	if got := shortName(user); got != "Mia F." {
		t.Errorf("shortName of a full name in the last name field = %q", got)
	}
}

func logTick(t *testing.T, app core.App, user, route *core.Record, kind string, date time.Time) {
	t.Helper()
	saveRecord(t, app, "ticks", map[string]any{"user": user.Id, "route": route.Id, "type": kind, "attempts": 1, "date": date})
}

func TestLeaderboardEndpoint(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id})
	hallB := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymB.Id})
	boulder := func(location *core.Record, grade string, index float64) *core.Record {
		return saveRecord(t, f.app, "routes", map[string]any{
			"name": grade, "grade": grade, "grade_system": "font", "grade_index": index,
			"type": "Boulder", "creator": []string{"S"}, "location": location.Id,
		})
	}
	hard, easy, foreign := boulder(hall, "7A", 18.5), boulder(hall, "6A", 15.7), boulder(hallB, "8A", 23)
	rope := saveRecord(t, f.app, "routes", map[string]any{
		"name": "Rope", "grade": "7a", "grade_system": "french", "grade_index": 17,
		"type": "Route", "creator": []string{"S"}, "location": hall.Id,
	})
	now := time.Now()
	f.climber.Set("firstname", "Cleo")
	f.climber.Set("name", "Climber")
	if err := f.app.Save(f.climber); err != nil {
		t.Fatal(err)
	}

	logTick(t, f.app, f.climber, hard, "flash", now)
	logTick(t, f.app, f.climber, easy, "top", now.AddDate(0, 0, -3))
	logTick(t, f.app, f.climber, easy, "top", now.AddDate(0, 0, -2))
	logTick(t, f.app, f.climber, foreign, "top", now)
	logTick(t, f.app, f.climber, rope, "top", now)
	logTick(t, f.app, f.setterA, hard, "attempt", now)
	logTick(t, f.app, f.setterA, easy, "top", now.AddDate(0, 0, -90))
	logTick(t, f.app, f.adminA, hard, "top", now)
	f.adminA.Set("leaderboard_hidden", true)
	if err := f.app.Save(f.adminA); err != nil {
		t.Fatal(err)
	}

	url := "/api/gyms/" + f.gymA.Id + "/leaderboard"
	call(t, f.app, nil, http.MethodGet, url, "", http.StatusOK, `"total":1`, `"name":"Cleo C."`, `"score":3453`, `"sends":2`, `"me":null`)
	call(t, f.app, f.climber, http.MethodGet, url, "", http.StatusOK, `"me":{"rank":1`, `"ahead":null`, `"mySends":[{"id":"`+hard.Id+`","name":"7A"`, `"stats":{"climbers":1,"sends":2,"flashes":1,"hardest":"7A"}`, `"topRoutes":[{"id":"`+hard.Id+`","name":"7A"`, `"grade_system":"font"`)
	call(t, f.app, nil, http.MethodGet, url+"?kind=route", "", http.StatusOK, `"score":1700`, `"hardest":"7a"`)

	season := saveRecord(t, f.app, "seasons", map[string]any{
		"gym": f.gymA.Id, "name": "Spring", "starts_at": now.AddDate(0, 0, -100), "ends_at": now.AddDate(0, 0, -80),
	})
	call(t, f.app, nil, http.MethodGet, url+"?season="+season.Id, "", http.StatusOK, `"total":1`, `"score":1570`)
	seasonB := saveRecord(t, f.app, "seasons", map[string]any{
		"gym": f.gymB.Id, "name": "Spring", "starts_at": now.AddDate(0, 0, -10), "ends_at": now,
	})
	call(t, f.app, nil, http.MethodGet, url+"?season="+seasonB.Id, "", http.StatusNotFound)
	call(t, f.app, nil, http.MethodGet, "/api/gyms/missing/leaderboard", "", http.StatusNotFound)
}

func TestSeasonsAreManagedPerGym(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	body := func(gym, starts, ends string) string {
		return `{"gym":"` + gym + `","name":"Winter","starts_at":"` + starts + ` 00:00:00.000Z","ends_at":"` + ends + ` 00:00:00.000Z"}`
	}
	seasons := "/api/collections/seasons/records"
	call(t, f.app, f.climber, http.MethodPost, seasons, body(f.gymA.Id, "2026-01-01", "2026-03-31"), http.StatusBadRequest)
	call(t, f.app, f.setterB, http.MethodPost, seasons, body(f.gymA.Id, "2026-01-01", "2026-03-31"), http.StatusBadRequest)
	call(t, f.app, f.setterA, http.MethodPost, seasons, body(f.gymA.Id, "2026-03-31", "2026-01-01"), http.StatusBadRequest, "end after")
	call(t, f.app, f.setterA, http.MethodPost, seasons, body(f.gymA.Id, "2026-01-01", "2026-03-31"), http.StatusOK)
	call(t, f.app, nil, http.MethodGet, seasons, "", http.StatusOK, `"totalItems":1`)
}

func TestLeaderboardKeepsTheGradeOfTheBestRepeat(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id})
	route := saveRecord(t, f.app, "routes", map[string]any{"name": "R", "grade": "7A", "grade_system": "font", "grade_index": 18.5, "type": "Boulder", "creator": []string{"S"}, "location": hall.Id})
	now := time.Now()
	logTick(t, f.app, f.climber, route, "top", now.AddDate(0, 0, -1))
	route, err := f.app.FindRecordById("routes", route.Id)
	if err != nil {
		t.Fatal(err)
	}
	route.Set("grade", "6A")
	route.Set("grade_index", 15.7)
	if err := f.app.Save(route); err != nil {
		t.Fatal(err)
	}
	logTick(t, f.app, f.climber, route, "flash", now)

	from, to := rollingLeaderboardWindow(now)
	board, err := buildLeaderboard(f.app, f.gymA.Id, "boulder", from, to)
	if err != nil {
		t.Fatal(err)
	}
	if sends := board.sends[f.climber.Id]; len(sends) != 1 || sends[0].Grade != "7A" || sends[0].GradeIndex != 18.5 || !sends[0].Flash {
		t.Fatalf("regraded repeat = %+v", sends)
	}
}

func TestTickChangesForgetBoardsCoveringTheirDay(t *testing.T) {
	september := func(day int) time.Time { return time.Date(2026, 9, day, 0, 0, 0, 0, time.UTC) }
	storeLeaderboardBoard("finished", "a", leaderboardBoard{}, september(1), september(10), time.Now())
	storeLeaderboardBoard("later", "a", leaderboardBoard{}, september(11), september(20), time.Now())
	storeLeaderboardBoard("other gym", "b", leaderboardBoard{}, september(1), september(10), time.Now())
	forgetLeaderboardsCovering("a", september(10), time.Time{})
	finished, later, otherGym := cachedPastStalenessLimit("finished"), cachedPastStalenessLimit("later"), cachedPastStalenessLimit("other gym")
	leaderboardCache.Lock()
	delete(leaderboardCache.entries, "finished")
	delete(leaderboardCache.entries, "later")
	delete(leaderboardCache.entries, "other gym")
	leaderboardCache.Unlock()
	if finished || !later || !otherGym {
		t.Fatalf("finished kept = %v, later kept = %v, other gym kept = %v; want false, true, true", finished, later, otherGym)
	}
}

func TestTicksExpireOldBoardsAtOnce(t *testing.T) {
	day := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	storeLeaderboardBoard("old", "a", leaderboardBoard{}, day, day.AddDate(0, 0, 60), time.Now())
	leaderboardCache.Lock()
	old := leaderboardCache.entries["old"]
	old.built = time.Now().Add(-tickStalenessLimit)
	leaderboardCache.entries["old"] = old
	leaderboardCache.Unlock()
	forgetLeaderboardsCovering("a", day)
	leaderboardCache.Lock()
	expired := time.Now().After(leaderboardCache.entries["old"].expires)
	delete(leaderboardCache.entries, "old")
	leaderboardCache.Unlock()
	if !expired {
		t.Fatal("a board older than the staleness limit survived a tick")
	}
}

func cachedPastStalenessLimit(key string) bool {
	leaderboardCache.Lock()
	defer leaderboardCache.Unlock()
	cached, ok := leaderboardCache.entries[key]
	return ok && cached.expires.After(time.Now().Add(tickStalenessLimit))
}

func TestConcurrentLeaderboardMissesShareOneBoard(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id})
	route := saveRecord(t, f.app, "routes", map[string]any{
		"name": "7A", "grade": "7A", "grade_system": "font", "grade_index": 18.5,
		"type": "Boulder", "creator": []string{"S"}, "location": hall.Id,
	})
	logTick(t, f.app, f.climber, route, "flash", time.Now())
	from, to := rollingLeaderboardWindow(time.Now())
	boards := make([]leaderboardBoard, 8)
	var wg sync.WaitGroup
	for i := range boards {
		wg.Go(func() {
			board, err := cachedLeaderboardBoard(f.app, f.gymA.Id, "boulder", "", from, to)
			if err != nil {
				t.Error(err)
			}
			boards[i] = board
		})
	}
	wg.Wait()
	for _, board := range boards {
		if len(board.rows) != 1 || board.rows[0].User != f.climber.Id {
			t.Fatalf("board rows = %+v, want the one climber", board.rows)
		}
	}
}

func TestMovingATickForgetsBothGymsBoards(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	boulder := func(gym *core.Record) *core.Record {
		hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": gym.Id})
		return saveRecord(t, f.app, "routes", map[string]any{
			"name": "7A", "grade": "7A", "grade_system": "font", "grade_index": 18.5, "type": "Boulder", "creator": []string{"S"}, "location": hall.Id,
		})
	}
	routeA, routeB := boulder(f.gymA), boulder(f.gymB)
	now := time.Now()
	tick := saveRecord(t, f.app, "ticks", map[string]any{"user": f.climber.Id, "route": routeA.Id, "type": "top", "attempts": 1, "date": now})
	storeLeaderboardBoard("a", f.gymA.Id, leaderboardBoard{}, now.AddDate(0, 0, -1), now.AddDate(0, 0, 1), time.Now())
	storeLeaderboardBoard("b", f.gymB.Id, leaderboardBoard{}, now.AddDate(0, 0, -1), now.AddDate(0, 0, 1), time.Now())

	tick.Set("route", routeB.Id)
	if err := f.app.Save(tick); err != nil {
		t.Fatal(err)
	}

	keptA, keptB := cachedPastStalenessLimit("a"), cachedPastStalenessLimit("b")
	if keptA || keptB {
		t.Fatalf("after the move: gym A board kept = %v, gym B board kept = %v; want both capped", keptA, keptB)
	}
}

func TestBoardsBuiltDuringATickAreCapped(t *testing.T) {
	day := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	started := time.Now()
	forgetLeaderboardsCovering("a", day.AddDate(0, 0, 1))
	storeLeaderboardBoard("racing", "a", leaderboardBoard{}, day, day.AddDate(0, 0, 60), started)
	storeLeaderboardBoard("other gym", "b", leaderboardBoard{}, day, day.AddDate(0, 0, 60), started)
	storeLeaderboardBoard("other days", "a", leaderboardBoard{}, day.AddDate(0, 0, 10), day.AddDate(0, 0, 60), started)
	racing, otherGym, otherDays := cachedPastStalenessLimit("racing"), cachedPastStalenessLimit("other gym"), cachedPastStalenessLimit("other days")
	leaderboardCache.Lock()
	for _, key := range []string{"racing", "other gym", "other days"} {
		delete(leaderboardCache.entries, key)
	}
	leaderboardCache.Unlock()
	if racing || !otherGym || !otherDays {
		t.Fatalf("racing kept = %v, other gym kept = %v, other days kept = %v; want false, true, true", racing, otherGym, otherDays)
	}
}

func TestLeavingTheLeaderboardForgetsCachedBoards(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	storeLeaderboardBoard("cached", f.gymA.Id, leaderboardBoard{}, time.Now().AddDate(0, 0, -10), time.Now().AddDate(0, 0, -1), time.Now())
	f.climber.Set("followed_walls", []string{})
	if err := f.app.Save(f.climber); err != nil {
		t.Fatal(err)
	}
	if !cachedPastStalenessLimit("cached") {
		t.Fatal("an unrelated profile change forgot the boards")
	}
	f.climber.Set("leaderboard_hidden", true)
	if err := f.app.Save(f.climber); err != nil {
		t.Fatal(err)
	}
	if cachedPastStalenessLimit("cached") {
		t.Fatal("hiding from the leaderboard kept the cached boards")
	}
	storeLeaderboardBoard("in-flight", f.gymA.Id, leaderboardBoard{}, time.Now().AddDate(0, 0, -10), time.Now().AddDate(0, 0, -1), time.Now().Add(-time.Minute))
	if cachedPastStalenessLimit("in-flight") {
		t.Fatal("a board built before the change was cached as fresh")
	}
}
