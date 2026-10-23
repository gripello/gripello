package ticks

import (
	"context"
	"encoding/json"
	"math/rand/v2"
	"net/http"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/events"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/jobs"
	"gripello/internal/platform/testapp"
)

func TestRankLeaderboard(t *testing.T) {
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
		`"stats":{"climbers":1,"sends":2,"flashes":1,"hardest":"7A"}`, `"topRoutes":[{"id":"`+hard+`","name":"7A"`, `"grade_system":"font","type":"Boulder"`)
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
	t.Parallel()
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
	t.Parallel()
	f := newFixture(t)
	body := func(starts, ends string) string {
		return `{"name":"Winter","starts_at":"` + starts + `","ends_at":"` + ends + `"}`
	}
	seasons := "/gyms/" + f.gymA + "/seasons"
	f.call("", "POST", seasons, body("2026-01-01", "2026-03-31"), http.StatusUnauthorized)
	f.call("climber", "POST", seasons, body("2026-01-01", "2026-03-31"), http.StatusForbidden)
	f.call("setterB", "POST", seasons, body("2026-01-01", "2026-03-31"), http.StatusForbidden)
	f.call("adminA", "POST", seasons, body("2026-01-01", "2026-03-31"), http.StatusForbidden)
	f.call("setterA", "POST", seasons, body("2026-03-31", "2026-01-01"), http.StatusBadRequest, "end before")
	f.call("setterA", "POST", seasons, body("2026-01-01 00:00:00.000Z", "2026-03-31"), http.StatusBadRequest, `"starts_at":{"code":"validation_invalid_value"`)
	f.call("setterA", "POST", seasons, `{"gym":"`+f.gymB+`","name":"Winter","starts_at":"2026-01-01","ends_at":"2026-03-31"}`, http.StatusBadRequest)
	f.call("setterA", "POST", seasons, `{"starts_at":"2026-01-01","ends_at":"2026-03-31"}`, http.StatusBadRequest, `"name"`)
	var season Season
	json.Unmarshal([]byte(f.call("setterA", "POST", seasons, body("2026-01-01", "2026-03-31"), http.StatusCreated, `"name":"Winter"`, `"starts_at":"2026-01-01"`, `"ends_at":"2026-03-31"`)), &season)
	id := season.ID
	f.call("", "GET", seasons, "", http.StatusOK, `"id":"`+id+`"`)
	f.call("", "GET", "/gyms/beta/seasons", "", http.StatusOK, `[]`)
	f.call("setterB", "PATCH", "/seasons/"+id, `{"name":"Mine"}`, http.StatusForbidden)
	f.call("setterA", "PATCH", "/seasons/"+id, `{"ends_at":"2025-12-01"}`, http.StatusBadRequest, "end before")
	f.call("setterA", "PATCH", "/seasons/"+id, `{"gym":"`+f.gymB+`"}`, http.StatusBadRequest)
	f.call("setterA", "PATCH", "/seasons/"+id, `{"name":"Spring"}`, http.StatusOK, `"name":"Spring"`)
	f.call("setterB", "DELETE", "/seasons/"+id, "", http.StatusForbidden)
	f.call("setterA", "DELETE", "/seasons/"+id, "", http.StatusNoContent)
	f.call("setterA", "DELETE", "/seasons/"+id, "", http.StatusNotFound)

	kinds := []string{}
	for _, e := range f.outbox("gym_changes:" + f.gymA) {
		var change struct{ Collection, Action string }
		json.Unmarshal(e.Payload, &change)
		if change.Collection == "seasons" && e.Audience.Public {
			kinds = append(kinds, e.Kind+"/"+change.Action)
		}
	}
	if want := []string{"season.created/create", "season.updated/update", "season.deleted/delete"}; !slices.Equal(kinds, want) {
		t.Fatalf("season events = %v, want %v", kinds, want)
	}
	f.call("setterB", "POST", "/gyms/"+f.gymB+"/seasons", body("2026-02-14", "2026-02-14"), http.StatusCreated, `"ends_at":"2026-02-14"`)
}

