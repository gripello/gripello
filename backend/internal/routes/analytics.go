package routes

import (
	"cmp"
	"context"
	"encoding/json"
	"maps"
	"math"
	"math/big"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"

	"gripello/internal/platform/httpx"
)

const (
	permViewAnalytics         = "view_analytics"
	minVotesForFeedback       = 3
	analyticsListLimit        = 5
	analyticsOldestLimit      = 10
	analyticsFeedbackLimit    = 300
	day                       = 24 * time.Hour
	isoMillis                 = "2006-01-02T15:04:05.000Z"
	gradeSystemSuffix         = " · "
	disciplineBoulder         = "Boulder"
	disciplineRoute           = "Route"
	bucketDay                 = "day"
	bucketWeek                = "week"
	bucketMonth               = "month"
	locationGradeKeySeparator = "\x00"
)

var gradeSystemShort = map[string]string{"uiaa": "UIAA", "french": "Fr", "yds": "YDS", "font": "Font", "v": "Hueco"}

var presetRangeDays = map[string]int{"30d": 30, "90d": 90, "12m": 365}

type analyticsQuery struct {
	Range    string `json:"range"`
	From     string `json:"from"`
	To       string `json:"to"`
	Location string `json:"location"`
	Type     string `json:"type"`
	Archived string `json:"archived"`
}

type analyticsFilters struct {
	from            *time.Time
	to              time.Time
	locations       []string
	types           []string
	includeArchived bool
}

type analyticsRoute struct {
	ID           string          `db:"id" json:"id"`
	Name         string          `db:"name" json:"name"`
	Type         string          `db:"type" json:"type"`
	Location     string          `db:"location" json:"location"`
	LocationName string          `db:"location_name" json:"locationName"`
	Creator      json.RawMessage `db:"creator" json:"creator"`
	Archived     bool            `db:"archived" json:"archived"`
	ArchivedAt   *time.Time      `db:"archived_at" json:"archived_at"`
	Permanent    bool            `db:"permanent" json:"permanent"`
	ScrewDate    *time.Time      `db:"screw_date" json:"screw_date"`
	Created      time.Time       `db:"created" json:"created"`
	Grade        string          `db:"grade" json:"grade"`
	GradeSystem  string          `db:"grade_system" json:"grade_system"`
	GradeIndex   float64         `db:"grade_index" json:"grade_index"`
}

type analyticsRating struct {
	ID         string    `db:"id" json:"id"`
	RouteID    string    `db:"route_id" json:"route_id"`
	Rating     int       `db:"rating" json:"rating"`
	Comment    string    `db:"comment" json:"comment"`
	GradeIndex float64   `db:"grade_index" json:"grade_index"`
	Created    time.Time `db:"created" json:"created"`
}

type trend struct {
	Value    float64  `json:"value"`
	Previous *float64 `json:"previous"`
}

type timelineDatum struct {
	Period string `json:"period"`
	Count  int    `json:"count"`
}

type gradeDatum struct {
	Grade    string  `json:"grade"`
	Total    int     `json:"total"`
	Expected float64 `json:"expected"`
}

type routeSummary struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Grade     string   `json:"grade"`
	Type      string   `json:"type"`
	Location  *string  `json:"location"`
	Creators  []string `json:"creators"`
	ScrewDate string   `json:"screwDate"`
}

type ratedRoute struct {
	routeSummary
	AverageRating float64 `json:"averageRating"`
	Ratings       int     `json:"ratings"`
}

type feedbackRoute struct {
	routeSummary
	GradeSystem string  `json:"gradeSystem"`
	SetGrade    float64 `json:"setGrade"`
	VotedGrade  float64 `json:"votedGrade"`
	Deviation   float64 `json:"deviation"`
	Votes       int     `json:"votes"`
}

type setterStats struct {
	Setter           string   `json:"setter"`
	Routes           int      `json:"routes"`
	RoutesInPeriod   int      `json:"routesInPeriod"`
	AverageRating    *float64 `json:"averageRating"`
	AverageDeviation *float64 `json:"averageDeviation"`
}

type agedRoute struct {
	routeSummary
	AgeDays int `json:"ageDays"`
}

