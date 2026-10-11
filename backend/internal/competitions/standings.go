package competitions

import (
	"cmp"
	"encoding/json"
	"math"
	"slices"
	"sort"
)

const (
	defaultTopPool       = 1000.0
	defaultTopropeFactor = 0.5
	ifscTopPoints        = 25.0
	ifscZonePoints       = 10.0
	ifscAttemptPenalty   = 0.1
)

var defaultAttemptFactors = []float64{1, 0.9, 0.8}

type StandingRow struct {
	Entry      string   `json:"entry"`
	Rank       int      `json:"rank"`
	Bib        int      `json:"bib"`
	Name       string   `json:"name"`
	Points     float64  `json:"points"`
	Tops       int      `json:"tops"`
	Zones      int      `json:"zones"`
	RankPoints *float64 `json:"rankPoints,omitempty"`
}

type CategoryStanding struct {
	ID   string        `json:"id"`
	Name string        `json:"name"`
	Rows []StandingRow `json:"rows"`
}

type rankedEntry struct {
	entry          string
	rank           int
	points         float64
	tops, zones    int
	attemptsToTop  int
	attemptsToZone int
	rankPoints     *float64
}

type scoringRules struct {
	format         string
	topPool        float64
	zonePool       float64
	attemptFactors []float64
	bestOf         int
	flashBonus     float64
	topropeFactor  float64
}

func rulesOf(c Competition) scoringRules {
	var s scoringSettings
	if len(c.Scoring) > 0 {
		_ = json.Unmarshal(c.Scoring, &s)
	}
	rules := scoringRules{format: c.ScoringFormat, topPool: defaultTopPool, attemptFactors: defaultAttemptFactors,
		topropeFactor: defaultTopropeFactor}
	if s.TopPool != nil {
		rules.topPool = *s.TopPool
	}
	if s.ZonePool != nil {
		rules.zonePool = *s.ZonePool
	}
	if s.AttemptFactors != nil {
		rules.attemptFactors = s.AttemptFactors
	}
	if s.BestOf != nil {
		rules.bestOf = int(*s.BestOf)
	}
	if s.FlashBonus != nil {
		rules.flashBonus = *s.FlashBonus
	}
	if s.TopropeFactor != nil {
		rules.topropeFactor = *s.TopropeFactor
	}
	return rules
}

// buildStandings ranks every category on its own; entries are the ones still competing, so other scores never count.
func buildStandings(c Competition, categories []Category, entries []Standing, routes []CompRoute, scores []Score) []CategoryStanding {
	rules := rulesOf(c)
	byID := map[string]Standing{}
	for _, e := range entries {
		byID[e.ID] = e
	}
	out := make([]CategoryStanding, 0, len(categories))
	for _, category := range categories {
		var ids []string
		for _, e := range entries {
			if e.Category == category.ID {
				ids = append(ids, e.ID)
			}
		}
		rows := []StandingRow{}
		for _, r := range rankCompetition(ids, routes, scores, rules) {
			e := byID[r.entry]
			rows = append(rows, StandingRow{Entry: r.entry, Rank: r.rank, Bib: e.Bib, Name: e.DisplayName,
				Points: r.points, Tops: r.tops, Zones: r.zones, RankPoints: r.rankPoints})
		}
		out = append(out, CategoryStanding{ID: category.ID, Name: category.Name, Rows: rows})
	}
	return out
}

// jsRound is Math.round: halves go up, also for negatives.
func jsRound(v float64) float64 {
	r := math.Floor(v)
	if v-r >= 0.5 {
		r++
	}
	return r
}

func roundTo(v, factor float64) float64 { return jsRound(v*factor) / factor }

func hasTop(s Score) bool  { return s.TopAttempt > 0 }
func hasZone(s Score) bool { return hasTop(s) || s.ZoneAttempt > 0 }

func attemptFactor(factors []float64, attempt int) float64 {
	index := min(attempt, len(factors)) - 1
	if index < 0 {
		return 0
	}
	return factors[index]
}

func styleAndFlash(points float64, s Score, rules scoringRules) float64 {
	flash, style := 1.0, 1.0
	if s.TopAttempt == 1 {
		flash = 1 + rules.flashBonus/100
	}
	if s.Style == "toprope" {
		style = rules.topropeFactor
	}
	return points * flash * style
}

func ifscPoints(full float64, attempt int) float64 {
	penaltyTenths := jsRound(ifscAttemptPenalty * 10)
	return math.Max(0, full*10-penaltyTenths*float64(attempt-1)) / 10
}

func heightValue(s Score) float64 {
	if s.HeightPlus {
		return float64(s.Height) + 0.5
	}
	return float64(s.Height)
}

func routePoints(s Score, route CompRoute, rules scoringRules, topsPerRoute, zonesPerRoute map[string]int) float64 {
	switch rules.format {
	case "dynamic":
		if s.TopAttempt > 0 {
			return styleAndFlash(rules.topPool/float64(max(topsPerRoute[route.ID], 1)), s, rules)
		}
		if route.Zone && s.ZoneAttempt > 0 && rules.zonePool != 0 {
			return rules.zonePool / float64(max(zonesPerRoute[route.ID], 1))
		}
	case "fixed", "route_points":
		if s.TopAttempt > 0 {
			return styleAndFlash(route.Points*attemptFactor(rules.attemptFactors, s.TopAttempt), s, rules)
		}
	case "ifsc":
		if s.TopAttempt > 0 {
			return ifscPoints(ifscTopPoints, s.TopAttempt)
		}
		if route.Zone && s.ZoneAttempt > 0 {
			return ifscPoints(ifscZonePoints, s.ZoneAttempt)
		}
	case "tops":
		if s.TopAttempt > 0 {
			return 1
		}
	case "lead_height":
		return heightValue(s)
	}
	return 0
}

