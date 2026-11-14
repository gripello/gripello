package platformadmin

import (
	"context"
	"math"
	"net/http"
	"time"

	"gripello/internal/platform/httpx"
)

// minGroup hides counts of 1–4 people, so no small group in a breakdown points at someone.
const minGroup = 5

type insightRange struct{ days, stepDays int }

var insightRanges = map[string]insightRange{
	"30d": {30, 1},
	"90d": {90, 1},
	"12m": {364, 7},
}

// retentionWeeks are the cohort columns: back at least N weeks after signing up.
var retentionWeeks = []int{2, 4, 12}

type insightKPI struct {
	Value    *float64 `json:"value"`
	Previous *float64 `json:"previous"`
}

type insightPoint struct {
	Day      string `json:"day"`
	Visitors int64  `json:"visitors"`
	Climbers *int64 `json:"climbers"`
	Logs     int64  `json:"logs"`
	Reviews  int64  `json:"reviews"`
}

type insightCohort struct {
	Month    string   `json:"month"`
	Accounts *int64   `json:"accounts"`
	Verified *int64   `json:"verified"`
	FirstLog *int64   `json:"first_log"`
	Back     []*int64 `json:"back"`
}

type insightFeature struct {
	Feature          string   `json:"feature"`
	Requests         int64    `json:"requests"`
	PreviousRequests int64    `json:"previous_requests"`
	PeoplePerDay     *float64 `json:"people_per_day"`
	SignedInShare    *float64 `json:"signed_in_share"`
	AppShare         *float64 `json:"app_share"`
}

func group(n int64) *int64 {
	if n > 0 && n < minGroup {
		return nil
	}
	return &n
}

func share(part, total int64) *float64 {
	if total < minGroup {
		return nil
	}
	v := float64(part) / float64(total)
	return &v
}

func number(n int64) *float64 {
	v := float64(n)
	return &v
}

// insights feeds /platform/insights: aggregates only, never a row per person.
func (m *module) insights(w http.ResponseWriter, r *http.Request) error {
	rangeName := r.URL.Query().Get("range")
	ir, ok := insightRanges[rangeName]
	if !ok {
		rangeName, ir = "30d", insightRanges["30d"]
	}
	ctx := r.Context()
	kpis, err := m.insightKPIs(ctx, ir.days)
	if err != nil {
		return err
	}
	series, err := m.insightSeries(ctx, ir)
	if err != nil {
		return err
	}
	cohorts, err := m.insightCohorts(ctx)
	if err != nil {
		return err
	}
	features, err := m.insightFeatures(ctx, ir.days)
	if err != nil {
		return err
	}
	preferences, err := m.insightPreferences(ctx)
	if err != nil {
		return err
	}
	gyms, err := m.insightGyms(ctx, ir.days)
	if err != nil {
		return err
	}
	devices, err := m.insightBreakdown(ctx, ir.days, "device")
	if err != nil {
		return err
	}
	systems, err := m.insightBreakdown(ctx, ir.days, "os")
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"range": rangeName, "step_days": ir.stepDays, "kpis": kpis, "series": series, "cohorts": cohorts,
		"retention_weeks": retentionWeeks, "features": features, "preferences": preferences, "gyms": gyms, "devices": devices, "systems": systems,
	})
	return nil
}