type locationGradeDatum struct {
	Location string `json:"location"`
	Grade    string `json:"grade"`
	Count    int    `json:"count"`
}

type latestComment struct {
	ID        string `json:"id"`
	RouteID   string `json:"routeId"`
	RouteName string `json:"routeName"`
	Rating    int    `json:"rating"`
	Comment   string `json:"comment"`
	Created   string `json:"created"`
}

type gradeAnalytics struct {
	GradeDistribution []gradeDatum         `json:"gradeDistribution"`
	LocationGrades    []locationGradeDatum `json:"locationGrades"`
	GradeFeedback     []feedbackRoute      `json:"gradeFeedback"`
}

type analyticsSummary struct {
	ActiveRoutes        int   `json:"activeRoutes"`
	RoutesSet           trend `json:"routesSet"`
	Ratings             trend `json:"ratings"`
	AverageRating       trend `json:"averageRating"`
	Comments            trend `json:"comments"`
	AverageLifespanDays *int  `json:"averageLifespanDays"`
	UnratedRoutes       int   `json:"unratedRoutes"`
}

type analyticsPeriod struct {
	From *string `json:"from"`
	To   string  `json:"to"`
}

type analyticsResponse struct {
	GeneratedAt        string                    `json:"generatedAt"`
	Period             analyticsPeriod           `json:"period"`
	Bucket             string                    `json:"bucket"`
	Summary            analyticsSummary          `json:"summary"`
	Grades             map[string]gradeAnalytics `json:"grades"`
	RouteTimeline      []timelineDatum           `json:"routeTimeline"`
	RatingTimeline     []timelineDatum           `json:"ratingTimeline"`
	CommentTimeline    []timelineDatum           `json:"commentTimeline"`
	DailyRouteActivity []timelineDatum           `json:"dailyRouteActivity"`
	RatingDistribution [5]int                    `json:"ratingDistribution"`
	Setters            []setterStats             `json:"setters"`
	RatingBaseline     *float64                  `json:"ratingBaseline"`
	TopRated           []ratedRoute              `json:"topRated"`
	LowestRated        []ratedRoute              `json:"lowestRated"`
	OldestActive       []agedRoute               `json:"oldestActive"`
	LatestComments     []latestComment           `json:"latestComments"`
}

func (m *module) getAnalytics(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	gym, err := resolveGym(ctx, m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	if err := m.require(ctx, gym, permViewAnalytics); err != nil {
		return err
	}
	query := r.URL.Query()
	now := time.Now().Truncate(time.Millisecond)
	filters := resolveAnalyticsFilters(analyticsQuery{
		Range: query.Get("range"), From: query.Get("from"), To: query.Get("to"),
		Location: query.Get("location"), Type: query.Get("type"), Archived: query.Get("archived"),
	}, now)
	routes, ratings, err := loadAnalyticsRows(ctx, m.app.DB, gym)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, buildAnalytics(routes, ratings, filters, now))
	return nil
}

func loadAnalyticsRows(ctx context.Context, q querier, gym string) ([]analyticsRoute, []analyticsRating, error) {
	rows, err := q.Query(ctx, `SELECT r.id, r.name, r.type, COALESCE(r.location, '') AS location,
		COALESCE(l.name, '') AS location_name, r.creator, r.archived, r.archived_at, r.permanent,
		r.screw_date, r.created, r.grade, r.grade_system, r.grade_index
		FROM routes r LEFT JOIN locations l ON l.id = r.location
		WHERE r.gym = $1 ORDER BY r.created DESC, r.id`, gym)
	if err != nil {
		return nil, nil, err
	}
	routes, err := pgx.CollectRows(rows, pgx.RowToStructByName[analyticsRoute])
	if err != nil {
		return nil, nil, err
	}
	rows, err = q.Query(ctx, `SELECT id, route_id, rating, comment, grade_index, created
		FROM ratings WHERE gym = $1 ORDER BY created DESC, id`, gym)
	if err != nil {
		return nil, nil, err
	}
	ratings, err := pgx.CollectRows(rows, pgx.RowToStructByName[analyticsRating])
	if err != nil {
		return nil, nil, err
	}
	// Millisecond precision keeps period boundaries and day counts identical to the client's Date maths.
	for i := range routes {
		route := &routes[i]
		route.Created = route.Created.Truncate(time.Millisecond)
		for _, at := range []*time.Time{route.ScrewDate, route.ArchivedAt} {
			if at != nil {
				*at = at.Truncate(time.Millisecond)
			}
		}
	}
	for i := range ratings {
		ratings[i].Created = ratings[i].Created.Truncate(time.Millisecond)
	}
	return routes, ratings, nil
}

