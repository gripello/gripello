package ticks

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/events"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/testapp"
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

func TestLeaderboardEndpoint(t *testing.T) {
	f := newFixture(t)
	hard, easy, foreign := f.boulder(f.hallA, "7A", 18.5), f.boulder(f.hallA, "6A", 15.7), f.boulder(f.hallB, "8A", 23)
	rope := f.exec(`INSERT INTO routes (id, gym, name, grade, grade_system, grade_index, type, location)
		VALUES ($1, $2, 'Rope', '7a', 'french', 17, 'Route', $3) RETURNING id`, ids.New(), f.gymA, f.hallA)
	now := time.Now()
	f.exec(`UPDATE users SET firstname = 'Cleo', name = 'Climber' WHERE id = $1 RETURNING id`, f.users["climber"])

	f.tick("climber", hard, "flash", now)
	f.tick("climber", easy, "top", now.AddDate(0, 0, -3))
	f.tick("climber", easy, "top", now.AddDate(0, 0, -2))
	f.tick("climber", foreign, "top", now)
	f.tick("climber", rope, "top", now)
	f.tick("setterA", hard, "attempt", now)
	f.tick("setterA", easy, "top", now.AddDate(0, 0, -90))
	f.tick("adminA", hard, "top", now)
	f.exec(`UPDATE users SET leaderboard_hidden = true WHERE id = $1 RETURNING id`, f.users["adminA"])

	url := "/gyms/" + f.gymA + "/leaderboard"
	f.call("", "GET", url, "", http.StatusOK, `"total":1`, `"name":"Cleo C."`, `"score":3453`, `"sends":2`, `"me":null`)
	f.call("climber", "GET", url, "", http.StatusOK, `"me":{"rank":1`, `"ahead":null`, `"mySends":[{"id":"`+hard+`","name":"7A"`,
		`"stats":{"climbers":1,"sends":2,"flashes":1,"hardest":"7A"}`, `"topRoutes":[{"id":"`+hard+`","name":"7A"`, `"grade_system":"font"`)
	f.call("", "GET", "/gyms/alpha/leaderboard?kind=route", "", http.StatusOK, `"score":1700`, `"hardest":"7a"`)

	season := f.exec(`INSERT INTO seasons (id, gym, name, starts_at, ends_at) VALUES ($1, $2, 'Spring', $3, $4) RETURNING id`,
		ids.New(), f.gymA, now.AddDate(0, 0, -100), now.AddDate(0, 0, -80))
	f.call("", "GET", url+"?season="+season, "", http.StatusOK, `"total":1`, `"score":1570`)
	seasonB := f.exec(`INSERT INTO seasons (id, gym, name, starts_at, ends_at) VALUES ($1, $2, 'Spring', $3, $4) RETURNING id`,
		ids.New(), f.gymB, now.AddDate(0, 0, -10), now)
	f.call("", "GET", url+"?season="+seasonB, "", http.StatusNotFound)
	f.call("", "GET", "/gyms/missing/leaderboard", "", http.StatusNotFound)
}

func TestPrivateTicksStayOffTheLeaderboard(t *testing.T) {
	f := newFixture(t)
	route := f.boulder(f.hallA, "7A", 18.5)
	f.tick("climber", route, "top", time.Now())
	f.tick("setterA", route, "top", time.Now())
	f.exec(`UPDATE users SET ticks_private = true WHERE id = $1 RETURNING id`, f.users["setterA"])
	f.call("", "GET", "/gyms/"+f.gymA+"/leaderboard", "", http.StatusOK, `"total":1`)
	if !touchesLeaderboard([]string{"ticks_private"}) {
		t.Error("switching ticks_private keeps stale boards")
	}
}