func TestLeaderboardKeepsTheGradeOfTheBestRepeat(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	route := f.boulder(f.hallA, "7A", 18.5)
	now := time.Now()
	f.tick("climber", route, "top", now.AddDate(0, 0, -1))
	f.exec(`UPDATE routes SET grade = '6A', grade_index = 15.7 WHERE id = $1 RETURNING id`, route)
	f.tick("climber", route, "flash", now)

	for name, board := range map[string]leaderboardBoard{"fresh": f.freshBoard("boulder"), "live": f.liveBoard("boulder")} {
		if sends := board.sends[f.users["climber"]]; len(sends) != 1 || sends[0].Grade != "7A" || sends[0].GradeIndex != 18.5 || !sends[0].Flash {
			t.Fatalf("%s regraded repeat = %+v", name, sends)
		}
	}
}

func (f *fixture) freshBoard(kind string) leaderboardBoard {
	f.t.Helper()
	from, to := rollingLeaderboardWindow(time.Now())
	sends, err := f.module.loadPairs(context.Background(), f.gymA, kind, from, to)
	if err != nil {
		f.t.Fatal(err)
	}
	board, err := f.module.boardFromSends(context.Background(), sends, nil)
	if err != nil {
		f.t.Fatal(err)
	}
	return board
}

func (f *fixture) liveBoard(kind string) leaderboardBoard {
	f.t.Helper()
	from, to := rollingLeaderboardWindow(time.Now())
	board, err := f.module.cachedBoard(context.Background(), f.gymA, kind, "", from, to)
	if err != nil {
		f.t.Fatal(err)
	}
	return board
}

func (f *fixture) live(kind string) *liveBoard {
	from, to := rollingLeaderboardWindow(time.Now())
	f.module.boards.mu.Lock()
	defer f.module.boards.mu.Unlock()
	return f.module.boards.boards[leaderboardKey(f.gymA, kind, "", from, to)]
}

func (f *fixture) loadedAt(kind string) time.Time {
	b := f.live(kind)
	f.module.boards.mu.Lock()
	defer f.module.boards.mu.Unlock()
	return b.loadedAt
}

func rowOf(board leaderboardBoard, user string) *leaderboardRow {
	if index := slices.IndexFunc(board.rows, func(row leaderboardRow) bool { return row.User == user }); index >= 0 {
		return &board.rows[index]
	}
	return nil
}

func (f *fixture) waitForRow(kind, user string, matches func(*leaderboardRow) bool) {
	f.t.Helper()
	testapp.WaitFor(f.t, func() bool { return matches(rowOf(f.liveBoard(kind), f.users[user])) })
}

func TestASendShowsWithoutReloadingTheBoard(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	route := f.boulder(f.hallA, "7A", 18.5)
	f.tick("setterA", route, "top", time.Now())
	f.liveBoard("boulder")
	loaded := f.loadedAt("boulder")

	f.tick("climber", route, "flash", time.Now())
	f.waitForRow("boulder", "climber", func(row *leaderboardRow) bool { return row != nil && row.Score == 1850+leaderboardFlashBonus })
	if !f.loadedAt("boulder").Equal(loaded) {
		t.Fatal("the send reloaded the whole board")
	}
}

func TestUpdatingOrDeletingATickRefreshesItsPair(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	route := f.boulder(f.hallA, "7A", 18.5)
	hard := f.tick("climber", route, "top", time.Now().AddDate(0, 0, -1))
	f.exec(`UPDATE routes SET grade = '6A', grade_index = 15.7 WHERE id = $1 RETURNING id`, route)
	easy := f.tick("climber", route, "top", time.Now())
	f.liveBoard("boulder")

	f.call("climber", "PATCH", "/ticks/"+easy.ID, `{"type":"flash"}`, http.StatusOK)
	f.waitForRow("boulder", "climber", func(row *leaderboardRow) bool { return row != nil && row.Score == 1850+leaderboardFlashBonus })
	f.call("climber", "DELETE", "/ticks/"+hard.ID, "", http.StatusNoContent)
	f.waitForRow("boulder", "climber", func(row *leaderboardRow) bool {
		return row != nil && row.Score == 1570+leaderboardFlashBonus && row.Hardest == "6A"
	})
	f.call("climber", "PATCH", "/ticks/"+easy.ID, `{"date":"`+time.Now().AddDate(0, 0, -90).UTC().Format(time.DateOnly)+`"}`, http.StatusOK)
	f.waitForRow("boulder", "climber", func(row *leaderboardRow) bool { return row == nil })
}