func splitList(raw string) []string {
	var values []string
	for _, value := range strings.Split(raw, ",") {
		if value = strings.TrimSpace(value); value != "" {
			values = append(values, value)
		}
	}
	return values
}

func startOfDay(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

func endOfDay(t time.Time) time.Time {
	return startOfDay(t).Add(day - time.Millisecond)
}

func parseQueryDate(value string) *time.Time {
	if value == "" {
		return nil
	}
	value = strings.Replace(value, " ", "T", 1)
	for _, layout := range []string{time.DateOnly, time.RFC3339Nano, "2006-01-02T15:04:05.999999999"} {
		if at, err := time.Parse(layout, value); err == nil {
			return &at
		}
	}
	return nil
}

func resolveAnalyticsFilters(q analyticsQuery, now time.Time) analyticsFilters {
	rangeKey := q.Range
	if _, preset := presetRangeDays[rangeKey]; !preset && rangeKey != "all" && rangeKey != "custom" {
		rangeKey = "90d"
	}
	filters := analyticsFilters{
		to:              now,
		locations:       splitList(q.Location),
		types:           splitList(q.Type),
		includeArchived: q.Archived == "true",
	}
	if rangeKey == "custom" {
		if from := parseQueryDate(q.From); from != nil {
			start := startOfDay(*from)
			filters.from = &start
		}
		if to := parseQueryDate(q.To); to != nil {
			filters.to = endOfDay(*to)
		}
		if filters.from != nil && filters.from.After(filters.to) {
			start, end := startOfDay(filters.to), endOfDay(*filters.from)
			filters.from, filters.to = &start, end
		}
	} else if days, preset := presetRangeDays[rangeKey]; preset {
		from := now.Add(-time.Duration(days) * day)
		filters.from = &from
	}
	return filters
}

func gradeScore(index float64) *float64 {
	if index > 0 {
		return &index
	}
	return nil
}

func gradeKey(grade, system string, withSystem bool) string {
	grade = strings.TrimSpace(grade)
	if grade == "" {
		return "?"
	}
	if short, known := gradeSystemShort[system]; withSystem && known {
		return grade + gradeSystemSuffix + short
	}
	return grade
}

func hasSeveralGradeSystems(routes []*analyticsRoute) bool {
	systems := map[string]bool{}
	for _, route := range routes {
		if route.GradeSystem != "" {
			systems[route.GradeSystem] = true
		}
	}
	return len(systems) > 1
}

func normalizeCreators(raw json.RawMessage) []string {
	var list []any
	if json.Unmarshal(raw, &list) == nil {
		creators := []string{}
		for _, value := range list {
			if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
				creators = append(creators, strings.TrimSpace(text))
			}
		}
		return creators
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		if creators := splitList(text); creators != nil {
			return creators
		}
	}
	return []string{}
}

func (route *analyticsRoute) date() time.Time {
	if route.ScrewDate != nil {
		return *route.ScrewDate
	}
	return route.Created
}

func inPeriod(at time.Time, from *time.Time, to time.Time) bool {
	return (from == nil || !at.Before(*from)) && !at.After(to)
}

func mean(values []float64) *float64 {
	if len(values) == 0 {
		return nil
	}
	sum := 0.0
	for _, value := range values {
		sum += value
	}
	result := sum / float64(len(values))
	return &result
}

// Rounds the exact binary value half away from zero like JavaScript's toFixed; strconv rounds exact ties to even.
func round(value float64, digits int) float64 {
	scaled := new(big.Float).SetPrec(256).SetFloat64(math.Abs(value))
	scaled.Mul(scaled, new(big.Float).SetPrec(256).SetFloat64(math.Pow(10, float64(digits))))
	whole, _ := scaled.Int(nil)
	if new(big.Float).Sub(scaled, new(big.Float).SetInt(whole)).Cmp(big.NewFloat(0.5)) >= 0 {
		whole.Add(whole, big.NewInt(1))
	}
	rounded, _ := strconv.ParseFloat(whole.String()+"e-"+strconv.Itoa(digits), 64)
	if rounded == 0 {
		return 0
	}
	return math.Copysign(rounded, value)
}

