package hooks

import (
	"math"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/sync/singleflight"
)

const (
	leaderboardBestSends   = 10
	leaderboardFlashBonus  = 33
	leaderboardRollingDays = 60
	leaderboardRowLimit    = 100
	leaderboardCacheTTL    = time.Minute
	finishedSeasonCacheTTL = 6 * time.Hour
	tickStalenessLimit     = 5 * time.Second
	leaderboardTopRoutes   = 5
)

type leaderboardSend struct {
	User       string  `db:"user"`
	Route      string  `db:"route"`
	Grade      string  `db:"grade"`
	GradeIndex float64 `db:"grade_index"`
	Flash      bool    `db:"flash"`
}

type leaderboardRow struct {
	Rank    int    `json:"rank"`
	User    string `json:"user"`
	Name    string `json:"name"`
	Avatar  string `json:"avatar"`
	Score   int    `json:"score"`
	Sends   int    `json:"sends"`
	Flashes int    `json:"flashes"`
	Hardest string `json:"hardest"`
}

type leaderboardStats struct {
	Climbers int    `json:"climbers"`
	Sends    int    `json:"sends"`
	Flashes  int    `json:"flashes"`
	Hardest  string `json:"hardest"`
}

type leaderboardGrade struct {
	Grade   string `json:"grade"`
	Sends   int    `json:"sends"`
	Flashes int    `json:"flashes"`
}

type leaderboardRoute struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Color   string `json:"color"`
	Grade   string `json:"grade"`
	Sends   int    `json:"sends"`
	Flashes int    `json:"flashes"`
	Points  int    `json:"points,omitempty"`
}

type leaderboardBoard struct {
	rows      []leaderboardRow
	stats     leaderboardStats
	grades    []leaderboardGrade
	topRoutes []leaderboardRoute
	sends     map[string][]leaderboardSend
	routes    map[string]*core.Record
}

type leaderboardResult struct {
	From      string             `json:"from"`
	To        string             `json:"to"`
	Total     int                `json:"total"`
	Rows      []leaderboardRow   `json:"rows"`
	Me        *leaderboardRow    `json:"me"`
	Ahead     *int               `json:"ahead"`
	MySends   []leaderboardRoute `json:"mySends"`
	Stats     leaderboardStats   `json:"stats"`
	Grades    []leaderboardGrade `json:"grades"`
	TopRoutes []leaderboardRoute `json:"topRoutes"`
}

type cachedLeaderboard struct {
	gym      string
	board    leaderboardBoard
	from, to time.Time
	built    time.Time
	expires  time.Time
}

// ponytail: per-process cache, every instance computes its own copy
var leaderboardCache = struct {
	sync.Mutex
	entries map[string]cachedLeaderboard
	ticks   []leaderboardTick
}{entries: map[string]cachedLeaderboard{}}

// Ticks of the last minutes, so a board built while one landed is capped like an older board.
type leaderboardTick struct {
	gym     string
	day, at time.Time
}

const leaderboardTickMemory = 5 * time.Minute

var leaderboardBuilds singleflight.Group

func registerLeaderboards(app core.App) {
	validateSeason := func(e *core.RecordEvent) error {
		if !e.Record.GetDateTime("ends_at").Time().After(e.Record.GetDateTime("starts_at").Time()) {
			return apis.NewBadRequestError("A season has to end after it starts.", nil)
		}
		return e.Next()
	}
	forgetTickDays := func(e *core.RecordEvent) error {
		days := []time.Time{e.Record.GetDateTime("date").Time()}
		if original := e.Record.Original(); original != nil {
			days = append(days, original.GetDateTime("date").Time())
		}
		routes := []string{e.Record.GetString("route")}
		if original := e.Record.Original(); original != nil && original.GetString("route") != routes[0] {
			routes = append(routes, original.GetString("route"))
		}
		for _, routeID := range routes {
			gymID := ""
			if route, err := e.App.FindRecordById("routes", routeID); err == nil {
				gymID = route.GetString("gym")
			}
			forgetLeaderboardsCovering(gymID, days...)
		}
		return e.Next()
	}
	app.OnRecordAfterCreateSuccess("ticks").BindFunc(forgetTickDays)
	app.OnRecordAfterUpdateSuccess("ticks").BindFunc(forgetTickDays)
	app.OnRecordAfterDeleteSuccess("ticks").BindFunc(forgetTickDays)
	app.OnRecordAfterUpdateSuccess("users").BindFunc(func(e *core.RecordEvent) error {
		original := e.Record.Original()
		for _, field := range []string{"leaderboard_hidden", "firstname", "name", "avatar"} {
			if original == nil || e.Record.GetString(field) != original.GetString(field) {
				forgetAllLeaderboards()
				break
			}
		}
		return e.Next()
	})
	app.OnRecordCreate("seasons").BindFunc(validateSeason)
	app.OnRecordUpdate("seasons").BindFunc(validateSeason)

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.GET("/api/gyms/{gym}/leaderboard", serveLeaderboard)
		return se.Next()
	})
}

