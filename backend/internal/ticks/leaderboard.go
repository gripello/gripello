package ticks

import (
	"context"
	"math"
	"slices"
	"strings"
	"sync"
	"time"

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
	leaderboardTickMemory  = 5 * time.Minute
)

type leaderboardSend struct {
	User       string
	Route      string
	Grade      string
	GradeIndex float64
	Flash      bool
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
	ID          string `json:"id"`
	Name        string `json:"name"`
	Color       string `json:"color"`
	Grade       string `json:"grade"`
	GradeSystem string `json:"grade_system"`
	Sends       int    `json:"sends"`
	Flashes     int    `json:"flashes"`
	Points      int    `json:"points,omitempty"`
}

type routeLabel struct {
	Name, Color, GradeSystem string
}

type leaderboardBoard struct {
	rows      []leaderboardRow
	stats     leaderboardStats
	grades    []leaderboardGrade
	topRoutes []leaderboardRoute
	sends     map[string][]leaderboardSend
	routes    map[string]routeLabel
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

type cachedBoard struct {
	gym      string
	board    leaderboardBoard
	from, to time.Time
	built    time.Time
	expires  time.Time
}

// Ticks of the last minutes, so a board built while one landed is capped like an older board.
type recentTick struct {
	gym     string
	day, at time.Time
}

// ponytail: per-process cache, every replica computes its own copy; tick.changed reaches all of them through the bus
type boardCache struct {
	mu      sync.Mutex
	entries map[string]cachedBoard
	ticks   []recentTick
	builds  singleflight.Group
}

func newBoardCache() *boardCache {
	return &boardCache{entries: map[string]cachedBoard{}}
}

func (m *module) leaderboard(ctx context.Context, gymID, kind, seasonID, viewer string, from, to time.Time) (leaderboardResult, error) {
	board, err := m.cachedBoard(ctx, gymID, kind, seasonID, from, to)
	if err != nil {
		return leaderboardResult{}, err
	}
	rows := board.rows
	result := leaderboardResult{
		From: from.Format(time.DateOnly), To: to.AddDate(0, 0, -1).Format(time.DateOnly), Total: len(rows), Rows: rows[:min(len(rows), leaderboardRowLimit)],
		MySends: []leaderboardRoute{}, Stats: board.stats, Grades: board.grades, TopRoutes: board.topRoutes,
	}
	if viewer == "" {
		return result, nil
	}
	if index := slices.IndexFunc(rows, func(row leaderboardRow) bool { return row.User == viewer }); index >= 0 {
		result.Me = &rows[index]
		result.Ahead = pointsToNextRank(rows, index)
		for _, send := range board.sends[viewer] {
			route := routeSummary(board.routes, send)
			route.Points = sendPoints(send)
			result.MySends = append(result.MySends, route)
		}
	}
	return result, nil
}

func rollingLeaderboardWindow(now time.Time) (time.Time, time.Time) {
	now = now.UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	return today.AddDate(0, 0, -leaderboardRollingDays+1), today.AddDate(0, 0, 2)
}

func seasonWindow(season Season) (time.Time, time.Time) {
	day := func(at time.Time) time.Time {
		at = at.UTC()
		return time.Date(at.Year(), at.Month(), at.Day(), 0, 0, 0, 0, time.UTC)
	}
	return day(season.StartsAt), day(season.EndsAt).AddDate(0, 0, 1)
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

func routeSummary(routes map[string]routeLabel, send leaderboardSend) leaderboardRoute {
	summary := leaderboardRoute{ID: send.Route, Grade: send.Grade, Sends: 1}
	if send.Flash {
		summary.Flashes = 1
	}
	if route, ok := routes[send.Route]; ok {
		summary.Name, summary.Color, summary.GradeSystem = route.Name, route.Color, route.GradeSystem
	}
	return summary
}

func leaderboardKey(gymID, kind, seasonID string, from, to time.Time) string {
	return strings.Join([]string{gymID, kind, seasonID, from.Format(time.DateOnly), to.Format(time.DateOnly)}, "|")
}

func (m *module) cachedBoard(ctx context.Context, gymID, kind, seasonID string, from, to time.Time) (leaderboardBoard, error) {
	key := leaderboardKey(gymID, kind, seasonID, from, to)
	c := m.boards
	c.mu.Lock()
	cached, ok := c.entries[key]
	c.mu.Unlock()
	if ok && time.Now().Before(cached.expires) {
		return cached.board, nil
	}
	board, err, _ := c.builds.Do(key, func() (any, error) {
		started := time.Now()
		board, err := m.buildLeaderboard(context.WithoutCancel(ctx), gymID, kind, from, to)
		if err == nil {
			c.store(key, gymID, board, from, to, started)
		}
		return board, err
	})
	return board.(leaderboardBoard), err
}

// started is when the build began reading ticks; ticks after it may be missing from the board.
func (c *boardCache) store(key, gymID string, board leaderboardBoard, from, to, started time.Time) {
	expires := time.Now().Add(leaderboardCacheTTL)
	if !to.After(time.Now()) {
		expires = time.Now().Add(finishedSeasonCacheTTL)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for stale, cached := range c.entries {
		if time.Now().After(cached.expires) {
			delete(c.entries, stale)
		}
	}
	for _, tick := range c.ticks {
		if (tick.gym == "" || tick.gym == gymID) && !tick.at.Before(started) && (tick.day.IsZero() || !tick.day.Before(from) && !tick.day.After(to)) {
			// ponytail: builds slower than the limit still serve 1 s, else the cache starves under load
			expires = later(tick.at.Add(tickStalenessLimit), time.Now().Add(time.Second))
			break
		}
	}
	c.entries[key] = cachedBoard{gym: gymID, board: board, from: from, to: to, built: started, expires: expires}
}

func later(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func (c *boardCache) forgetAll() {
	c.mu.Lock()
	defer c.mu.Unlock()
	clear(c.entries)
	// Boards still being built read the old names; an all-gym marker caps them like a tick would.
	c.ticks = append(c.ticks, recentTick{at: time.Now()})
}

func (c *boardCache) forgetCovering(gymID string, days ...time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	recent := c.ticks[:0]
	for _, tick := range c.ticks {
		if now.Sub(tick.at) < leaderboardTickMemory {
			recent = append(recent, tick)
		}
	}
	for _, day := range days {
		if !day.IsZero() {
			recent = append(recent, recentTick{gym: gymID, day: day, at: now})
		}
	}
	c.ticks = recent
	for key, cached := range c.entries {
		if gymID != "" && cached.gym != gymID {
			continue
		}
		for _, day := range days {
			if !day.IsZero() && !day.Before(cached.from) && !day.After(cached.to) {
				// A busy gym ticks every second; rebuilding on each would leave the cache always empty.
				if limit := cached.built.Add(tickStalenessLimit); limit.Before(cached.expires) {
					cached.expires = limit
					c.entries[key] = cached
				}
				break
			}
		}
	}
}

func (m *module) buildLeaderboard(ctx context.Context, gymID, kind string, from, to time.Time) (leaderboardBoard, error) {
	systems := "t.grade_system IN ('font', 'v')"
	if kind == "route" {
		systems = "t.grade_system NOT IN ('font', 'v')"
	}
	rows, err := m.app.DB.Query(ctx, `
		SELECT t."user", t.route, (array_agg(t.grade ORDER BY t.grade_index DESC))[1], MAX(t.grade_index), bool_or(t.type = 'flash')
		FROM ticks t JOIN routes r ON r.id = t.route JOIN users u ON u.id = t."user"
		WHERE r.gym = $1 AND t.type <> 'attempt' AND t.grade_index > 0 AND `+systems+`
		AND t.date >= $2 AND t.date < $3 AND NOT u.leaderboard_hidden AND NOT u.ticks_private
		GROUP BY t."user", t.route`, gymID, from, to)
	if err != nil {
		return leaderboardBoard{}, err
	}
	var sends []leaderboardSend
	for rows.Next() {
		var s leaderboardSend
		if err := rows.Scan(&s.User, &s.Route, &s.Grade, &s.GradeIndex, &s.Flash); err != nil {
			rows.Close()
			return leaderboardBoard{}, err
		}
		sends = append(sends, s)
	}
	if err := rows.Err(); err != nil {
		return leaderboardBoard{}, err
	}
	ranked := rankLeaderboard(sends)
	userIDs := make([]string, len(ranked))
	for i, row := range ranked {
		userIDs[i] = row.User
	}
	people, err := m.climbers.Get(ctx, userIDs)
	if err != nil {
		return leaderboardBoard{}, err
	}
	for i := range ranked {
		if person, ok := people[ranked[i].User]; ok {
			ranked[i].Name, ranked[i].Avatar = person.Short, person.Avatar
		}
	}
	board := summarizeSends(sends)
	board.rows = ranked
	routeIDs := []string{}
	for _, userSends := range board.sends {
		for _, send := range userSends {
			routeIDs = append(routeIDs, send.Route)
		}
	}
	for _, route := range board.topRoutes {
		routeIDs = append(routeIDs, route.ID)
	}
	if board.routes, err = m.routeLabels(ctx, routeIDs); err != nil {
		return leaderboardBoard{}, err
	}
	for i, top := range board.topRoutes {
		if route, ok := board.routes[top.ID]; ok {
			board.topRoutes[i].Name, board.topRoutes[i].Color, board.topRoutes[i].GradeSystem = route.Name, route.Color, route.GradeSystem
		}
	}
	return board, nil
}

func (m *module) routeLabels(ctx context.Context, routeIDs []string) (map[string]routeLabel, error) {
	rows, err := m.app.DB.Query(ctx, `SELECT id, name, color, grade_system FROM routes WHERE id = ANY ($1)`, routeIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	labels := map[string]routeLabel{}
	for rows.Next() {
		var id string
		var label routeLabel
		if err := rows.Scan(&id, &label.Name, &label.Color, &label.GradeSystem); err != nil {
			return nil, err
		}
		labels[id] = label
	}
	return labels, rows.Err()
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
		userSends = slices.Clone(userSends)
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

var leaderboardProfileFields = []string{"leaderboard_hidden", "ticks_private", "firstname", "name", "username", "avatar"}

func touchesLeaderboard(changed []string) bool {
	if changed == nil {
		return true
	}
	return slices.ContainsFunc(changed, func(field string) bool { return slices.Contains(leaderboardProfileFields, field) })
}