func roundPtr(value *float64) *float64 {
	if value == nil {
		return nil
	}
	rounded := round(*value, 2)
	return &rounded
}

func isoTime(t time.Time) string {
	return t.UTC().Format(isoMillis)
}

func bucketKey(t time.Time, bucket string) string {
	t = t.UTC()
	switch bucket {
	case bucketMonth:
		return t.Format("2006-01")
	case bucketWeek:
		monday := startOfDay(t)
		return monday.AddDate(0, 0, -((int(monday.Weekday()) + 6) % 7)).Format(time.DateOnly)
	default:
		return t.Format(time.DateOnly)
	}
}

func fillBuckets(counts map[string]int, start *time.Time, end time.Time, bucket string) []timelineDatum {
	var first string
	if start != nil {
		first = bucketKey(*start, bucket)
	} else if len(counts) > 0 {
		first = slices.Min(slices.Collect(maps.Keys(counts)))
	} else {
		return []timelineDatum{}
	}
	last := bucketKey(end, bucket)
	layout := time.DateOnly
	if bucket == bucketMonth {
		layout = "2006-01"
	}
	cursor, _ := time.Parse(layout, first)
	result := []timelineDatum{}
	for key := first; key <= last; key = bucketKey(cursor, bucket) {
		result = append(result, timelineDatum{Period: key, Count: counts[key]})
		switch bucket {
		case bucketMonth:
			cursor = cursor.AddDate(0, 1, 0)
		case bucketWeek:
			cursor = cursor.AddDate(0, 0, 7)
		default:
			cursor = cursor.AddDate(0, 0, 1)
		}
	}
	return result
}

func toTimeline(counts map[string]int) []timelineDatum {
	result := []timelineDatum{}
	for _, period := range slices.Sorted(maps.Keys(counts)) {
		result = append(result, timelineDatum{Period: period, Count: counts[period]})
	}
	return result
}

func summarize(route *analyticsRoute, withSystem bool) routeSummary {
	var location *string
	if route.LocationName != "" {
		location = &route.LocationName
	}
	return routeSummary{
		ID: route.ID, Name: route.Name, Grade: gradeKey(route.Grade, route.GradeSystem, withSystem),
		Type: route.Type, Location: location, Creators: normalizeCreators(route.Creator),
		ScrewDate: isoTime(route.date()),
	}
}

func disciplineOf(route *analyticsRoute) string {
	if route.Type == disciplineBoulder {
		return disciplineBoulder
	}
	return disciplineRoute
}

func hasComment(rating *analyticsRating) bool {
	return strings.TrimSpace(rating.Comment) != ""
}

func starValues(ratings []*analyticsRating) []float64 {
	stars := []float64{}
	for _, rating := range ratings {
		if rating.Rating > 0 {
			stars = append(stars, float64(rating.Rating))
		}
	}
	return stars
}

func filterPtrs[T any](items []*T, keep func(*T) bool) []*T {
	result := []*T{}
	for _, item := range items {
		if keep(item) {
			result = append(result, item)
		}
	}
	return result
}

type deviation struct {
	votedGrade float64
	deviation  float64
	votes      int
}

type analyticsBuilder struct {
	matching       []*analyticsRoute
	scoped         []*analyticsRoute
	ratingsByRoute map[string][]*analyticsRating
}

func (b *analyticsBuilder) deviationOf(route *analyticsRoute) *deviation {
	setScore := gradeScore(route.GradeIndex)
	var votes []float64
	for _, rating := range b.ratingsByRoute[route.ID] {
		if score := gradeScore(rating.GradeIndex); score != nil {
			votes = append(votes, *score)
		}
	}
	if setScore == nil || len(votes) < minVotesForFeedback {
		return nil
	}
	voted := *mean(votes)
	return &deviation{votedGrade: voted, deviation: voted - *setScore, votes: len(votes)}
}