func TestChangesDuringALoadAreReplayed(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	route := f.boulder(f.hallA, "7A", 18.5)
	f.liveBoard("boulder")
	b := f.live("boulder")
	boards := f.module.boards
	boards.mu.Lock()
	b.loading = true
	boards.mu.Unlock()

	f.tick("climber", route, "top", time.Now())
	testapp.WaitFor(t, func() bool {
		boards.mu.Lock()
		defer boards.mu.Unlock()
		return len(b.pending) == 1
	})
	failing, cancel := context.WithCancel(context.Background())
	cancel()
	if err := f.module.loadBoard(failing, b); err == nil {
		t.Fatal("want the cancelled load to fail")
	}
	f.waitForRow("boulder", "climber", func(row *leaderboardRow) bool { return row != nil && row.Score == 1850 })
}

func TestOptOutsAndDeletedClimbersLeaveLiveBoards(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	route := f.boulder(f.hallA, "7A", 18.5)
	f.tick("climber", route, "top", time.Now())
	f.liveBoard("boulder")
	climber := f.users["climber"]
	present := func(row *leaderboardRow) bool { return row != nil }
	absent := func(row *leaderboardRow) bool { return row == nil }

	for _, field := range []string{"leaderboard_hidden", "ticks_private"} {
		f.exec(`UPDATE users SET `+field+` = true WHERE id = $1 RETURNING id`, climber)
		publishUserUpdate(t, f, climber, []string{field})
		f.waitForRow("boulder", "climber", absent)
		f.exec(`UPDATE users SET `+field+` = false WHERE id = $1 RETURNING id`, climber)
		publishUserUpdate(t, f, climber, []string{field})
		f.waitForRow("boulder", "climber", present)
	}
	f.exec(`UPDATE users SET firstname = 'Cleo', name = 'Climber' WHERE id = $1 RETURNING id`, climber)
	publishUserUpdate(t, f, climber, []string{"firstname", "name"})
	f.waitForRow("boulder", "climber", func(row *leaderboardRow) bool { return row != nil && row.Name == "Cleo C." })

	f.exec(`DELETE FROM users WHERE id = $1 RETURNING id`, climber)
	err := pgx.BeginFunc(context.Background(), f.app.DB, func(tx pgx.Tx) error {
		return events.Publish(context.Background(), tx, "user:"+climber, "user.deleted", map[string]string{"id": climber}, events.Audience{Users: []string{climber}})
	})
	if err != nil {
		t.Fatal(err)
	}
	f.waitForRow("boulder", "climber", absent)
}

type comparableBoard struct {
	Rows      []leaderboardRow
	Stats     leaderboardStats
	Grades    []leaderboardGrade
	TopRoutes []leaderboardRoute
	Sends     map[string][]leaderboardSend
}

func comparable(board leaderboardBoard) comparableBoard {
	sends := map[string][]leaderboardSend{}
	for user, userSends := range board.sends {
		sorted := slices.Clone(userSends)
		slices.SortFunc(sorted, func(a, b leaderboardSend) int { return strings.Compare(a.Route, b.Route) })
		sends[user] = sorted
	}
	return comparableBoard{board.rows, board.stats, board.grades, board.topRoutes, sends}
}