func serveLeaderboard(e *core.RequestEvent) error {
	gymID := e.Request.PathValue("gym")
	if _, err := e.App.FindRecordById("gyms", gymID); err != nil {
		return e.NotFoundError("", err)
	}
	query := e.Request.URL.Query()
	kind := query.Get("kind")
	if kind != "route" {
		kind = "boulder"
	}
	from, to := rollingLeaderboardWindow(time.Now())
	seasonID := query.Get("season")
	if seasonID != "" {
		season, err := e.App.FindRecordById("seasons", seasonID)
		if err != nil || season.GetString("gym") != gymID {
			return e.NotFoundError("", err)
		}
		from, to = seasonWindow(season)
	}

	board, err := cachedLeaderboardBoard(e.App, gymID, kind, seasonID, from, to)
	if err != nil {
		return e.InternalServerError("", err)
	}
	rows := board.rows
	result := leaderboardResult{
		From: from.Format(time.DateOnly), To: to.AddDate(0, 0, -1).Format(time.DateOnly), Total: len(rows), Rows: rows[:min(len(rows), leaderboardRowLimit)],
		MySends: []leaderboardRoute{}, Stats: board.stats, Grades: board.grades, TopRoutes: board.topRoutes,
	}
	if e.Auth != nil {
		if index := slices.IndexFunc(rows, func(row leaderboardRow) bool { return row.User == e.Auth.Id }); index >= 0 {
			result.Me = &rows[index]
			result.Ahead = pointsToNextRank(rows, index)
			for _, send := range board.sends[e.Auth.Id] {
				route := routeSummary(board.routes, send)
				route.Points = sendPoints(send)
				result.MySends = append(result.MySends, route)
			}
		}
	}
	return e.JSON(http.StatusOK, result)
}

func rollingLeaderboardWindow(now time.Time) (time.Time, time.Time) {
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	return today.AddDate(0, 0, -leaderboardRollingDays+1), today.AddDate(0, 0, 2)
}

func seasonWindow(season *core.Record) (time.Time, time.Time) {
	day := func(field string) time.Time {
		at := season.GetDateTime(field).Time()
		return time.Date(at.Year(), at.Month(), at.Day(), 0, 0, 0, 0, time.UTC)
	}
	return day("starts_at"), day("ends_at").AddDate(0, 0, 1)
}

func pointsToNextRank(rows []leaderboardRow, index int) *int {
	for i := index - 1; i >= 0; i-- {
		if rows[i].Score > rows[index].Score {
			gap := rows[i].Score - rows[index].Score
			return &gap
		}
	}
	return nil
}

func routeSummary(routes map[string]*core.Record, send leaderboardSend) leaderboardRoute {
	summary := leaderboardRoute{ID: send.Route, Grade: send.Grade, Sends: 1}
	if send.Flash {
		summary.Flashes = 1
	}
	if route := routes[send.Route]; route != nil {
		summary.Name = route.GetString("name")
		summary.Color = route.GetString("color")
	}
	return summary
}

func leaderboardKey(gymID, kind, seasonID string, from, to time.Time) string {
	return strings.Join([]string{gymID, kind, seasonID, from.Format(time.DateOnly), to.Format(time.DateOnly)}, "|")
}

func cachedLeaderboardBoard(app core.App, gymID, kind, seasonID string, from, to time.Time) (leaderboardBoard, error) {
	key := leaderboardKey(gymID, kind, seasonID, from, to)
	leaderboardCache.Lock()
	cached, ok := leaderboardCache.entries[key]
	leaderboardCache.Unlock()
	if ok && time.Now().Before(cached.expires) {
		return cached.board, nil
	}
	board, err, _ := leaderboardBuilds.Do(key, func() (any, error) {
		started := time.Now()
		board, err := buildLeaderboard(app, gymID, kind, from, to)
		if err == nil {
			storeLeaderboardBoard(key, gymID, board, from, to, started)
		}
		return board, err
	})
	return board.(leaderboardBoard), err
}