func (b *analyticsBuilder) gradeAnalytics(discipline string) gradeAnalytics {
	inDiscipline := func(route *analyticsRoute) bool { return disciplineOf(route) == discipline }
	matching := filterPtrs(b.matching, inDiscipline)
	scoped := filterPtrs(b.scoped, inDiscipline)
	withSystem := hasSeveralGradeSystems(matching)
	key := func(route *analyticsRoute) string { return gradeKey(route.Grade, route.GradeSystem, withSystem) }

	var gradeOrder, historicOrder []string
	rows := map[string]*gradeDatum{}
	historic := map[string]int{}
	for _, route := range matching {
		grade := key(route)
		if _, seen := historic[grade]; !seen {
			historicOrder = append(historicOrder, grade)
		}
		historic[grade]++
	}
	for _, route := range scoped {
		grade := key(route)
		if rows[grade] == nil {
			rows[grade] = &gradeDatum{Grade: grade}
			gradeOrder = append(gradeOrder, grade)
		}
		rows[grade].Total++
	}
	for _, grade := range historicOrder {
		if rows[grade] == nil {
			rows[grade] = &gradeDatum{Grade: grade}
			gradeOrder = append(gradeOrder, grade)
		}
		rows[grade].Expected = round(float64(historic[grade])/float64(len(matching))*float64(len(scoped)), 1)
	}
	result := gradeAnalytics{GradeDistribution: []gradeDatum{}, LocationGrades: []locationGradeDatum{}, GradeFeedback: []feedbackRoute{}}
	for _, grade := range gradeOrder {
		result.GradeDistribution = append(result.GradeDistribution, *rows[grade])
	}

	cells := map[string]int{}
	for _, route := range scoped {
		location := route.LocationName
		if location == "" {
			location = "?"
		}
		grade := key(route)
		cellKey := location + locationGradeKeySeparator + grade
		if index, seen := cells[cellKey]; seen {
			result.LocationGrades[index].Count++
			continue
		}
		cells[cellKey] = len(result.LocationGrades)
		result.LocationGrades = append(result.LocationGrades, locationGradeDatum{Location: location, Grade: grade, Count: 1})
	}

	for _, route := range scoped {
		if found := b.deviationOf(route); found != nil {
			result.GradeFeedback = append(result.GradeFeedback, feedbackRoute{
				routeSummary: summarize(route, withSystem),
				GradeSystem:  route.GradeSystem,
				SetGrade:     round(*gradeScore(route.GradeIndex), 2),
				VotedGrade:   round(found.votedGrade, 2),
				Deviation:    round(found.deviation, 2),
				Votes:        found.votes,
			})
		}
	}
	slices.SortStableFunc(result.GradeFeedback, func(a, b feedbackRoute) int {
		return cmp.Compare(math.Abs(b.Deviation), math.Abs(a.Deviation))
	})
	if len(result.GradeFeedback) > analyticsFeedbackLimit {
		result.GradeFeedback = result.GradeFeedback[:analyticsFeedbackLimit]
	}
	return result
}