func TestLiveBoardsMatchAFreshBuildAfterRandomChanges(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	random := rand.New(rand.NewPCG(1, 2))
	routes := []string{
		f.boulder(f.hallA, "5", 14.2), f.boulder(f.hallA, "6A", 15.7), f.boulder(f.hallA, "7A", 18.5), f.boulder(f.hallB, "8A", 23),
		f.exec(`INSERT INTO routes (id, gym, name, grade, grade_system, grade_index, type, location)
			VALUES ($1, $2, 'Rope', '7a', 'french', 17, 'Route', $3) RETURNING id`, ids.New(), f.gymA, f.hallA),
	}
	climbers := []string{"climber", "friend", "stranger", "setterA"}
	types := []string{"top", "flash", "attempt"}
	randomDate := func() time.Time { return time.Now().Add(-time.Duration(random.IntN(70*24)) * time.Hour) }
	var ticks []Tick
	create := func() {
		ticks = append(ticks, f.tick(climbers[random.IntN(len(climbers))], routes[random.IntN(len(routes))], types[random.IntN(len(types))], randomDate()))
	}
	for range 30 {
		create()
	}
	f.liveBoard("boulder")
	f.liveBoard("route")

	for range 40 {
		switch op := random.IntN(4); {
		case op == 0 || len(ticks) == 0:
			create()
		case op == 1:
			tick := ticks[random.IntN(len(ticks))]
			f.call(f.nameOf(tick.User), "PATCH", "/ticks/"+tick.ID, `{"type":"`+types[random.IntN(len(types))]+`"}`, http.StatusOK)
		case op == 2:
			tick := ticks[random.IntN(len(ticks))]
			f.call(f.nameOf(tick.User), "PATCH", "/ticks/"+tick.ID, `{"date":"`+randomDate().UTC().Format(time.DateOnly)+`"}`, http.StatusOK)
		default:
			index := random.IntN(len(ticks))
			f.call(f.nameOf(ticks[index].User), "DELETE", "/ticks/"+ticks[index].ID, "", http.StatusNoContent)
			ticks = slices.Delete(ticks, index, index+1)
		}
	}
	for _, kind := range []string{"boulder", "route"} {
		testapp.WaitFor(t, func() bool { return reflect.DeepEqual(comparable(f.liveBoard(kind)), comparable(f.freshBoard(kind))) })
	}
}

func (f *fixture) nameOf(user string) string {
	for name, id := range f.users {
		if id == user {
			return name
		}
	}
	f.t.Fatalf("unknown user %s", user)
	return ""
}

