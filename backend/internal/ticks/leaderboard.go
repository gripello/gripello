package ticks

import (
	"context"
	"log/slog"
	"maps"
	"math"
	"slices"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"gripello/internal/platform/climbers"
)

const (
	leaderboardBestSends      = 10
	leaderboardFlashBonus     = 33
	leaderboardRollingDays    = 60
	leaderboardRowLimit       = 100
	leaderboardCacheTTL       = time.Minute
	finishedSeasonCacheTTL    = 6 * time.Hour
	idleBoardLimit            = 10 * time.Minute
	leaderboardDeriveInterval = time.Second
	leaderboardPairTimeout    = 2 * time.Second
	leaderboardTopRoutes      = 5
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
	Type        string `json:"type"`
	Sends       int    `json:"sends"`
	Flashes     int    `json:"flashes"`
	Points      int    `json:"points,omitempty"`
}

type routeLabel struct {
	Name, Color, GradeSystem, Type string
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

type pairKey struct{ user, route string }

// liveBoard keeps the best send per (climber, route); tick changes refresh one pair, a full load runs once per reload interval.
type liveBoard struct {
	gym, kind string
	from, to  time.Time
	best      map[pairKey]leaderboardSend
	labels    map[string]routeLabel
	board     leaderboardBoard
	ready     bool
	dirty     bool
	loading   bool
	pending   map[pairKey]bool
	derivedAt time.Time
	loadedAt  time.Time
	readAt    time.Time
}

// ponytail: per-process boards, every replica keeps its own copy; tick.changed reaches all of them through the bus
type boardCache struct {
	mu     sync.Mutex
	boards map[string]*liveBoard
	builds singleflight.Group
}

func newBoardCache() *boardCache {
	return &boardCache{boards: map[string]*liveBoard{}}
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
		summary.Name, summary.Color, summary.GradeSystem, summary.Type = route.Name, route.Color, route.GradeSystem, route.Type
	}
	return summary
}

func leaderboardKey(gymID, kind, seasonID string, from, to time.Time) string {
	return strings.Join([]string{gymID, kind, seasonID, from.Format(time.DateOnly), to.Format(time.DateOnly)}, "|")
}

func (m *module) cachedBoard(ctx context.Context, gymID, kind, seasonID string, from, to time.Time) (leaderboardBoard, error) {
	key := leaderboardKey(gymID, kind, seasonID, from, to)
	c := m.boards
	now := time.Now()
	c.mu.Lock()
	c.evictIdle(now)
	b := c.boards[key]
	if b == nil || !b.ready {
		c.mu.Unlock()
		board, err, _ := c.builds.Do(key, func() (any, error) {
			return m.loadNewBoard(context.WithoutCancel(ctx), key, gymID, kind, from, to)
		})
		return board.(leaderboardBoard), err
	}
	b.readAt = now
	if !b.loading && now.Sub(b.loadedAt) >= b.reloadInterval(now) {
		b.loading = true
		go func() {
			if err := m.loadBoard(context.WithoutCancel(ctx), b); err != nil {
				slog.Warn("leaderboard: reload failed", "board", key, "error", err)
			}
		}()
	}
	board := b.board
	stale := b.dirty && now.Sub(b.derivedAt) >= leaderboardDeriveInterval
	c.mu.Unlock()
	if !stale {
		return board, nil
	}
	derived, err, _ := c.builds.Do("derive|"+key, func() (any, error) { return m.derive(context.WithoutCancel(ctx), b) })
	if err != nil {
		slog.Warn("leaderboard: derive failed", "board", key, "error", err)
		return board, nil
	}
	return derived.(leaderboardBoard), nil
}

func (b *liveBoard) reloadInterval(now time.Time) time.Duration {
	if !b.to.After(now) {
		return finishedSeasonCacheTTL
	}
	return leaderboardCacheTTL
}

func (c *boardCache) evictIdle(now time.Time) {
	for key, b := range c.boards {
		if b.ready && !b.loading && now.Sub(b.readAt) > max(idleBoardLimit, b.reloadInterval(now)) {
			delete(c.boards, key)
		}
	}
}