func (m *module) insightKPIs(ctx context.Context, days int) (map[string]insightKPI, error) {
	var active7, active30, accounts, previousAccounts, gyms, activeGyms, previousGyms int64
	var signups, activated, previousSignups, previousActivated int64
	var appRequests, signedInRequests, previousApp, previousSignedIn int64
	if err := m.app.DB.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM user_last_seen WHERE last_seen >= now() - interval '7 days'),
		(SELECT count(*) FROM user_last_seen WHERE last_seen >= now() - interval '30 days'),
		(SELECT count(*) FROM users WHERE created >= now() - make_interval(days => $1)),
		(SELECT count(*) FROM users WHERE created >= now() - make_interval(days => 2 * $1) AND created < now() - make_interval(days => $1)),
		(SELECT count(*) FROM gyms WHERE active),
		(SELECT count(*) FROM gyms g WHERE g.active AND EXISTS (SELECT 1 FROM routes r JOIN ticks t ON t.route = r.id
			AND t.date > current_date - 7 WHERE r.gym = g.id)),
		(SELECT count(*) FROM gyms g WHERE g.active AND EXISTS (SELECT 1 FROM routes r JOIN ticks t ON t.route = r.id
			AND t.date > current_date - 7 - $1::int AND t.date <= current_date - $1::int WHERE r.gym = g.id)),
		(SELECT COALESCE(sum(requests) FILTER (WHERE app), 0) FROM usage_daily WHERE signed_in AND day > current_date - $1::int),
		(SELECT COALESCE(sum(requests), 0) FROM usage_daily WHERE signed_in AND day > current_date - $1::int),
		(SELECT COALESCE(sum(requests) FILTER (WHERE app), 0) FROM usage_daily WHERE signed_in AND day > current_date - 2 * $1::int AND day <= current_date - $1::int),
		(SELECT COALESCE(sum(requests), 0) FROM usage_daily WHERE signed_in AND day > current_date - 2 * $1::int AND day <= current_date - $1::int)`,
		days).Scan(&active7, &active30, &accounts, &previousAccounts, &gyms, &activeGyms, &previousGyms,
		&appRequests, &signedInRequests, &previousApp, &previousSignedIn); err != nil {
		return nil, err
	}
	// Signups of the window shifted back a week, so each one had its full first week to log something.
	activation := `SELECT count(*), count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ticks t WHERE t."user" = u.id AND t.created < u.created + interval '7 days'))
		FROM users u WHERE u.created >= now() - make_interval(days => $1 + 7) AND u.created < now() - make_interval(days => $2 + 7)`
	if err := m.app.DB.QueryRow(ctx, activation, days, 0).Scan(&signups, &activated); err != nil {
		return nil, err
	}
	if err := m.app.DB.QueryRow(ctx, activation, 2*days, days).Scan(&previousSignups, &previousActivated); err != nil {
		return nil, err
	}
	snapshot := map[string]*float64{}
	rows, err := m.app.DB.Query(ctx, `SELECT metric, value FROM product_daily WHERE day = current_date - $1::int AND metric IN ('active_7d', 'active_30d')`, days)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var metric string
		var value int64
		if err := rows.Scan(&metric, &value); err != nil {
			rows.Close()
			return nil, err
		}
		snapshot[metric] = number(value)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]insightKPI{
		"active_7d":       {number(active7), snapshot["active_7d"]},
		"active_30d":      {number(active30), snapshot["active_30d"]},
		"new_accounts":    {number(accounts), number(previousAccounts)},
		"activation_rate": {share(activated, signups), share(previousActivated, previousSignups)},
		"active_gyms":     {number(activeGyms), number(previousGyms)},
		"gyms":            {number(gyms), nil},
		"app_share":       {share(appRequests, signedInRequests), share(previousApp, previousSignedIn)},
	}, nil
}

func (m *module) insightSeries(ctx context.Context, ir insightRange) ([]insightPoint, error) {
	today := time.Now().UTC().Truncate(24 * time.Hour)
	since := today.AddDate(0, 0, 1-ir.days)
	series := []insightPoint{}
	index := map[string]int{}
	for day := since; !day.After(today); day = day.AddDate(0, 0, ir.stepDays) {
		key := day.Format(time.DateOnly)
		index[key] = len(series)
		series = append(series, insightPoint{Day: key, Climbers: group(0)})
	}
	// Each day falls into the bin starting at since + a whole number of steps.
	rows, err := m.app.DB.Query(ctx, `WITH bins AS (SELECT $1::date + (day - $1::date) / $2 * $2 AS bin, kind, n FROM (
			SELECT day, 'visitors' AS kind, count(*) AS n FROM request_visitors WHERE day >= $1 GROUP BY day
			UNION ALL SELECT date, 'logs', count(*) FROM ticks WHERE date >= $1 GROUP BY date
			UNION ALL SELECT created::date, 'reviews', count(*) FROM ratings WHERE created >= $1 GROUP BY created::date
		) d)
		SELECT bin, kind, sum(n)::bigint FROM bins GROUP BY bin, kind
		UNION ALL
		SELECT $1::date + (date - $1::date) / $2 * $2 AS bin, 'climbers', count(DISTINCT "user") FROM ticks WHERE date >= $1 GROUP BY 1`,
		since, ir.stepDays)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var bin time.Time
		var kind string
		var n int64
		if err := rows.Scan(&bin, &kind, &n); err != nil {
			return nil, err
		}
		i, ok := index[bin.Format(time.DateOnly)]
		if !ok {
			continue
		}
		switch kind {
		case "visitors":
			series[i].Visitors = n
		case "logs":
			series[i].Logs = n
		case "reviews":
			series[i].Reviews = n
		case "climbers":
			series[i].Climbers = group(n)
		}
	}
	return series, rows.Err()
}

func (m *module) insightCohorts(ctx context.Context) ([]insightCohort, error) {
	rows, err := m.app.DB.Query(ctx, `SELECT date_trunc('month', u.created AT TIME ZONE 'UTC') AS month, count(*), count(*) FILTER (WHERE u.verified),
			count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ticks t WHERE t."user" = u.id AND t.created < u.created + interval '7 days')),
			count(*) FILTER (WHERE s.last_seen >= u.created + interval '2 weeks'),
			count(*) FILTER (WHERE s.last_seen >= u.created + interval '4 weeks'),
			count(*) FILTER (WHERE s.last_seen >= u.created + interval '12 weeks')
		FROM users u LEFT JOIN user_last_seen s ON s."user" = u.id
		WHERE u.created >= date_trunc('month', now() AT TIME ZONE 'UTC') - interval '11 months'
		GROUP BY 1 ORDER BY 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	now := time.Now().UTC()
	cohorts := []insightCohort{}
	for rows.Next() {
		var month time.Time
		var accounts, verified, firstLog int64
		back := make([]int64, len(retentionWeeks))
		if err := rows.Scan(&month, &accounts, &verified, &firstLog, &back[0], &back[1], &back[2]); err != nil {
			return nil, err
		}
		monthEnd := month.AddDate(0, 1, 0)
		// A step is only shown once everyone of the cohort had the time to reach it.
		reached := func(weeks int) bool { return !monthEnd.AddDate(0, 0, 7*weeks).After(now) }
		c := insightCohort{Month: month.Format("2006-01"), Accounts: group(accounts), Back: make([]*int64, len(retentionWeeks))}
		if accounts >= minGroup {
			c.Verified = group(verified)
			if reached(1) {
				c.FirstLog = group(firstLog)
			}
			for i, weeks := range retentionWeeks {
				if reached(weeks) {
					c.Back[i] = group(back[i])
				}
			}
		}
		cohorts = append(cohorts, c)
	}
	return cohorts, rows.Err()
}