// tiedRankPoints gives tied entries the average of the positions they share.
func tiedRankPoints(values map[string]float64, entries []string) map[string]float64 {
	sorted := slices.Clone(entries)
	sort.SliceStable(sorted, func(i, j int) bool { return values[sorted[i]] > values[sorted[j]] })
	out := map[string]float64{}
	for start := 0; start < len(sorted); {
		end := start
		for end+1 < len(sorted) && values[sorted[end+1]] == values[sorted[start]] {
			end++
		}
		for i := start; i <= end; i++ {
			out[sorted[i]] = float64(start+1+end+1) / 2
		}
		start = end + 1
	}
	return out
}

func leadRankPoints(entries []string, routes []CompRoute, scores []Score) map[string]float64 {
	product := map[string]float64{}
	for _, e := range entries {
		product[e] = 1
	}
	for _, route := range routes {
		heights := map[string]float64{}
		for _, s := range scores {
			if s.CompRoute == route.ID {
				heights[s.Entry] = heightValue(s)
			}
		}
		ranks := tiedRankPoints(heights, entries)
		for _, e := range entries {
			product[e] *= ranks[e]
		}
	}
	exponent := 1 / float64(max(len(routes), 1))
	for e, v := range product {
		product[e] = roundTo(math.Pow(v, exponent), 1000)
	}
	return product
}

func compareRanked(format string) func(a, b rankedEntry) float64 {
	switch format {
	case "lead_height":
		return func(a, b rankedEntry) float64 { return *a.rankPoints - *b.rankPoints }
	case "tops":
		return func(a, b rankedEntry) float64 {
			return firstNonZero(float64(b.tops-a.tops), float64(b.zones-a.zones),
				float64(a.attemptsToTop-b.attemptsToTop), float64(a.attemptsToZone-b.attemptsToZone))
		}
	}
	return func(a, b rankedEntry) float64 {
		return firstNonZero(b.points-a.points, float64(b.tops-a.tops), float64(b.zones-a.zones),
			float64(a.attemptsToTop-b.attemptsToTop))
	}
}

func firstNonZero(values ...float64) float64 {
	for _, v := range values {
		if v != 0 {
			return v
		}
	}
	return 0
}

func rankCompetition(entries []string, routes []CompRoute, scores []Score, rules scoringRules) []rankedEntry {
	active := map[string]CompRoute{}
	var activeRoutes []CompRoute
	for _, r := range routes {
		if !r.Voided {
			active[r.ID] = r
			activeRoutes = append(activeRoutes, r)
		}
	}
	competing := map[string]bool{}
	for _, e := range entries {
		competing[e] = true
	}
	var counted []Score
	for _, s := range scores {
		if _, ok := active[s.CompRoute]; ok && competing[s.Entry] {
			counted = append(counted, s)
		}
	}
	zoneReached := func(s Score) bool { return active[s.CompRoute].Zone && hasZone(s) }
	topsPerRoute, zonesPerRoute := map[string]int{}, map[string]int{}
	for _, s := range counted {
		if hasTop(s) {
			topsPerRoute[s.CompRoute]++
		}
		if zoneReached(s) {
			zonesPerRoute[s.CompRoute]++
		}
	}
	var rankPoints map[string]float64
	if rules.format == "lead_height" {
		rankPoints = leadRankPoints(entries, activeRoutes, counted)
	}
	usesBestOf := rules.bestOf > 0 && rules.format != "tops" && rules.format != "lead_height"

	ranked := make([]rankedEntry, 0, len(entries))
	for _, entry := range entries {
		type scored struct {
			score  Score
			points float64
		}
		var perRoute []scored
		for _, s := range counted {
			if s.Entry == entry {
				perRoute = append(perRoute, scored{s, routePoints(s, active[s.CompRoute], rules, topsPerRoute, zonesPerRoute)})
			}
		}
		sort.SliceStable(perRoute, func(i, j int) bool { return perRoute[i].points > perRoute[j].points })
		if usesBestOf && len(perRoute) > rules.bestOf {
			perRoute = perRoute[:rules.bestOf]
		}
		r := rankedEntry{entry: entry}
		sum := 0.0
		for _, p := range perRoute {
			sum += p.points
			if hasTop(p.score) {
				r.tops++
				r.attemptsToTop += p.score.TopAttempt
			}
			if zoneReached(p.score) {
				r.zones++
				r.attemptsToZone += cmp.Or(p.score.ZoneAttempt, p.score.TopAttempt)
			}
		}
		r.points = roundTo(sum, 100)
		if rankPoints != nil {
			value := rankPoints[entry]
			r.points, r.rankPoints = value, &value
		}
		ranked = append(ranked, r)
	}

	compare := compareRanked(rules.format)
	sort.SliceStable(ranked, func(i, j int) bool { return compare(ranked[i], ranked[j]) < 0 })
	for i := range ranked {
		if i > 0 && compare(ranked[i-1], ranked[i]) == 0 {
			ranked[i].rank = ranked[i-1].rank
		} else {
			ranked[i].rank = i + 1
		}
	}
	return ranked
}