func TestSeasonsAreManagedPerGym(t *testing.T) {
	f := newFixture(t)
	body := func(starts, ends string) string {
		return `{"name":"Winter","starts_at":"` + starts + ` 00:00:00.000Z","ends_at":"` + ends + ` 00:00:00.000Z"}`
	}
	seasons := "/gyms/" + f.gymA + "/seasons"
	f.call("", "POST", seasons, body("2026-01-01", "2026-03-31"), http.StatusUnauthorized)
	f.call("climber", "POST", seasons, body("2026-01-01", "2026-03-31"), http.StatusForbidden)
	f.call("setterB", "POST", seasons, body("2026-01-01", "2026-03-31"), http.StatusForbidden)
	f.call("adminA", "POST", seasons, body("2026-01-01", "2026-03-31"), http.StatusForbidden)
	f.call("setterA", "POST", seasons, body("2026-03-31", "2026-01-01"), http.StatusBadRequest, "end after")
	f.call("setterA", "POST", seasons, `{"gym":"`+f.gymB+`","name":"Winter","starts_at":"2026-01-01","ends_at":"2026-03-31"}`, http.StatusBadRequest)
	f.call("setterA", "POST", seasons, `{"starts_at":"2026-01-01","ends_at":"2026-03-31"}`, http.StatusBadRequest, `"name"`)
	var season Season
	json.Unmarshal([]byte(f.call("setterA", "POST", seasons, body("2026-01-01", "2026-03-31"), http.StatusCreated, `"name":"Winter"`)), &season)
	id := season.ID
	f.call("", "GET", seasons, "", http.StatusOK, `"id":"`+id+`"`)
	f.call("", "GET", "/gyms/beta/seasons", "", http.StatusOK, `[]`)
	f.call("setterB", "PATCH", "/seasons/"+id, `{"name":"Mine"}`, http.StatusForbidden)
	f.call("setterA", "PATCH", "/seasons/"+id, `{"ends_at":"2025-12-01"}`, http.StatusBadRequest, "end after")
	f.call("setterA", "PATCH", "/seasons/"+id, `{"gym":"`+f.gymB+`"}`, http.StatusBadRequest)
	f.call("setterA", "PATCH", "/seasons/"+id, `{"name":"Spring"}`, http.StatusOK, `"name":"Spring"`)
	f.call("setterB", "DELETE", "/seasons/"+id, "", http.StatusForbidden)
	f.call("setterA", "DELETE", "/seasons/"+id, "", http.StatusNoContent)
	f.call("setterA", "DELETE", "/seasons/"+id, "", http.StatusNotFound)
}

func TestLeaderboardKeepsTheGradeOfTheBestRepeat(t *testing.T) {
	f := newFixture(t)
	route := f.boulder(f.hallA, "7A", 18.5)
	now := time.Now()
	f.tick("climber", route, "top", now.AddDate(0, 0, -1))
	f.exec(`UPDATE routes SET grade = '6A', grade_index = 15.7 WHERE id = $1 RETURNING id`, route)
	f.tick("climber", route, "flash", now)

	from, to := rollingLeaderboardWindow(now)
	board, err := f.module.buildLeaderboard(context.Background(), f.gymA, "boulder", from, to)
	if err != nil {
		t.Fatal(err)
	}
	if sends := board.sends[f.users["climber"]]; len(sends) != 1 || sends[0].Grade != "7A" || sends[0].GradeIndex != 18.5 || !sends[0].Flash {
		t.Fatalf("regraded repeat = %+v", sends)
	}
}

func cappedOrMissing(c *boardCache, key string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	cached, ok := c.entries[key]
	return !ok || !cached.expires.After(time.Now().Add(tickStalenessLimit))
}

func TestTickChangesForgetBoardsCoveringTheirDay(t *testing.T) {
	c := newBoardCache()
	september := func(day int) time.Time { return time.Date(2026, 9, day, 0, 0, 0, 0, time.UTC) }
	c.store("finished", "a", leaderboardBoard{}, september(1), september(10), time.Now())
	c.store("later", "a", leaderboardBoard{}, september(11), september(20), time.Now())
	c.store("other gym", "b", leaderboardBoard{}, september(1), september(10), time.Now())
	c.forgetCovering("a", september(10), time.Time{})
	if !cappedOrMissing(c, "finished") || cappedOrMissing(c, "later") || cappedOrMissing(c, "other gym") {
		t.Fatal("want only the board covering the tick's day of its gym capped")
	}
}

func TestTicksOfDeletedRoutesCapEveryGym(t *testing.T) {
	c := newBoardCache()
	day := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	c.store("a", "a", leaderboardBoard{}, day, day.AddDate(0, 0, 10), time.Now())
	c.store("b", "b", leaderboardBoard{}, day, day.AddDate(0, 0, 10), time.Now())
	c.forgetCovering("", day)
	if !cappedOrMissing(c, "a") || !cappedOrMissing(c, "b") {
		t.Fatal("a tick without a gym caps all boards covering its day")
	}
}

func TestTicksExpireOldBoardsAtOnce(t *testing.T) {
	c := newBoardCache()
	day := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	c.store("old", "a", leaderboardBoard{}, day, day.AddDate(0, 0, 60), time.Now())
	c.mu.Lock()
	old := c.entries["old"]
	old.built = time.Now().Add(-tickStalenessLimit)
	c.entries["old"] = old
	c.mu.Unlock()
	c.forgetCovering("a", day)
	c.mu.Lock()
	expired := time.Now().After(c.entries["old"].expires)
	c.mu.Unlock()
	if !expired {
		t.Fatal("a board older than the staleness limit survived a tick")
	}
}

func TestBoardsBuiltDuringATickAreCapped(t *testing.T) {
	c := newBoardCache()
	day := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	started := time.Now()
	c.forgetCovering("a", day.AddDate(0, 0, 1))
	c.store("racing", "a", leaderboardBoard{}, day, day.AddDate(0, 0, 60), started)
	c.store("other gym", "b", leaderboardBoard{}, day, day.AddDate(0, 0, 60), started)
	c.store("other days", "a", leaderboardBoard{}, day.AddDate(0, 0, 10), day.AddDate(0, 0, 60), started)
	if !cappedOrMissing(c, "racing") || cappedOrMissing(c, "other gym") || cappedOrMissing(c, "other days") {
		t.Fatal("want only the racing board capped")
	}
}