// countedDays are the finished days of the range that have usage rows; people are averaged over them.
func (m *module) countedDays(ctx context.Context, days int) (n int64, err error) {
	err = m.app.DB.QueryRow(ctx, `SELECT count(DISTINCT day) FROM usage_daily WHERE day > current_date - $1::int AND day < current_date`, days).Scan(&n)
	return n, err
}

func perDay(people, days int64) *float64 {
	if days == 0 {
		return nil
	}
	v := math.Round(float64(people)/float64(days)*10) / 10
	if v > 0 && v < minGroup {
		return nil
	}
	return &v
}

type insightShare struct {
	Key          string   `json:"key"`
	Requests     int64    `json:"requests"`
	PeoplePerDay *float64 `json:"people_per_day"`
}

// insightBreakdown splits usage by one user-agent class column (device or os), most requests first.
func (m *module) insightBreakdown(ctx context.Context, days int, column string) ([]insightShare, error) {
	countedDays, err := m.countedDays(ctx, days)
	if err != nil {
		return nil, err
	}
	rows, err := m.app.DB.Query(ctx, `SELECT `+column+`, sum(requests), COALESCE(sum(people) FILTER (WHERE day < current_date), 0)
		FROM usage_daily WHERE day > current_date - $1::int GROUP BY 1 ORDER BY 2 DESC`, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	shares := []insightShare{}
	for rows.Next() {
		var s insightShare
		var people int64
		if err := rows.Scan(&s.Key, &s.Requests, &people); err != nil {
			return nil, err
		}
		s.PeoplePerDay = perDay(people, countedDays)
		shares = append(shares, s)
	}
	return shares, rows.Err()
}

func (m *module) insightFeatures(ctx context.Context, days int) ([]insightFeature, error) {
	countedDays, err := m.countedDays(ctx, days)
	if err != nil {
		return nil, err
	}
	rows, err := m.app.DB.Query(ctx, `SELECT feature,
			COALESCE(sum(requests) FILTER (WHERE day > current_date - $1::int), 0),
			COALESCE(sum(requests) FILTER (WHERE day <= current_date - $1::int), 0),
			COALESCE(sum(people) FILTER (WHERE day > current_date - $1::int AND day < current_date), 0),
			COALESCE(sum(requests) FILTER (WHERE day > current_date - $1::int AND signed_in), 0),
			COALESCE(sum(requests) FILTER (WHERE day > current_date - $1::int AND app), 0)
		FROM usage_daily WHERE day > current_date - 2 * $1::int GROUP BY feature ORDER BY 2 DESC, feature`, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	features := []insightFeature{}
	for rows.Next() {
		var f insightFeature
		var people, signedIn, app int64
		if err := rows.Scan(&f.Feature, &f.Requests, &f.PreviousRequests, &people, &signedIn, &app); err != nil {
			return nil, err
		}
		f.PeoplePerDay = perDay(people, countedDays)
		f.SignedInShare, f.AppShare = share(signedIn, f.Requests), share(app, f.Requests)
		features = append(features, f)
	}
	return features, rows.Err()
}

func (m *module) insightPreferences(ctx context.Context) (map[string]any, error) {
	var accounts, verified, push, twoFactor, ticksPrivate, leaderboardHidden, reviewsAnonymous int64
	if err := m.app.DB.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE verified),
			(SELECT count(DISTINCT "user") FROM push_subscriptions), (SELECT count(DISTINCT "user") FROM mfa_factors),
			count(*) FILTER (WHERE ticks_private), count(*) FILTER (WHERE leaderboard_hidden), count(*) FILTER (WHERE reviews_anonymous)
		FROM users`).Scan(&accounts, &verified, &push, &twoFactor, &ticksPrivate, &leaderboardHidden, &reviewsAnonymous); err != nil {
		return nil, err
	}
	breakdown := func(column string) (map[string]*int64, error) {
		rows, err := m.app.DB.Query(ctx, `SELECT `+column+`, count(*) FROM users GROUP BY 1`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		out := map[string]*int64{}
		for rows.Next() {
			var value string
			var n int64
			if err := rows.Scan(&value, &n); err != nil {
				return nil, err
			}
			out[value] = group(n)
		}
		return out, rows.Err()
	}
	languages, err := breakdown("language")
	if err != nil {
		return nil, err
	}
	followPolicies, err := breakdown("COALESCE(NULLIF(follow_policy, ''), 'approve')")
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"accounts": group(accounts), "verified": group(verified), "push_enabled": group(push), "two_factor": group(twoFactor),
		"ticks_private": group(ticksPrivate), "leaderboard_hidden": group(leaderboardHidden), "reviews_anonymous": group(reviewsAnonymous),
		"languages": languages, "follow_policies": followPolicies,
	}, nil
}

type insightGym struct {
	Gym            string     `json:"gym"`
	Climbers       *int64     `json:"climbers"`
	Logs           int64      `json:"logs"`
	PreviousLogs   int64      `json:"previous_logs"`
	Reviews        int64      `json:"reviews"`
	RoutesSet      int64      `json:"routes_set"`
	LastRouteSetAt *time.Time `json:"last_route_set_at"`
	Features       []string   `json:"features"`
}

// insightGyms shows how each active gym uses Gripello: activity in the range and which tools it has taken up.
// Staff are deliberately left out, so the table can't be read as a performance view of people.
func (m *module) insightGyms(ctx context.Context, days int) ([]insightGym, error) {
	rows, err := m.app.DB.Query(ctx, `SELECT g.id,
			(SELECT count(DISTINCT t."user") FROM routes r JOIN ticks t ON t.route = r.id AND t.date > current_date - $1::int WHERE r.gym = g.id),
			(SELECT count(*) FROM routes r JOIN ticks t ON t.route = r.id AND t.date > current_date - $1::int WHERE r.gym = g.id),
			(SELECT count(*) FROM routes r JOIN ticks t ON t.route = r.id AND t.date > current_date - 2 * $1::int
				AND t.date <= current_date - $1::int WHERE r.gym = g.id),
			(SELECT count(*) FROM ratings WHERE gym = g.id AND created > now() - make_interval(days => $1::int)),
			(SELECT count(*) FROM routes WHERE gym = g.id AND created > now() - make_interval(days => $1::int)),
			(SELECT max(created) FROM routes WHERE gym = g.id),
			array_remove(ARRAY[
				CASE WHEN EXISTS (SELECT 1 FROM tasks WHERE gym = g.id AND kind <> 'defect' AND created > now() - make_interval(days => $1::int)) THEN 'tasks' END,
				CASE WHEN EXISTS (SELECT 1 FROM tasks WHERE gym = g.id AND kind = 'defect' AND created > now() - make_interval(days => $1::int)) THEN 'defects' END,
				CASE WHEN EXISTS (SELECT 1 FROM competitions WHERE gym = g.id AND (created > now() - make_interval(days => $1::int)
					OR ends_at > now() - make_interval(days => $1::int))) THEN 'competitions' END,
				CASE WHEN EXISTS (SELECT 1 FROM beta_videos WHERE gym = g.id AND created > now() - make_interval(days => $1::int)) THEN 'betas' END,
				CASE WHEN EXISTS (SELECT 1 FROM seasons WHERE gym = g.id) THEN 'seasons' END,
				CASE WHEN EXISTS (SELECT 1 FROM walls WHERE gym = g.id) THEN 'map' END,
				CASE WHEN g.tv_settings IS NOT NULL THEN 'tv' END
			], NULL)
		FROM gyms g WHERE g.active ORDER BY 3 DESC, g.name`, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	gyms := []insightGym{}
	for rows.Next() {
		var g insightGym
		var climbers int64
		if err := rows.Scan(&g.Gym, &climbers, &g.Logs, &g.PreviousLogs, &g.Reviews, &g.RoutesSet, &g.LastRouteSetAt, &g.Features); err != nil {
			return nil, err
		}
		g.Climbers = group(climbers)
		gyms = append(gyms, g)
	}
	return gyms, rows.Err()
}