// started is when the build began reading ticks; ticks after it may be missing from the board.
func storeLeaderboardBoard(key, gymID string, board leaderboardBoard, from, to, started time.Time) {
	expires := time.Now().Add(leaderboardCacheTTL)
	if !to.After(time.Now()) {
		expires = time.Now().Add(finishedSeasonCacheTTL)
	}
	leaderboardCache.Lock()
	defer leaderboardCache.Unlock()
	for stale, cached := range leaderboardCache.entries {
		if time.Now().After(cached.expires) {
			delete(leaderboardCache.entries, stale)
		}
	}
	for _, tick := range leaderboardCache.ticks {
		if (tick.gym == "" || tick.gym == gymID) && !tick.at.Before(started) && (tick.day.IsZero() || !tick.day.Before(from) && !tick.day.After(to)) {
			// ponytail: builds slower than the limit still serve 1 s, else the cache starves under load
			expires = later(tick.at.Add(tickStalenessLimit), time.Now().Add(time.Second))
			break
		}
	}
	leaderboardCache.entries[key] = cachedLeaderboard{gym: gymID, board: board, from: from, to: to, built: started, expires: expires}
}

func later(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func forgetAllLeaderboards() {
	leaderboardCache.Lock()
	defer leaderboardCache.Unlock()
	clear(leaderboardCache.entries)
	// Boards still being built read the old names; an all-gym marker caps them like a tick would.
	leaderboardCache.ticks = append(leaderboardCache.ticks, leaderboardTick{at: time.Now()})
}

func forgetLeaderboardsCovering(gymID string, days ...time.Time) {
	leaderboardCache.Lock()
	defer leaderboardCache.Unlock()
	now := time.Now()
	recent := leaderboardCache.ticks[:0]
	for _, tick := range leaderboardCache.ticks {
		if now.Sub(tick.at) < leaderboardTickMemory {
			recent = append(recent, tick)
		}
	}
	for _, day := range days {
		if !day.IsZero() {
			recent = append(recent, leaderboardTick{gym: gymID, day: day, at: now})
		}
	}
	leaderboardCache.ticks = recent
	for key, cached := range leaderboardCache.entries {
		if gymID != "" && cached.gym != gymID {
			continue
		}
		for _, day := range days {
			if !day.IsZero() && !day.Before(cached.from) && !day.After(cached.to) {
				// A busy gym ticks every second; rebuilding on each would leave the cache always empty.
				if limit := cached.built.Add(tickStalenessLimit); limit.Before(cached.expires) {
					cached.expires = limit
					leaderboardCache.entries[key] = cached
				}
				break
			}
		}
	}
}

func buildLeaderboard(app core.App, gymID, kind string, from, to time.Time) (leaderboardBoard, error) {
	systems := "COALESCE(t.grade_system, '') IN ('font', 'v')"
	if kind == "route" {
		systems = "COALESCE(t.grade_system, '') NOT IN ('font', 'v')"
	}
	sends := []leaderboardSend{}
	// With exactly one MAX() aggregate SQLite takes the bare grade from the row holding it.
	err := app.DB().NewQuery(`
		SELECT t.user AS user, t.route AS route, t.grade AS grade, MAX(t.grade_index) AS grade_index, SUM(t.type = 'flash') > 0 AS flash
		FROM ticks t JOIN routes r ON r.id = t.route
		WHERE r.gym = {:gym} AND t.type != 'attempt' AND t.grade_index > 0 AND ` + systems + `
		AND t.date >= {:from} AND t.date < {:to}
		AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.user AND u.leaderboard_hidden = TRUE)
		GROUP BY t.user, t.route`).
		Bind(dbx.Params{"gym": gymID, "from": from.Format(time.DateTime), "to": to.Format(time.DateTime)}).
		All(&sends)
	if err != nil {
		return leaderboardBoard{}, err
	}
	rows := rankLeaderboard(sends)
	ids := make([]string, len(rows))
	for i, row := range rows {
		ids[i] = row.User
	}
	users, err := app.FindRecordsByIds("users", ids)
	if err != nil {
		return leaderboardBoard{}, err
	}
	byID := map[string]*core.Record{}
	for _, user := range users {
		byID[user.Id] = user
	}
	for i := range rows {
		if user := byID[rows[i].User]; user != nil {
			rows[i].Name = shortName(user)
			rows[i].Avatar = user.GetString("avatar")
		}
	}
	board := summarizeSends(sends)
	board.rows = rows
	routeIDs := []string{}
	for _, userSends := range board.sends {
		for _, send := range userSends {
			routeIDs = append(routeIDs, send.Route)
		}
	}
	for _, route := range board.topRoutes {
		routeIDs = append(routeIDs, route.ID)
	}
	routes, err := app.FindRecordsByIds("routes", routeIDs)
	if err != nil {
		return leaderboardBoard{}, err
	}
	board.routes = map[string]*core.Record{}
	for _, route := range routes {
		board.routes[route.Id] = route
	}
	for i, top := range board.topRoutes {
		if route := board.routes[top.ID]; route != nil {
			board.topRoutes[i].Name = route.GetString("name")
			board.topRoutes[i].Color = route.GetString("color")
		}
	}
	return board, nil
}

func summarizeSends(sends []leaderboardSend) leaderboardBoard {
	board := leaderboardBoard{grades: []leaderboardGrade{}, topRoutes: []leaderboardRoute{}, sends: map[string][]leaderboardSend{}}
	byGrade := map[string]*leaderboardGrade{}
	gradeIndex := map[string]float64{}
	byRoute := map[string]*leaderboardRoute{}
	hardest := -1.0
	for _, send := range sends {
		board.stats.Sends++
		board.sends[send.User] = append(board.sends[send.User], send)
		if byGrade[send.Grade] == nil {
			byGrade[send.Grade] = &leaderboardGrade{Grade: send.Grade}
			gradeIndex[send.Grade] = send.GradeIndex
		}
		if byRoute[send.Route] == nil {
			byRoute[send.Route] = &leaderboardRoute{ID: send.Route, Grade: send.Grade}
		}
		byGrade[send.Grade].Sends++
		byRoute[send.Route].Sends++
		if send.Flash {
			board.stats.Flashes++
			byGrade[send.Grade].Flashes++
			byRoute[send.Route].Flashes++
		}
		if send.GradeIndex > hardest {
			hardest, board.stats.Hardest = send.GradeIndex, send.Grade
		}
	}
	board.stats.Climbers = len(board.sends)
	for user, userSends := range board.sends {
		slices.SortFunc(userSends, func(a, b leaderboardSend) int { return sendPoints(b) - sendPoints(a) })
		board.sends[user] = userSends[:min(len(userSends), leaderboardBestSends)]
	}
	for _, grade := range byGrade {
		board.grades = append(board.grades, *grade)
	}
	slices.SortFunc(board.grades, func(a, b leaderboardGrade) int {
		return int(math.Round((gradeIndex[a.Grade] - gradeIndex[b.Grade]) * 100))
	})
	for _, route := range byRoute {
		board.topRoutes = append(board.topRoutes, *route)
	}
	slices.SortFunc(board.topRoutes, func(a, b leaderboardRoute) int {
		if a.Sends != b.Sends {
			return b.Sends - a.Sends
		}
		if a.Flashes != b.Flashes {
			return b.Flashes - a.Flashes
		}
		return strings.Compare(a.ID, b.ID)
	})
	board.topRoutes = board.topRoutes[:min(len(board.topRoutes), leaderboardTopRoutes)]
	return board
}

func sendPoints(send leaderboardSend) int {
	points := int(math.Round(send.GradeIndex * 100))
	if send.Flash {
		points += leaderboardFlashBonus
	}
	return points
}

func rankLeaderboard(sends []leaderboardSend) []leaderboardRow {
	byUser := map[string][]leaderboardSend{}
	for _, send := range sends {
		byUser[send.User] = append(byUser[send.User], send)
	}
	rows := make([]leaderboardRow, 0, len(byUser))
	for user, userSends := range byUser {
		slices.SortFunc(userSends, func(a, b leaderboardSend) int { return sendPoints(b) - sendPoints(a) })
		row := leaderboardRow{User: user, Sends: len(userSends), Hardest: userSends[0].Grade}
		for i, send := range userSends {
			if i < leaderboardBestSends {
				row.Score += sendPoints(send)
			}
			if send.Flash {
				row.Flashes++
			}
		}
		rows = append(rows, row)
	}
	slices.SortFunc(rows, func(a, b leaderboardRow) int {
		if a.Score != b.Score {
			return b.Score - a.Score
		}
		if a.Sends != b.Sends {
			return b.Sends - a.Sends
		}
		return strings.Compare(a.User, b.User)
	})
	for i := range rows {
		rows[i].Rank = i + 1
		if i > 0 && rows[i].Score == rows[i-1].Score {
			rows[i].Rank = rows[i-1].Rank
		}
	}
	return rows
}

func shortName(user *core.Record) string {
	words := strings.Fields(fullName(user))
	if len(words) < 2 {
		return strings.Join(words, "")
	}
	return words[0] + " " + string([]rune(words[len(words)-1])[0]) + "."
}

func fullName(user *core.Record) string {
	return strings.TrimSpace(user.GetString("firstname") + " " + user.GetString("name"))
}
