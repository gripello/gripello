package hooks

import (
	"net/http"
	"slices"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

type achievement struct {
	Key      string `json:"key"`
	Category string `json:"category"`
	Icon     string `json:"icon"`
	Tiers    []int  `json:"tiers"`
	// Grade-based achievements stay on the climber's own profile.
	Private bool `json:"-"`
}

// Rewards variety, progress and weekly rhythm; nothing here rewards load within a single day.
var achievements = []achievement{
	{Key: "sends", Category: "volume", Icon: "i-lucide-flag", Tiers: []int{1, 10, 50, 100, 250, 500, 1000}},
	{Key: "sessions", Category: "volume", Icon: "i-lucide-calendar-check", Tiers: []int{10, 25, 50, 100, 250}},
	{Key: "flashes", Category: "style", Icon: "i-lucide-zap", Tiers: []int{1, 5, 25, 100}},
	{Key: "flash_grades", Category: "style", Icon: "i-lucide-sparkles", Tiers: []int{3, 6, 10}, Private: true},
	{Key: "personal_bests", Category: "progress", Icon: "i-lucide-trending-up", Tiers: []int{1, 5, 10}, Private: true},
	{Key: "grade_ladder", Category: "progress", Icon: "i-lucide-chart-no-axes-column-increasing", Tiers: []int{4, 8, 12}, Private: true},
	{Key: "pyramid", Category: "progress", Icon: "i-lucide-triangle", Tiers: []int{1}, Private: true},
	{Key: "project", Category: "progress", Icon: "i-lucide-target", Tiers: []int{5, 10, 20}},
	{Key: "active_weeks", Category: "rhythm", Icon: "i-lucide-calendar-range", Tiers: []int{4, 12, 26, 52}},
	{Key: "perfect_months", Category: "rhythm", Icon: "i-lucide-calendar-heart", Tiers: []int{1, 3, 6}},
	{Key: "welcome_back", Category: "rhythm", Icon: "i-lucide-door-open", Tiers: []int{1}},
	{Key: "walls", Category: "exploration", Icon: "i-lucide-compass", Tiers: []int{3, 6, 10}},
	{Key: "colors", Category: "exploration", Icon: "i-lucide-palette", Tiers: []int{5, 8, 12}},
	{Key: "gyms", Category: "exploration", Icon: "i-lucide-map", Tiers: []int{2, 3, 5, 10}},
	{Key: "all_rounder", Category: "exploration", Icon: "i-lucide-shapes", Tiers: []int{1}},
	{Key: "set_sweeper", Category: "fresh", Icon: "i-lucide-sparkle", Tiers: []int{5, 25, 100}},
	{Key: "first_ascents", Category: "fresh", Icon: "i-lucide-mountain-snow", Tiers: []int{1, 5, 20}},
	{Key: "wall_clears", Category: "fresh", Icon: "i-lucide-check-check", Tiers: []int{1, 3, 5}},
	{Key: "before_strip", Category: "fresh", Icon: "i-lucide-hourglass", Tiers: []int{1, 5, 20}},
	{Key: "reviews", Category: "community", Icon: "i-lucide-message-square-text", Tiers: []int{1, 10, 50}},
	{Key: "betas", Category: "community", Icon: "i-lucide-video", Tiers: []int{1, 5, 20}},
	{Key: "friends", Category: "community", Icon: "i-lucide-users", Tiers: []int{1, 10, 25}},
	{Key: "helper", Category: "community", Icon: "i-lucide-wrench", Tiers: []int{1, 5, 20}},
	{Key: "competitions", Category: "competition", Icon: "i-lucide-trophy", Tiers: []int{1, 3, 10}},
	{Key: "season_top10", Category: "competition", Icon: "i-lucide-medal", Tiers: []int{1, 3, 5}},
}

const (
	freshSetDays     = 7
	stripWindowDays  = 7
	welcomeBackDays  = 21
	wallClearMinimum = 3
)

type achievementTick struct {
	Route       string  `db:"route"`
	RouteName   string  `db:"route_name"`
	Type        string  `db:"type"`
	Attempts    int     `db:"attempts"`
	Date        string  `db:"date"`
	Created     string  `db:"created"`
	Grade       string  `db:"grade"`
	GradeSystem string  `db:"grade_system"`
	GradeIndex  float64 `db:"grade_index"`
	Gym         string  `db:"gym"`
	Wall        string  `db:"wall"`
	Color       string  `db:"color"`
	ScrewDate   string  `db:"screw_date"`
	ArchivedAt  string  `db:"archived_at"`
	Permanent   bool    `db:"permanent"`
}

// metric is a value plus, where the value counts dated events, the day each one happened.
type metric struct {
	Value   int      `json:"value"`
	Current int      `json:"current,omitempty"`
	Days    []string `json:"-"`
}

func counted(days []string) metric {
	sort.Strings(days)
	return metric{Value: len(days), Days: days}
}

func day(value string) string {
	if len(value) < 10 {
		return value
	}
	return value[:10]
}

func parseDay(value string) time.Time {
	parsed, _ := time.Parse(time.DateOnly, day(value))
	return parsed
}

func isBoulderSystem(system string) bool {
	return system == "font" || system == "v"
}

func axisOf(tick achievementTick) string {
	if isBoulderSystem(tick.GradeSystem) {
		return "boulder"
	}
	return "route"
}

func sendKey(tick achievementTick) string {
	if tick.Route != "" {
		return tick.Route
	}
	return "deleted:" + tick.RouteName + ":" + day(tick.Date)
}

func weekStartOf(value string) time.Time {
	at := parseDay(value)
	return at.AddDate(0, 0, -((int(at.Weekday()) + 6) % 7))
}

func loadAchievementTicks(app core.App, userID string) ([]achievementTick, error) {
	ticks := []achievementTick{}
	err := app.DB().NewQuery(`
		SELECT COALESCE(t.route, '') AS route, COALESCE(t.route_name, '') AS route_name, t.type,
			COALESCE(t.attempts, 1) AS attempts, t.date, t.created,
			COALESCE(t.grade, '') AS grade, COALESCE(t.grade_system, '') AS grade_system,
			COALESCE(t.grade_index, 0) AS grade_index,
			COALESCE(r.gym, '') AS gym, COALESCE(r.wall, '') AS wall, COALESCE(r.color, '') AS color,
			COALESCE(r.screw_date, '') AS screw_date, COALESCE(r.archived_at, '') AS archived_at,
			COALESCE(r.permanent, FALSE) AS permanent
		FROM ticks t LEFT JOIN routes r ON r.id = t.route
		WHERE t.user = {:user}
		ORDER BY t.date, t.created`).Bind(dbx.Params{"user": userID}).All(&ticks)
	return ticks, err
}

// tickMetrics derives every achievement that only needs the climber's own ticks.
func tickMetrics(ticks []achievementTick, today time.Time) map[string]metric {
	firstSend := map[string]string{}
	firstFlash := map[string]string{}
	flashGrades := map[string]string{}
	sessions := map[string]bool{}
	colors := map[string]string{}
	gyms := map[string]string{}
	wallsByGym := map[string]map[string]bool{}
	axes := map[string]string{}
	ladder := map[string]map[string]bool{}
	gradeCounts := map[string]map[float64]int{}
	best := map[string]float64{}
	attemptsBefore := map[string]int{}
	project := 0
	personalBests, freshSends, stripSends := []string{}, []string{}, []string{}

	for _, tick := range ticks {
		tickDay := day(tick.Date)
		sessions[tickDay] = true
		key := sendKey(tick)
		if tick.Type == "attempt" {
			if _, sent := firstSend[key]; !sent {
				attemptsBefore[key] += max(tick.Attempts, 1)
			}
			continue
		}
		if _, sent := firstSend[key]; sent {
			continue
		}
		firstSend[key] = tickDay
		project = max(project, attemptsBefore[key]+max(tick.Attempts, 1))
		axis := axisOf(tick)
		if _, ok := axes[axis]; !ok {
			axes[axis] = tickDay
		}
		if tick.Type == "flash" {
			firstFlash[key] = tickDay
			if tick.Grade != "" {
				if _, ok := flashGrades[axis+tick.Grade]; !ok {
					flashGrades[axis+tick.Grade] = tickDay
				}
			}
		}
		if tick.Grade != "" {
			if ladder[axis] == nil {
				ladder[axis] = map[string]bool{}
				gradeCounts[axis] = map[float64]int{}
			}
			ladder[axis][tick.Grade] = true
			gradeCounts[axis][tick.GradeIndex]++
			if previous, ok := best[axis]; !ok || tick.GradeIndex > previous {
				if ok {
					personalBests = append(personalBests, tickDay)
				}
				best[axis] = tick.GradeIndex
			}
		}
		if tick.Color != "" {
			if _, ok := colors[tick.Color]; !ok {
				colors[tick.Color] = tickDay
			}
		}
		if tick.Gym != "" {
			if _, ok := gyms[tick.Gym]; !ok {
				gyms[tick.Gym] = tickDay
			}
			if tick.Wall != "" {
				if wallsByGym[tick.Gym] == nil {
					wallsByGym[tick.Gym] = map[string]bool{}
				}
				wallsByGym[tick.Gym][tick.Wall] = true
			}
		}
		if !tick.Permanent && tick.ScrewDate != "" {
			if gap := parseDay(tickDay).Sub(parseDay(tick.ScrewDate)); gap >= 0 && gap <= freshSetDays*24*time.Hour {
				freshSends = append(freshSends, tickDay)
			}
		}
		if tick.ArchivedAt != "" {
			if gap := parseDay(tick.ArchivedAt).Sub(parseDay(tickDay)); gap >= 0 && gap <= stripWindowDays*24*time.Hour {
				stripSends = append(stripSends, tickDay)
			}
		}
	}

	values := func(source map[string]string) []string {
		days := make([]string, 0, len(source))
		for _, value := range source {
			days = append(days, value)
		}
		return days
	}
	sessionDays := make([]string, 0, len(sessions))
	for value := range sessions {
		sessionDays = append(sessionDays, value)
	}
	sort.Strings(sessionDays)

	walls := 0
	for _, gymWalls := range wallsByGym {
		walls = max(walls, len(gymWalls))
	}
	gradeLadder := 0
	for _, grades := range ladder {
		gradeLadder = max(gradeLadder, len(grades))
	}
	pyramid := metric{}
	for _, counts := range gradeCounts {
		if hasPyramid(counts) {
			pyramid = metric{Value: 1}
		}
	}
	allRounder := metric{}
	if len(axes) == 2 {
		allRounder = metric{Value: 1, Days: []string{max(axes["boulder"], axes["route"])}}
	}
	bestRun, currentRun := activeWeeks(sessionDays, today)

	return map[string]metric{
		"sends":          counted(values(firstSend)),
		"sessions":       counted(sessionDays),
		"flashes":        counted(values(firstFlash)),
		"flash_grades":   counted(values(flashGrades)),
		"personal_bests": counted(personalBests),
		"grade_ladder":   {Value: gradeLadder},
		"pyramid":        pyramid,
		"project":        {Value: project},
		"active_weeks":   {Value: bestRun, Current: currentRun},
		"perfect_months": counted(perfectMonths(sessionDays, today)),
		"welcome_back":   counted(comebacks(sessionDays)),
		"walls":          {Value: walls},
		"colors":         counted(values(colors)),
		"gyms":           counted(values(gyms)),
		"all_rounder":    allRounder,
		"set_sweeper":    counted(freshSends),
		"before_strip":   counted(stripSends),
	}
}

func hasPyramid(counts map[float64]int) bool {
	grades := make([]float64, 0, len(counts))
	for grade := range counts {
		grades = append(grades, grade)
	}
	if len(grades) < 3 {
		return false
	}
	sort.Sort(sort.Reverse(sort.Float64Slice(grades)))
	return counts[grades[0]] >= 1 && counts[grades[1]] >= 2 && counts[grades[2]] >= 4
}

// activeWeeks counts weeks with a session; one empty week is forgiven, two in a row end the run.
func activeWeeks(sessionDays []string, today time.Time) (int, int) {
	weeks := []time.Time{}
	for _, value := range sessionDays {
		week := weekStartOf(value)
		if len(weeks) == 0 || !weeks[len(weeks)-1].Equal(week) {
			weeks = append(weeks, week)
		}
	}
	best, run := 0, 0
	for index, week := range weeks {
		if index > 0 && week.Sub(weeks[index-1]) > 14*24*time.Hour {
			run = 0
		}
		run++
		best = max(best, run)
	}
	if len(weeks) == 0 || weekStartOf(today.Format(time.DateOnly)).Sub(weeks[len(weeks)-1]) > 14*24*time.Hour {
		run = 0
	}
	return best, run
}

// perfectMonths returns, per finished-or-complete month, the last session of months whose every week (by Monday) had a session.
func perfectMonths(sessionDays []string, today time.Time) []string {
	weeks := map[time.Time]bool{}
	lastByMonth := map[string]string{}
	for _, value := range sessionDays {
		weeks[weekStartOf(value)] = true
		lastByMonth[value[:7]] = value
	}
	days := []string{}
	for month, last := range lastByMonth {
		start := parseDay(month + "-01")
		complete := true
		for monday := weekStartOf(month + "-01"); monday.Before(start.AddDate(0, 1, 0)); monday = monday.AddDate(0, 0, 7) {
			if monday.Before(start) {
				continue
			}
			if !weeks[monday] {
				complete = false
				break
			}
		}
		if complete && !weekStartOf(today.Format(time.DateOnly)).Before(start) {
			days = append(days, last)
		}
	}
	return days
}

func comebacks(sessionDays []string) []string {
	days := []string{}
	for index := 1; index < len(sessionDays); index++ {
		if parseDay(sessionDays[index]).Sub(parseDay(sessionDays[index-1])) >= welcomeBackDays*24*time.Hour {
			days = append(days, sessionDays[index])
		}
	}
	return days
}

func countQuery(app core.App, query, userID string) int {
	var count int
	if err := app.DB().NewQuery(query).Bind(dbx.Params{"user": userID}).Row(&count); err != nil {
		app.Logger().Warn("achievements: count failed", "error", err)
	}
	return count
}

func communityMetrics(app core.App, userID string) map[string]metric {
	return map[string]metric{
		"first_ascents": {Value: countQuery(app, `
			SELECT COUNT(*) FROM (
				SELECT t.route, MIN(t.date || t.created) AS first FROM ticks t
				JOIN routes r ON r.id = t.route
				WHERE t.user = {:user} AND t.type != 'attempt' AND r.permanent = FALSE
				GROUP BY t.route
			) mine
			WHERE mine.first <= (SELECT MIN(o.date || o.created) FROM ticks o WHERE o.route = mine.route AND o.type != 'attempt')`, userID)},
		"wall_clears": {Value: countQuery(app, `
			SELECT COUNT(*) FROM walls w
			WHERE w.id IN (SELECT r.wall FROM ticks t JOIN routes r ON r.id = t.route WHERE t.user = {:user} AND t.type != 'attempt')
			AND (SELECT COUNT(*) FROM routes r WHERE r.wall = w.id AND r.archived = FALSE) >= `+strconv.Itoa(wallClearMinimum)+`
			AND NOT EXISTS (
				SELECT 1 FROM routes r WHERE r.wall = w.id AND r.archived = FALSE
				AND NOT EXISTS (SELECT 1 FROM ticks t WHERE t.route = r.id AND t.user = {:user} AND t.type != 'attempt')
			)`, userID)},
		"reviews":      {Value: countQuery(app, `SELECT COUNT(*) FROM ratings WHERE user = {:user}`, userID)},
		"betas":        {Value: countQuery(app, `SELECT COUNT(*) FROM beta_videos WHERE user = {:user}`, userID)},
		"friends":      {Value: countQuery(app, `SELECT COUNT(DISTINCT CASE WHEN follower = {:user} THEN followee ELSE follower END) FROM follows WHERE status = 'accepted' AND (follower = {:user} OR followee = {:user})`, userID)},
		"helper":       {Value: countQuery(app, `SELECT COUNT(*) FROM tasks WHERE kind = 'defect' AND reporter = {:user} AND status = 'done'`, userID)},
		"competitions": {Value: countQuery(app, `SELECT COUNT(DISTINCT competition) FROM competition_entries WHERE user = {:user} AND status IN ('registered', 'checked_in')`, userID)},
	}
}

// seasonTopTens counts finished seasons in which the climber placed in a top ten.
func seasonTopTens(app core.App, userID string, gyms []string, now time.Time) int {
	if len(gyms) == 0 {
		return 0
	}
	seasons, err := app.FindAllRecords("seasons", dbx.In("gym", toAny(gyms)...))
	if err != nil {
		return 0
	}
	count := 0
	for _, season := range seasons {
		from, to := seasonWindow(season)
		if to.After(now) {
			continue
		}
		for _, kind := range []string{"boulder", "route"} {
			board, err := cachedLeaderboardBoard(app, season.GetString("gym"), kind, season.Id, from, to)
			if err != nil {
				continue
			}
			if slices.ContainsFunc(board.rows, func(row leaderboardRow) bool { return row.User == userID && row.Rank <= 10 }) {
				count++
				break
			}
		}
	}
	return count
}

func toAny(values []string) []any {
	out := make([]any, len(values))
	for index, value := range values {
		out[index] = value
	}
	return out
}

func computeAchievements(app core.App, userID string, now time.Time) (map[string]metric, error) {
	ticks, err := loadAchievementTicks(app, userID)
	if err != nil {
		return nil, err
	}
	metrics := tickMetrics(ticks, now)
	for key, value := range communityMetrics(app, userID) {
		metrics[key] = value
	}
	gyms := []string{}
	for _, tick := range ticks {
		if tick.Gym != "" && !slices.Contains(gyms, tick.Gym) {
			gyms = append(gyms, tick.Gym)
		}
	}
	metrics["season_top10"] = metric{Value: seasonTopTens(app, userID, gyms, now)}
	return metrics, nil
}

func tierFor(definition achievement, value int) int {
	tier := 0
	for index, threshold := range definition.Tiers {
		if value >= threshold {
			tier = index + 1
		}
	}
	return tier
}

type earnedTier struct {
	Key  string
	Tier int
	Day  string
}

// awardAchievements stores newly reached tiers. The first evaluation is silent when it backfills tiers reached before today.
func awardAchievements(app core.App, userID string, now time.Time) ([]earnedTier, error) {
	metrics, err := computeAchievements(app, userID, now)
	if err != nil {
		return nil, err
	}
	stored, err := app.FindAllRecords("user_badges", dbx.HashExp{"user": userID})
	if err != nil {
		return nil, err
	}
	have := map[string]bool{}
	for _, record := range stored {
		have[record.GetString("key")+"#"+strconv.Itoa(record.GetInt("tier"))] = true
	}
	collection, err := app.FindCollectionByNameOrId("user_badges")
	if err != nil {
		return nil, err
	}
	earned := []earnedTier{}
	for _, definition := range achievements {
		current := metrics[definition.Key]
		for tier := 1; tier <= tierFor(definition, current.Value); tier++ {
			if have[definition.Key+"#"+strconv.Itoa(tier)] {
				continue
			}
			earnedOn := now.Format(time.DateOnly)
			if threshold := definition.Tiers[tier-1]; threshold <= len(current.Days) {
				earnedOn = current.Days[threshold-1]
			}
			record := core.NewRecord(collection)
			record.Set("user", userID)
			record.Set("key", definition.Key)
			record.Set("tier", tier)
			record.Set("earned_on", earnedOn+" 12:00:00.000Z")
			if err := app.Save(record); err != nil {
				if exists, _ := app.CountRecords("user_badges", dbx.HashExp{"user": userID, "key": definition.Key, "tier": tier}); exists > 0 {
					continue
				}
				return earned, err
			}
			earned = append(earned, earnedTier{Key: definition.Key, Tier: tier, Day: earnedOn})
		}
	}
	if len(stored) == 0 && slices.ContainsFunc(earned, func(tier earnedTier) bool { return tier.Day < now.Format(time.DateOnly) }) {
		return nil, nil
	}
	return earned, nil
}

var achievementSlots = make(chan struct{}, 2)

var achievementQueue = struct {
	sync.Mutex
	running, again map[string]bool
	idle           sync.Cond
}{running: map[string]bool{}, again: map[string]bool{}}

func init() {
	achievementQueue.idle.L = &achievementQueue.Mutex
}

// queueAchievements evaluates in the background, one run per climber at a time; requests during a run coalesce into one rerun.
func queueAchievements(app core.App, userID string) {
	if userID == "" {
		return
	}
	queue := &achievementQueue
	queue.Lock()
	defer queue.Unlock()
	if queue.running[userID] {
		queue.again[userID] = true
		return
	}
	queue.running[userID] = true
	go func() {
		for {
			evaluateSafely(app, userID)
			queue.Lock()
			if !queue.again[userID] {
				delete(queue.running, userID)
				if len(queue.running) == 0 {
					queue.idle.Broadcast()
				}
				queue.Unlock()
				return
			}
			delete(queue.again, userID)
			queue.Unlock()
		}
	}()
}

func evaluateSafely(app core.App, userID string) {
	achievementSlots <- struct{}{}
	defer func() { <-achievementSlots }()
	defer func() {
		if failure := recover(); failure != nil {
			app.Logger().Error("achievements: evaluation panicked", "user", userID, "panic", failure)
		}
	}()
	evaluateAndNotify(app, userID)
}

func waitForAchievements() {
	queue := &achievementQueue
	queue.Lock()
	defer queue.Unlock()
	for len(queue.running) > 0 {
		queue.idle.Wait()
	}
}

func evaluateAndNotify(app core.App, userID string) {
	earned, err := awardAchievements(app, userID, time.Now())
	if err != nil {
		app.Logger().Warn("achievements: evaluation failed", "user", userID, "error", err)
		return
	}
	if len(earned) == 0 {
		return
	}
	user, err := app.FindRecordById("users", userID)
	if err != nil {
		return
	}
	pushNotification(app, notification{
		Users:  []*core.Record{user},
		Type:   "achievement_earned",
		Params: map[string]any{"count": len(earned), "key": earned[len(earned)-1].Key},
		URL:    "/climber?id=" + userID + "#achievements",
	})
}

type achievementView struct {
	achievement
	Value   int      `json:"value"`
	Current int      `json:"current"`
	Tier    int      `json:"tier"`
	Earned  []string `json:"earned"`
}

func achievementViews(app core.App, userID string, includePrivate bool) ([]achievementView, error) {
	metrics, err := computeAchievements(app, userID, time.Now())
	if err != nil {
		return nil, err
	}
	stored, _ := app.FindAllRecords("user_badges", dbx.HashExp{"user": userID})
	earnedDays := map[string]map[int]string{}
	for _, record := range stored {
		key := record.GetString("key")
		if earnedDays[key] == nil {
			earnedDays[key] = map[int]string{}
		}
		earnedDays[key][record.GetInt("tier")] = day(record.GetDateTime("earned_on").String())
	}
	views := []achievementView{}
	for _, definition := range achievements {
		if definition.Private && !includePrivate {
			continue
		}
		current := metrics[definition.Key]
		tier := tierFor(definition, current.Value)
		earned := make([]string, tier)
		for index := range earned {
			earned[index] = earnedDays[definition.Key][index+1]
		}
		views = append(views, achievementView{achievement: definition, Value: current.Value, Current: current.Current, Tier: tier, Earned: earned})
	}
	return views, nil
}

func registerAchievements(app core.App) {
	byField := func(field string) func(e *core.RecordEvent) error {
		return func(e *core.RecordEvent) error {
			queueAchievements(app, e.Record.GetString(field))
			return e.Next()
		}
	}
	app.OnRecordAfterCreateSuccess("ticks").BindFunc(byField("user"))
	app.OnRecordAfterUpdateSuccess("ticks").BindFunc(byField("user"))
	app.OnRecordAfterCreateSuccess("ratings").BindFunc(byField("user"))
	app.OnRecordAfterCreateSuccess("beta_videos").BindFunc(byField("user"))
	app.OnRecordAfterCreateSuccess("competition_entries").BindFunc(byField("user"))
	app.OnRecordAfterUpdateSuccess("tasks").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetString("kind") == "defect" && e.Record.GetString("status") == "done" && e.Record.Original().GetString("status") != "done" {
			queueAchievements(app, e.Record.GetString("reporter"))
		}
		return e.Next()
	})
	followAccepted := func(e *core.RecordEvent) error {
		if e.Record.GetString("status") == "accepted" {
			queueAchievements(app, e.Record.GetString("follower"))
			queueAchievements(app, e.Record.GetString("followee"))
		}
		return e.Next()
	}
	app.OnRecordAfterCreateSuccess("follows").BindFunc(followAccepted)
	app.OnRecordAfterUpdateSuccess("follows").BindFunc(followAccepted)

	app.OnTerminate().BindFunc(func(e *core.TerminateEvent) error {
		waitForAchievements()
		return e.Next()
	})

	app.Cron().MustAdd("achievementsSeasons", "30 3 * * *", func() {
		evaluateFinishedSeasons(app, time.Now())
	})

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.GET("/api/climbers/{id}/achievements", func(e *core.RequestEvent) error {
			userID := e.Request.PathValue("id")
			user, err := e.App.FindRecordById("users", userID)
			if err != nil {
				return e.NotFoundError("", err)
			}
			self := user.Id == e.Auth.Id
			if !self && (user.GetBool("ticks_private") || !visibleTo(e.Auth.Id, connectedClimbers(e.App, e.Auth.Id), user) ||
				slices.Contains(blockersOf(e.App, e.Auth.Id), user.Id)) {
				return e.NotFoundError("", nil)
			}
			views, err := achievementViews(e.App, user.Id, self)
			if err != nil {
				return e.InternalServerError("", err)
			}
			return e.JSON(http.StatusOK, views)
		}).Bind(apis.RequireAuth("users"), climberLookups.middleware())
		return se.Next()
	})
}

// evaluateFinishedSeasons awards season placements once a season has ended.
func evaluateFinishedSeasons(app core.App, now time.Time) {
	seasons, err := app.FindAllRecords("seasons")
	if err != nil {
		return
	}
	for _, season := range seasons {
		from, to := seasonWindow(season)
		if to.After(now) || now.Sub(to) > 48*time.Hour {
			continue
		}
		for _, kind := range []string{"boulder", "route"} {
			started := time.Now()
			board, err := buildLeaderboard(app, season.GetString("gym"), kind, from, to)
			if err != nil {
				continue
			}
			storeLeaderboardBoard(leaderboardKey(season.GetString("gym"), kind, season.Id, from, to), season.GetString("gym"), board, from, to, started)
			for _, row := range board.rows {
				if row.Rank <= 10 {
					queueAchievements(app, row.User)
				}
			}
		}
	}
}