func buildAnalytics(allRoutes []analyticsRoute, allRatings []analyticsRating, filters analyticsFilters, now time.Time) analyticsResponse {
	all := make([]*analyticsRoute, len(allRoutes))
	for i := range allRoutes {
		all[i] = &allRoutes[i]
	}
	withSystem := hasSeveralGradeSystems(all)
	from, to := filters.from, filters.to
	var period time.Duration
	var previousFrom *time.Time
	var previousTo time.Time
	if from != nil {
		period = to.Sub(*from)
		start := from.Add(-period)
		previousFrom, previousTo = &start, from.Add(-time.Millisecond)
	}

	b := &analyticsBuilder{ratingsByRoute: map[string][]*analyticsRating{}}
	b.matching = filterPtrs(all, func(route *analyticsRoute) bool {
		return (len(filters.locations) == 0 || slices.Contains(filters.locations, route.Location)) &&
			(len(filters.types) == 0 || slices.Contains(filters.types, route.Type))
	})
	b.scoped = filterPtrs(b.matching, func(route *analyticsRoute) bool { return filters.includeArchived || !route.Archived })
	routeByID := map[string]*analyticsRoute{}
	for _, route := range b.scoped {
		routeByID[route.ID] = route
	}
	active := filterPtrs(b.scoped, func(route *analyticsRoute) bool { return !route.Archived })

	var scopedRatings []*analyticsRating
	for i := range allRatings {
		rating := &allRatings[i]
		if routeByID[rating.RouteID] != nil {
			scopedRatings = append(scopedRatings, rating)
			b.ratingsByRoute[rating.RouteID] = append(b.ratingsByRoute[rating.RouteID], rating)
		}
	}

	routesSetIn := func(start *time.Time, end time.Time) []*analyticsRoute {
		return filterPtrs(b.scoped, func(route *analyticsRoute) bool { return inPeriod(route.date(), start, end) })
	}
	ratingsIn := func(start *time.Time, end time.Time) []*analyticsRating {
		return filterPtrs(scopedRatings, func(rating *analyticsRating) bool { return inPeriod(rating.Created, start, end) })
	}
	commentCount := func(ratings []*analyticsRating) int { return len(filterPtrs(ratings, hasComment)) }
	routesSet := routesSetIn(from, to)
	periodRatings := ratingsIn(from, to)
	summary := analyticsSummary{
		ActiveRoutes:  len(active),
		RoutesSet:     trend{Value: float64(len(routesSet))},
		Ratings:       trend{Value: float64(len(periodRatings))},
		AverageRating: trend{},
		Comments:      trend{Value: float64(commentCount(periodRatings))},
	}
	if average := roundPtr(mean(starValues(periodRatings))); average != nil {
		summary.AverageRating.Value = *average
	}
	if previousFrom != nil {
		previousRoutes := float64(len(routesSetIn(previousFrom, previousTo)))
		previousRatings := ratingsIn(previousFrom, previousTo)
		ratingCount, comments := float64(len(previousRatings)), float64(commentCount(previousRatings))
		summary.RoutesSet.Previous = &previousRoutes
		summary.Ratings.Previous = &ratingCount
		summary.Comments.Previous = &comments
		summary.AverageRating.Previous = roundPtr(mean(starValues(previousRatings)))
	}

	var lifespans []float64
	for _, route := range b.matching {
		if !route.Archived || route.Permanent || route.ArchivedAt == nil || !inPeriod(*route.ArchivedAt, from, to) {
			continue
		}
		if days := float64(route.ArchivedAt.Sub(route.date()).Milliseconds()) / float64(day.Milliseconds()); days >= 0 {
			lifespans = append(lifespans, days)
		}
	}
	if average := mean(lifespans); average != nil {
		days := int(math.Round(*average))
		summary.AverageLifespanDays = &days
	}
	for _, route := range active {
		if b.ratingsByRoute[route.ID] == nil {
			summary.UnratedRoutes++
		}
	}

	bucket := bucketMonth
	if from != nil && period <= 62*day {
		bucket = bucketDay
	} else if from != nil && period <= 400*day {
		bucket = bucketWeek
	}
	routeTimeline, ratingTimeline, commentTimeline, daily := map[string]int{}, map[string]int{}, map[string]int{}, map[string]int{}
	for _, route := range routesSet {
		routeTimeline[bucketKey(route.date(), bucket)]++
	}
	var distribution [5]int
	for _, rating := range periodRatings {
		key := bucketKey(rating.Created, bucket)
		ratingTimeline[key]++
		if hasComment(rating) {
			commentTimeline[key]++
		}
		if rating.Rating >= 1 && rating.Rating <= 5 {
			distribution[rating.Rating-1]++
		}
	}
	for _, route := range b.scoped {
		daily[bucketKey(route.date(), bucketDay)]++
	}

	setIDs := map[string]bool{}
	for _, route := range routesSet {
		setIDs[route.ID] = true
	}
	var setterOrder []string
	setterRoutes := map[string][]*analyticsRoute{}
	for _, route := range b.scoped {
		for _, setter := range normalizeCreators(route.Creator) {
			if setterRoutes[setter] == nil {
				setterOrder = append(setterOrder, setter)
			}
			setterRoutes[setter] = append(setterRoutes[setter], route)
		}
	}
	setters := []setterStats{}
	for _, setter := range setterOrder {
		routes := setterRoutes[setter]
		stats := setterStats{Setter: setter, Routes: len(routes)}
		var stars, deviations []float64
		for _, route := range routes {
			if setIDs[route.ID] {
				stats.RoutesInPeriod++
			}
			stars = append(stars, starValues(b.ratingsByRoute[route.ID])...)
			if found := b.deviationOf(route); found != nil {
				deviations = append(deviations, found.deviation)
			}
		}
		stats.AverageRating, stats.AverageDeviation = roundPtr(mean(stars)), roundPtr(mean(deviations))
		setters = append(setters, stats)
	}
	collator := collate.New(language.Und)
	slices.SortStableFunc(setters, func(a, b setterStats) int {
		return cmp.Or(b.Routes-a.Routes, collator.CompareString(a.Setter, b.Setter))
	})

	rated := []ratedRoute{}
	for _, route := range b.scoped {
		if stars := starValues(b.ratingsByRoute[route.ID]); len(stars) >= minVotesForFeedback {
			rated = append(rated, ratedRoute{routeSummary: summarize(route, withSystem), AverageRating: round(*mean(stars), 2), Ratings: len(stars)})
		}
	}
	baseline := make([]float64, len(rated))
	for i, route := range rated {
		baseline[i] = route.AverageRating
	}
	topRated := slices.Clone(rated)
	slices.SortStableFunc(topRated, func(a, b ratedRoute) int {
		return cmp.Or(cmp.Compare(b.AverageRating, a.AverageRating), b.Ratings-a.Ratings)
	})
	topRated = topRated[:min(analyticsListLimit, len(topRated))]
	lowestRated := slices.DeleteFunc(slices.Clone(rated), func(route ratedRoute) bool {
		return slices.ContainsFunc(topRated, func(top ratedRoute) bool { return top.ID == route.ID })
	})
	slices.SortStableFunc(lowestRated, func(a, b ratedRoute) int {
		return cmp.Or(cmp.Compare(a.AverageRating, b.AverageRating), b.Ratings-a.Ratings)
	})
	lowestRated = lowestRated[:min(analyticsListLimit, len(lowestRated))]

	aging := filterPtrs(active, func(route *analyticsRoute) bool { return !route.Permanent })
	slices.SortStableFunc(aging, func(a, b *analyticsRoute) int { return a.date().Compare(b.date()) })
	oldest := []agedRoute{}
	for _, route := range aging[:min(analyticsOldestLimit, len(aging))] {
		oldest = append(oldest, agedRoute{
			routeSummary: summarize(route, withSystem),
			AgeDays:      int(math.Floor(float64(now.Sub(route.date()).Milliseconds()) / float64(day.Milliseconds()))),
		})
	}

	commented := filterPtrs(periodRatings, hasComment)
	slices.SortStableFunc(commented, func(a, b *analyticsRating) int { return b.Created.Compare(a.Created) })
	comments := []latestComment{}
	for _, rating := range commented[:min(analyticsListLimit, len(commented))] {
		comments = append(comments, latestComment{
			ID: rating.ID, RouteID: rating.RouteID, RouteName: routeByID[rating.RouteID].Name,
			Rating: rating.Rating, Comment: strings.TrimSpace(rating.Comment), Created: isoTime(rating.Created),
		})
	}

	response := analyticsResponse{
		GeneratedAt: isoTime(now),
		Period:      analyticsPeriod{To: isoTime(to)},
		Bucket:      bucket,
		Summary:     summary,
		Grades: map[string]gradeAnalytics{
			disciplineBoulder: b.gradeAnalytics(disciplineBoulder),
			disciplineRoute:   b.gradeAnalytics(disciplineRoute),
		},
		RouteTimeline:      fillBuckets(routeTimeline, from, to, bucket),
		RatingTimeline:     fillBuckets(ratingTimeline, from, to, bucket),
		CommentTimeline:    fillBuckets(commentTimeline, from, to, bucket),
		DailyRouteActivity: toTimeline(daily),
		RatingDistribution: distribution,
		Setters:            setters,
		RatingBaseline:     roundPtr(mean(baseline)),
		TopRated:           topRated,
		LowestRated:        lowestRated,
		OldestActive:       oldest,
		LatestComments:     comments,
	}
	if from != nil {
		start := isoTime(*from)
		response.Period.From = &start
	}
	return response
}