func (m *module) loadNewBoard(ctx context.Context, key, gymID, kind string, from, to time.Time) (leaderboardBoard, error) {
	c := m.boards
	c.mu.Lock()
	if b := c.boards[key]; b != nil {
		c.mu.Unlock()
		return b.board, nil
	}
	b := &liveBoard{gym: gymID, kind: kind, from: from, to: to, best: map[pairKey]leaderboardSend{}, pending: map[pairKey]bool{}, loading: true, readAt: time.Now()}
	c.boards[key] = b
	c.mu.Unlock()
	err := m.loadBoard(ctx, b)
	var board leaderboardBoard
	if err == nil {
		board, err = m.derive(ctx, b)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if err != nil {
		delete(c.boards, key)
		return leaderboardBoard{}, err
	}
	b.ready = true
	return board, nil
}

// loadBoard runs with b.loading set; changes seen meanwhile wait in b.pending and are replayed on top.
func (m *module) loadBoard(ctx context.Context, b *liveBoard) error {
	c := m.boards
	started := time.Now()
	sends, err := m.loadPairs(ctx, b.gym, b.kind, b.from, b.to)
	c.mu.Lock()
	if err == nil {
		b.best = make(map[pairKey]leaderboardSend, len(sends))
		for _, send := range sends {
			b.best[pairKey{send.User, send.Route}] = send
		}
		b.labels, b.loadedAt, b.dirty = nil, started, true
	}
	for len(b.pending) > 0 {
		pending := b.pending
		b.pending = map[pairKey]bool{}
		c.mu.Unlock()
		for change := range pending {
			sends, err := m.climberSends(change.user, change.route)
			c.mu.Lock()
			if err == nil {
				b.replace(change, sends)
			}
			c.mu.Unlock()
		}
		c.mu.Lock()
	}
	b.loading = false
	c.mu.Unlock()
	return err
}

func (m *module) derive(ctx context.Context, b *liveBoard) (leaderboardBoard, error) {
	c := m.boards
	c.mu.Lock()
	sends := slices.Collect(maps.Values(b.best))
	labels, loadedAt := b.labels, b.loadedAt
	b.dirty, b.derivedAt = false, time.Now()
	c.mu.Unlock()
	board, err := m.boardFromSends(ctx, sends, labels)
	c.mu.Lock()
	defer c.mu.Unlock()
	if err != nil {
		b.dirty = true
		return leaderboardBoard{}, err
	}
	b.board = board
	if b.loadedAt.Equal(loadedAt) {
		b.labels = board.routes
	}
	return board, nil
}

// refreshClimber re-reads one climber's sends (one route, or all with route "") for the boards of gym ("" = every gym).
func (m *module) refreshClimber(gym, user, route string) {
	c := m.boards
	change := pairKey{user, route}
	c.mu.Lock()
	var live []*liveBoard
	for _, b := range c.boards {
		if gym != "" && b.gym != gym {
			continue
		}
		if b.loading {
			b.pending[change] = true
		} else {
			live = append(live, b)
		}
	}
	c.mu.Unlock()
	if len(live) == 0 {
		return
	}
	sends, err := m.climberSends(user, route)
	if err != nil {
		slog.Warn("leaderboard: refreshing a climber failed", "user", user, "route", route, "error", err)
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, b := range live {
		if b.loading {
			b.pending[change] = true
		} else {
			b.replace(change, sends)
		}
	}
}

func (c *boardCache) markDirty() {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, b := range c.boards {
		b.dirty = true
	}
}

type climberSend struct {
	leaderboardSend
	gym, gradeSystem string
	date             time.Time
}

func (b *liveBoard) replace(change pairKey, sends []climberSend) {
	for pair := range b.best {
		if pair.user == change.user && (change.route == "" || pair.route == change.route) {
			delete(b.best, pair)
		}
	}
	for _, send := range sends {
		if send.gym != b.gym || isBoulderGrade(send.gradeSystem) != (b.kind == "boulder") || send.date.Before(b.from) || !send.date.Before(b.to) {
			continue
		}
		pair := pairKey{change.user, send.Route}
		best, seen := b.best[pair]
		flash := send.Flash || seen && best.Flash
		if !seen || send.GradeIndex > best.GradeIndex {
			best = send.leaderboardSend
		}
		best.Flash = flash
		b.best[pair] = best
	}
	b.dirty = true
}

func isBoulderGrade(system string) bool {
	return system == "font" || system == "v"
}

func (m *module) climberSends(user, route string) ([]climberSend, error) {
	ctx, cancel := context.WithTimeout(context.Background(), leaderboardPairTimeout)
	defer cancel()
	sql := `SELECT t.route, r.gym, t.grade, t.grade_index, t.type = 'flash', t.grade_system, t.date
		FROM ticks t JOIN routes r ON r.id = t.route JOIN users u ON u.id = t."user"
		WHERE t."user" = $1 AND t.type <> 'attempt' AND t.grade_index > 0 AND NOT u.leaderboard_hidden AND NOT u.ticks_private`
	args := []any{user}
	if route != "" {
		sql += ` AND t.route = $2`
		args = append(args, route)
	}
	rows, err := m.app.DB.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var sends []climberSend
	for rows.Next() {
		send := climberSend{leaderboardSend: leaderboardSend{User: user}}
		if err := rows.Scan(&send.Route, &send.gym, &send.Grade, &send.GradeIndex, &send.Flash, &send.gradeSystem, &send.date); err != nil {
			return nil, err
		}
		sends = append(sends, send)
	}
	return sends, rows.Err()
}

func (m *module) loadPairs(ctx context.Context, gymID, kind string, from, to time.Time) ([]leaderboardSend, error) {
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
		return nil, err
	}
	defer rows.Close()
	var sends []leaderboardSend
	for rows.Next() {
		var s leaderboardSend
		if err := rows.Scan(&s.User, &s.Route, &s.Grade, &s.GradeIndex, &s.Flash); err != nil {
			return nil, err
		}
		sends = append(sends, s)
	}
	return sends, rows.Err()
}

// boardFromSends ranks and summarizes in memory; only route labels missing from known are queried.
func (m *module) boardFromSends(ctx context.Context, sends []leaderboardSend, known map[string]routeLabel) (leaderboardBoard, error) {
	ranked := rankLeaderboard(sends)
	userIDs := make([]string, len(ranked))
	for i, row := range ranked {
		userIDs[i] = row.User
	}
	people, err := m.climbers.Get(ctx, userIDs)
	if err != nil {
		return leaderboardBoard{}, err
	}
	found := []climbers.Climber{}
	foundRows := []int{}
	for i := range ranked {
		if person, ok := people[ranked[i].User]; ok {
			found = append(found, person)
			foundRows = append(foundRows, i)
			ranked[i].Avatar = person.Avatar
		}
	}
	for j, name := range climbers.DistinctShortNames(found) {
		ranked[foundRows[j]].Name = name
	}
	board := summarizeSends(sends)
	board.rows = ranked
	board.routes = maps.Clone(known)
	if board.routes == nil {
		board.routes = map[string]routeLabel{}
	}
	missing := []string{}
	for _, userSends := range board.sends {
		for _, send := range userSends {
			if _, ok := board.routes[send.Route]; !ok {
				missing = append(missing, send.Route)
			}
		}
	}
	for _, route := range board.topRoutes {
		if _, ok := board.routes[route.ID]; !ok {
			missing = append(missing, route.ID)
		}
	}
	if len(missing) > 0 {
		fetched, err := m.routeLabels(ctx, missing)
		if err != nil {
			return leaderboardBoard{}, err
		}
		maps.Copy(board.routes, fetched)
	}
	for i, top := range board.topRoutes {
		if route, ok := board.routes[top.ID]; ok {
			board.topRoutes[i].Name, board.topRoutes[i].Color, board.topRoutes[i].GradeSystem, board.topRoutes[i].Type = route.Name, route.Color, route.GradeSystem, route.Type
		}
	}
	return board, nil
}

func (m *module) routeLabels(ctx context.Context, routeIDs []string) (map[string]routeLabel, error) {
	rows, err := m.app.DB.Query(ctx, `SELECT id, name, color, grade_system, type FROM routes WHERE id = ANY ($1)`, routeIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	labels := map[string]routeLabel{}
	for rows.Next() {
		var id string
		var label routeLabel
		if err := rows.Scan(&id, &label.Name, &label.Color, &label.GradeSystem, &label.Type); err != nil {
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