func TestConcurrentLeaderboardMissesShareOneBoard(t *testing.T) {
	f := newFixture(t)
	route := f.boulder(f.hallA, "7A", 18.5)
	f.tick("climber", route, "flash", time.Now())
	from, to := rollingLeaderboardWindow(time.Now())
	boards := make([]leaderboardBoard, 8)
	var wg sync.WaitGroup
	for i := range boards {
		wg.Go(func() {
			board, err := f.module.cachedBoard(context.Background(), f.gymA, "boulder", "", from, to)
			if err != nil {
				t.Error(err)
			}
			boards[i] = board
		})
	}
	wg.Wait()
	for _, board := range boards {
		if len(board.rows) != 1 || board.rows[0].User != f.users["climber"] {
			t.Fatalf("board rows = %+v, want the one climber", board.rows)
		}
	}
}

func TestRedatingATickCapsBoardsOfBothDays(t *testing.T) {
	f := newFixture(t)
	route := f.boulder(f.hallA, "7A", 18.5)
	now := time.Now()
	f.module.boards.store("probe", f.gymA, leaderboardBoard{}, now.AddDate(0, 0, -1), now.AddDate(0, 0, 1), time.Now())
	tick := f.tick("climber", route, "top", now)
	testapp.WaitFor(t, func() bool { return cappedOrMissing(f.module.boards, "probe") })
	time.Sleep(10 * time.Millisecond)
	past := now.AddDate(0, 0, -30)
	f.module.boards.store("now", f.gymA, leaderboardBoard{}, now.AddDate(0, 0, -1), now.AddDate(0, 0, 1), time.Now())
	f.module.boards.store("past", f.gymA, leaderboardBoard{}, past.AddDate(0, 0, -1), past.AddDate(0, 0, 1), time.Now())
	f.module.boards.store("other gym", f.gymB, leaderboardBoard{}, now.AddDate(0, 0, -1), now.AddDate(0, 0, 1), time.Now())

	f.call("climber", "PATCH", "/ticks/"+tick.ID, `{"date":"`+past.UTC().Format(time.RFC3339)+`"}`, http.StatusOK)

	testapp.WaitFor(t, func() bool {
		return cappedOrMissing(f.module.boards, "now") && cappedOrMissing(f.module.boards, "past")
	})
	if cappedOrMissing(f.module.boards, "other gym") {
		t.Fatal("another gym's board was capped")
	}
}

func publishUserUpdate(t *testing.T, f *fixture, user string, changed []string) {
	t.Helper()
	err := pgx.BeginFunc(context.Background(), f.app.DB, func(tx pgx.Tx) error {
		return events.Publish(context.Background(), tx, "user:"+user, "user.updated",
			map[string]any{"record": map[string]string{"id": user}, "changed": changed}, events.Audience{Users: []string{user}})
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestLeavingTheLeaderboardForgetsCachedBoards(t *testing.T) {
	f := newFixture(t)
	boards := f.module.boards
	boards.store("cached", f.gymA, leaderboardBoard{}, time.Now().AddDate(0, 0, -10), time.Now().AddDate(0, 0, -1), time.Now())
	publishUserUpdate(t, f, f.users["climber"], []string{"followed_walls"})
	probe := "probe"
	boards.store(probe, f.gymB, leaderboardBoard{}, time.Now().AddDate(0, 0, -1), time.Now().AddDate(0, 0, 1), time.Now())
	f.tick("climber", f.boulder(f.hallB, "6A", 15.7), "top", time.Now())
	testapp.WaitFor(t, func() bool { return cappedOrMissing(boards, probe) })
	if cappedOrMissing(boards, "cached") {
		t.Fatal("an unrelated profile change forgot the boards")
	}
	publishUserUpdate(t, f, f.users["climber"], []string{"leaderboard_hidden"})
	testapp.WaitFor(t, func() bool { return cappedOrMissing(boards, "cached") })
	boards.store("in-flight", f.gymA, leaderboardBoard{}, time.Now().AddDate(0, 0, -10), time.Now().AddDate(0, 0, -1), time.Now().Add(-time.Minute))
	if !cappedOrMissing(boards, "in-flight") {
		t.Fatal("a board built before the change was cached as fresh")
	}
}

func TestProfileChangesWithoutAFieldListForgetBoards(t *testing.T) {
	if !touchesLeaderboard(nil) || touchesLeaderboard([]string{"followed_walls"}) || !touchesLeaderboard([]string{"avatar"}) {
		t.Fatal("touchesLeaderboard")
	}
}
