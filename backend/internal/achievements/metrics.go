package achievements

import (
	"sort"
	"time"
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

// Dates are UTC days ("2006-01-02"); ScrewDate and ArchivedAt are "" when unset.
type achievementTick struct {
	Route       string
	RouteName   string
	Type        string
	Attempts    int
	Date        string
	Grade       string
	GradeSystem string
	GradeIndex  float64
	Gym         string
	Wall        string
	Color       string
	ScrewDate   string
	ArchivedAt  string
	Permanent   bool
}

// metric is a value plus, where the value counts dated events, the day each one happened.
type metric struct {
	Value   int
	Current int
	Days    []string
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

func axisOf(tick achievementTick) string {
	if tick.GradeSystem == "font" || tick.GradeSystem == "v" {
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

// tickMetrics derives every achievement that only needs the climber's own ticks (ordered by date, created).
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

// perfectMonths returns, per started month, the last session of months whose every week (by Monday) had a session.
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

func tierFor(definition achievement, value int) int {
	tier := 0
	for index, threshold := range definition.Tiers {
		if value >= threshold {
			tier = index + 1
		}
	}
	return tier
}