func TestConcurrentLeaderboardMissesShareOneBoard(t *testing.T) {
	t.Parallel()
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

func TestProfileChangesWithoutAFieldListForgetBoards(t *testing.T) {
	t.Parallel()
	if !touchesLeaderboard(nil) || touchesLeaderboard([]string{"followed_walls"}) || !touchesLeaderboard([]string{"avatar"}) {
		t.Fatal("touchesLeaderboard")
	}
}

func TestTicksAnnounceTheLeaderboardOncePerWindow(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	queued := func() (n int) {
		f.app.DB.QueryRow(ctx, `SELECT count(*) FROM jobs WHERE kind = $1 AND key = $2`, leaderboardJob, f.gymA).Scan(&n)
		return n
	}
	f.module.queueLeaderboardNews(TickChanged{User: f.users["climber"], Gym: f.gymA})
	f.module.queueLeaderboardNews(TickChanged{User: f.users["friend"], Gym: f.gymA})
	if got := queued(); got != 1 {
		t.Fatalf("queued %d announcements, want one per gym", got)
	}
	f.exec(`DELETE FROM jobs RETURNING kind`)
	f.exec(`UPDATE users SET ticks_private = true WHERE id = $1 RETURNING id`, f.users["climber"])
	f.module.queueLeaderboardNews(TickChanged{User: f.users["climber"], Gym: f.gymA})
	if got := queued(); got != 0 {
		t.Fatal("a private climber's tick announced the leaderboard")
	}

	if err := f.app.Workers[leaderboardJob](ctx, jobs.Job{Key: f.gymA}); err != nil {
		t.Fatal(err)
	}
	announced := f.outbox(TopicLeaderboard + f.gymA)
	if len(announced) != 1 || !announced[0].Audience.Public || string(announced[0].Payload) != "{}" {
		t.Fatalf("announcement = %+v", announced)
	}
}

func TestCorrectedRouteGradeReachesTicksAndTheLeaderboard(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	route := f.boulder(f.hallA, "8A", 25.1)
	f.tick("climber", route, "top", time.Now())
	f.waitForRow("boulder", "climber", func(row *leaderboardRow) bool { return row != nil && row.Score == 2510 })

	f.exec(`UPDATE routes SET grade = '6A', grade_index = 15.7 WHERE id = $1 RETURNING id`, route)
	err := pgx.BeginFunc(context.Background(), f.app.DB, func(tx pgx.Tx) error {
		return events.Publish(context.Background(), tx, "gym_changes:"+f.gymA, "route.updated",
			map[string]any{"collection": "routes", "action": "update", "record": map[string]any{"id": route}, "changed": []string{"grade", "grade_index"}},
			events.Audience{Public: true})
	})
	if err != nil {
		t.Fatal(err)
	}
	testapp.WaitFor(t, func() bool {
		var queued bool
		f.app.DB.QueryRow(context.Background(), `SELECT EXISTS (SELECT 1 FROM jobs WHERE kind = $1 AND key = $2)`, routeGradesJob, route).Scan(&queued)
		return queued
	})
	if err := f.app.Workers[routeGradesJob](context.Background(), jobs.Job{Kind: routeGradesJob, Key: route}); err != nil {
		t.Fatal(err)
	}
	f.waitForRow("boulder", "climber", func(row *leaderboardRow) bool { return row != nil && row.Score == 1570 })
	f.call("climber", "GET", "/me/ticks", "", http.StatusOK, `"grade":"6A"`, `"grade_index":15.7`)
	if updates := f.outbox(TopicOwnTicks); len(updates) != 2 || updates[1].Kind != "tick.updated" {
		t.Errorf("own_ticks events = %d", len(updates))
	}
}

func TestProfileChangesAnnounceTheClimbersLeaderboards(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	climber := f.users["climber"]
	f.tick("climber", f.boulder(f.hallA, "7A", 18.5), "top", time.Now())
	queued := func() (n int) {
		f.app.DB.QueryRow(ctx, `SELECT count(*) FROM jobs WHERE kind = $1 AND key = $2`, leaderboardJob, f.gymA).Scan(&n)
		return n
	}
	userUpdated := func(changed ...string) events.Event {
		payload, _ := json.Marshal(map[string]any{"record": map[string]string{"id": climber}, "changed": changed})
		return events.Event{Topic: "user:" + climber, Kind: "user.updated", Payload: payload}
	}

	deadline := time.Now().Add(5 * time.Second)
	for queued() == 0 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	clearJobs := func() {
		if _, err := f.app.DB.Exec(ctx, `DELETE FROM jobs`); err != nil {
			t.Fatal(err)
		}
	}

	clearJobs()
	f.exec(`UPDATE users SET leaderboard_hidden = true WHERE id = $1 RETURNING id`, climber)
	f.module.onUserEvent(userUpdated("leaderboard_hidden"))
	if got := queued(); got != 1 {
		t.Fatalf("opting out queued %d announcements, want 1", got)
	}

	clearJobs()
	f.module.onUserEvent(userUpdated("firstname"))
	if got := queued(); got != 0 {
		t.Fatal("a hidden climber's rename announced the leaderboard")
	}

	f.exec(`UPDATE users SET leaderboard_hidden = false WHERE id = $1 RETURNING id`, climber)
	f.module.onUserEvent(userUpdated("firstname"))
	if got := queued(); got != 1 {
		t.Fatalf("a rename queued %d announcements, want 1", got)
	}

	clearJobs()
	f.module.onUserEvent(userUpdated("followed_walls"))
	if got := queued(); got != 0 {
		t.Fatal("a change off the leaderboard announced it")
	}
}
