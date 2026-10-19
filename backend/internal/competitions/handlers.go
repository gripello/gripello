package competitions

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/tenancy"
)

func readBody(r *http.Request) (json.RawMessage, error) {
	var raw json.RawMessage
	err := httpx.Decode(r, &raw)
	return raw, err
}

// unmarshalBody applies only the fields present in the body onto target, which makes PATCH and create share one path.
func unmarshalBody(raw json.RawMessage, target any) error {
	err := json.Unmarshal(raw, target)
	var typeErr *json.UnmarshalTypeError
	switch {
	case err == nil:
		return nil
	case errors.As(err, &typeErr) && typeErr.Field != "":
		return invalid(typeErr.Field, "Invalid value.")
	default:
		return badRequest("Invalid JSON body.")
	}
}

func multi(r *http.Request, key string) []string {
	var out []string
	for _, value := range slices.Concat(r.URL.Query()[key], r.URL.Query()[key+"[]"]) {
		for _, part := range strings.Split(value, ",") {
			if part != "" {
				out = append(out, part)
			}
		}
	}
	return out
}

func respondItems[T any](w http.ResponseWriter, items []T, err error) error {
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	return nil
}

func respond(w http.ResponseWriter, status int, v any, err error) error {
	if err != nil {
		return err
	}
	httpx.JSON(w, status, v)
	return nil
}

func noContent(w http.ResponseWriter, err error) error {
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (m *module) expandLocations(ctx context.Context, r *http.Request, items []Competition) error {
	if !slices.Contains(multi(r, "include"), "location") {
		return nil
	}
	var locationIDs []string
	for _, c := range items {
		locationIDs = append(locationIDs, c.Location)
	}
	rows, err := m.app.DB.Query(ctx, `SELECT id, name FROM locations WHERE id = ANY ($1)`, locationIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	names := map[string]string{}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return err
		}
		names[id] = name
	}
	for i := range items {
		items[i].Expand = map[string]any{"location": map[string]string{"id": items[i].Location, "name": names[items[i].Location], "gym": items[i].Gym}}
	}
	return rows.Err()
}

func (m *module) listCompetitions(w http.ResponseWriter, r *http.Request) error {
	gym, err := tenancy.ResolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	statuses := multi(r, "status")
	for _, status := range statuses {
		if !slices.Contains(competitionStatuses, status) {
			return invalid("status", "Invalid value "+status+".")
		}
	}
	sql := `SELECT ` + competitionColumns + ` FROM competitions WHERE gym = $1 AND ($2::text[] IS NULL OR status = ANY ($2))`
	if !m.viewerOf(r.Context(), gym).manager {
		sql += ` AND status <> 'draft'`
	}
	order := map[string]string{"": ` ORDER BY starts_at, id`, "starts_at": ` ORDER BY starts_at, id`, "-starts_at": ` ORDER BY starts_at DESC, id`}
	sort, ok := order[r.URL.Query().Get("sort")]
	if !ok {
		return invalid("sort", "Unknown sort.")
	}
	items, err := list[Competition](r.Context(), m.app.DB, sql+sort, gym, statuses)
	if err != nil {
		return err
	}
	return respondItems(w, items, m.expandLocations(r.Context(), r, items))
}

func (m *module) getCompetition(w http.ResponseWriter, r *http.Request) error {
	c, _, err := m.loadVisible(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	items := []Competition{c}
	err = m.expandLocations(r.Context(), r, items)
	return respond(w, http.StatusOK, items[0], err)
}

func (m *module) withExpandedCompetition(w http.ResponseWriter, r *http.Request, status int, c Competition, err error) error {
	if err != nil {
		return err
	}
	items := []Competition{c}
	err = m.expandLocations(r.Context(), r, items)
	return respond(w, status, items[0], err)
}

func (m *module) postCompetition(w http.ResponseWriter, r *http.Request) error {
	gym, err := tenancy.ResolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	raw, err := readBody(r)
	if err != nil {
		return err
	}
	c, err := m.createCompetition(r.Context(), gym, raw)
	return m.withExpandedCompetition(w, r, http.StatusCreated, c, err)
}

func (m *module) patchCompetition(w http.ResponseWriter, r *http.Request) error {
	raw, err := readBody(r)
	if err != nil {
		return err
	}
	c, err := m.updateCompetition(r.Context(), r.PathValue("id"), raw)
	return m.withExpandedCompetition(w, r, http.StatusOK, c, err)
}

func (m *module) publishCompetition(w http.ResponseWriter, r *http.Request) error {
	c, err := m.updateCompetition(r.Context(), r.PathValue("id"), json.RawMessage(`{"status":"published"}`))
	return respond(w, http.StatusOK, c, err)
}

func (m *module) deleteCompetitionHandler(w http.ResponseWriter, r *http.Request) error {
	return noContent(w, m.deleteCompetition(r.Context(), r.PathValue("id")))
}

func (m *module) listCategories(w http.ResponseWriter, r *http.Request) error {
	c, _, err := m.loadVisible(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	items, err := m.categories(r.Context(), c.ID)
	return respondItems(w, items, err)
}

func (m *module) categories(ctx context.Context, competition string) ([]Category, error) {
	return list[Category](ctx, m.app.DB, `SELECT `+categoryColumns+` FROM competition_categories
		WHERE competition = $1 ORDER BY sort, name, id`, competition)
}

func (m *module) postCategory(w http.ResponseWriter, r *http.Request) error {
	raw, err := readBody(r)
	if err != nil {
		return err
	}
	c, err := m.saveCategory(r.Context(), r.PathValue("id"), "", raw)
	return respond(w, http.StatusCreated, c, err)
}

func (m *module) patchCategory(w http.ResponseWriter, r *http.Request) error {
	raw, err := readBody(r)
	if err != nil {
		return err
	}
	c, err := m.saveCategory(r.Context(), "", r.PathValue("id"), raw)
	return respond(w, http.StatusOK, c, err)
}

func (m *module) deleteCategoryHandler(w http.ResponseWriter, r *http.Request) error {
	return noContent(w, m.deleteCategory(r.Context(), r.PathValue("id")))
}

func (m *module) listRoutes(w http.ResponseWriter, r *http.Request) error {
	c, _, err := m.loadVisible(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	sql := `SELECT ` + routeColumns + ` FROM competition_routes WHERE competition = $1`
	switch r.URL.Query().Get("voided") {
	case "false":
		sql += ` AND NOT voided`
	case "true":
		sql += ` AND voided`
	}
	items, err := list[CompRoute](r.Context(), m.app.DB, sql+` ORDER BY number, id`, c.ID)
	if err != nil {
		return err
	}
	return respondItems(w, items, m.expandRoutes(r.Context(), items))
}

func (m *module) expandRoutes(ctx context.Context, items []CompRoute) error {
	var routeIDs []string
	for _, r := range items {
		routeIDs = append(routeIDs, r.Route)
	}
	routes, err := routeSummaries(ctx, m.app.DB, routeIDs)
	for i := range items {
		if route, ok := routes[items[i].Route]; ok {
			items[i].Expand = map[string]any{"route": route}
		}
	}
	return err
}

func (m *module) respondRoute(w http.ResponseWriter, r *http.Request, status int, route CompRoute, err error) error {
	if err != nil {
		return err
	}
	items := []CompRoute{route}
	err = m.expandRoutes(r.Context(), items)
	return respond(w, status, items[0], err)
}

func (m *module) postRoute(w http.ResponseWriter, r *http.Request) error {
	raw, err := readBody(r)
	if err != nil {
		return err
	}
	route, err := m.saveCompRoute(r.Context(), r.PathValue("id"), "", raw)
	return m.respondRoute(w, r, http.StatusCreated, route, err)
}

func (m *module) patchRoute(w http.ResponseWriter, r *http.Request) error {
	raw, err := readBody(r)
	if err != nil {
		return err
	}
	route, err := m.saveCompRoute(r.Context(), "", r.PathValue("id"), raw)
	return m.respondRoute(w, r, http.StatusOK, route, err)
}

func (m *module) deleteRouteHandler(w http.ResponseWriter, r *http.Request) error {
	return noContent(w, m.deleteCompRoute(r.Context(), r.PathValue("id")))
}

// listEntries: staff and judges see every entry; others their own plus visible ones of a non-draft competition,
// without user id, birth year, consent and payment of other climbers.
func (m *module) listEntries(w http.ResponseWriter, r *http.Request) error {
	c, err := findVisibleCompetition(r.Context(), m.app.DB, r.PathValue("id"))
	if err != nil {
		return err
	}
	v := m.viewerFor(r.Context(), c)
	statuses := multi(r, "status")
	if user := r.URL.Query().Get("user"); user != "" && !v.staff && user != v.user {
		return respondItems(w, []Entry{}, nil)
	}
	sql := `SELECT ` + entryColumns + ` FROM competition_entries WHERE competition = $1
		AND ($2::text[] IS NULL OR status = ANY ($2)) AND ($3 = '' OR "user" = $3)
		AND ($6 OR "user" = $4 OR ($5 AND NOT hidden)) ORDER BY bib, id`
	items, err := list[Entry](r.Context(), m.app.DB, sql, c.ID, statuses, r.URL.Query().Get("user"),
		v.user, c.Status != "draft", v.staff)
	if err != nil {
		return err
	}
	categories, err := m.categories(r.Context(), c.ID)
	if err != nil {
		return err
	}
	for i := range items {
		e := &items[i]
		if !v.staff && e.User != v.user {
			e.User, e.BirthYear, e.GuardianConsent, e.Paid = "", 0, false, false
		}
		for _, category := range categories {
			if category.ID == e.Category {
				e.Expand = map[string]any{"category": category}
			}
		}
	}
	return respondItems(w, items, nil)
}

func (m *module) postEntry(w http.ResponseWriter, r *http.Request) error {
	raw, err := readBody(r)
	if err != nil {
		return err
	}
	e, err := m.createEntry(r.Context(), r.PathValue("id"), raw)
	return respond(w, http.StatusCreated, e, err)
}

func (m *module) patchEntry(w http.ResponseWriter, r *http.Request) error {
	raw, err := readBody(r)
	if err != nil {
		return err
	}
	e, err := m.updateEntry(r.Context(), r.PathValue("id"), raw)
	return respond(w, http.StatusOK, e, err)
}

func (m *module) deleteEntryHandler(w http.ResponseWriter, r *http.Request) error {
	return noContent(w, m.deleteEntry(r.Context(), r.PathValue("id")))
}

func scoresPublic(c Competition, now time.Time) bool {
	return c.Status == "published" ||
		(c.Status != "draft" && c.LiveRanking && (c.FreezeAt == nil || c.FreezeAt.After(now)))
}

// listScores: staff and judges see all; others their own entry's scores, everyone's once published or while live ranking runs.
func (m *module) listScores(w http.ResponseWriter, r *http.Request) error {
	c, err := findVisibleCompetition(r.Context(), m.app.DB, r.PathValue("id"))
	if err != nil {
		return err
	}
	v := m.viewerFor(r.Context(), c)
	sql := `SELECT ` + scoreColumns + ` FROM competition_scores WHERE competition = $1 AND ($2 = '' OR entry = $2)
		AND ($3 OR entry IN (SELECT id FROM competition_entries WHERE competition = $1 AND "user" = $4))`
	items, err := list[Score](r.Context(), m.app.DB, sql+` ORDER BY created, id`, c.ID, r.URL.Query().Get("entry"),
		v.staff || scoresPublic(c, time.Now()), v.user)
	return respondItems(w, items, err)
}

func (m *module) putScores(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Scores []Score `json:"scores"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if len(body.Scores) == 0 || len(body.Scores) > 500 {
		return invalid("scores", "Send between 1 and 500 scores.")
	}
	items, err := m.upsertScores(r.Context(), r.PathValue("id"), body.Scores)
	return respondItems(w, items, err)
}

func (m *module) deleteScoreHandler(w http.ResponseWriter, r *http.Request) error {
	return noContent(w, m.deleteScore(r.Context(), r.PathValue("id")))
}

func (m *module) standings(ctx context.Context, competition string, staff bool) ([]Standing, error) {
	if staff {
		return list[Standing](ctx, m.app.DB, `SELECT id, competition, category, bib, display_name FROM competition_entries
			WHERE competition = $1 AND status IN ('registered', 'checked_in') ORDER BY bib, id`, competition)
	}
	return list[Standing](ctx, m.app.DB, `SELECT id, competition, category, bib, display_name FROM competition_standings
		WHERE competition = $1 ORDER BY bib, id`, competition)
}

func resultsVisibility(c Competition, now time.Time) string {
	switch {
	case c.Status == "published":
		return "final"
	case c.Status == "draft" || !c.LiveRanking:
		return "hidden"
	case c.FreezeAt != nil && !now.Before(*c.FreezeAt):
		return "frozen"
	}
	return "live"
}

type Standings struct {
	Visibility string             `json:"visibility"`
	Format     string             `json:"format"`
	Updated    time.Time          `json:"updated"`
	Categories []CategoryStanding `json:"categories"`
}

// getStandings: managers get live data with real names unless they ask for the public view (?view=public), everyone
// else the cached view resultsVisibility allows.
func (m *module) getStandings(w http.ResponseWriter, r *http.Request) error {
	ctx, id := r.Context(), r.PathValue("id")
	gym, public, err := m.competitionGym(ctx, id)
	if err != nil {
		return err
	}
	if !public {
		if err := tenancy.RequireGym(ctx, m.app.DB, gym); err != nil {
			return err
		}
	}
	if p, ok := auth.From(ctx); ok && r.URL.Query().Get("view") != "public" {
		if m.perms.Can(ctx, p.UserID, gym, permManage) {
			c, err := findCompetition(ctx, m.app.DB, id)
			if err != nil {
				return err
			}
			standings, err := m.computeStandings(ctx, c, true)
			return respond(w, http.StatusOK, standings, err)
		}
	}
	standings, err := m.publicStandings(ctx, id)
	return respond(w, http.StatusOK, standings, err)
}

func (m *module) computeStandings(ctx context.Context, c Competition, manager bool) (Standings, error) {
	out := Standings{Visibility: resultsVisibility(c, time.Now()), Format: c.ScoringFormat, Updated: time.Now().UTC(),
		Categories: []CategoryStanding{}}
	if manager && out.Visibility != "final" {
		out.Visibility = "live"
	}
	if out.Visibility == "hidden" || out.Visibility == "frozen" {
		return out, nil
	}
	categories, err := m.categories(ctx, c.ID)
	if err != nil {
		return out, err
	}
	entries, err := m.standings(ctx, c.ID, manager)
	if err != nil {
		return out, err
	}
	routes, err := list[CompRoute](ctx, m.app.DB, `SELECT `+routeColumns+` FROM competition_routes
		WHERE competition = $1 ORDER BY number, id`, c.ID)
	if err != nil {
		return out, err
	}
	scores, err := list[Score](ctx, m.app.DB, `SELECT `+scoreColumns+` FROM competition_scores
		WHERE competition = $1 ORDER BY created, id`, c.ID)
	if err != nil {
		return out, err
	}
	out.Categories = buildStandings(c, categories, entries, routes, scores)
	return out, nil
}

// Safety net for changes that reach the standings without a competition_changes event (e.g. a gym deletion).
const standingsCacheTTL = time.Minute

type cachedStandings struct {
	gym       string
	public    bool // gym_visible for guests when built; gym: events drop the entry
	standings Standings
	expires   time.Time
}

// ponytail: per-replica cache; every replica's bus sees competition_changes and drops its own copy
type standingsCache struct {
	mu          sync.Mutex
	entries     map[string]cachedStandings
	generations map[string]int
	// gym: events also outdate builds of competitions that weren't cached yet
	gymGenerations map[string]int
	builds         singleflight.Group
}

func newStandingsCache() *standingsCache {
	return &standingsCache{entries: map[string]cachedStandings{}, generations: map[string]int{}, gymGenerations: map[string]int{}}
}

func (c *standingsCache) forget(id string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, id)
	c.generations[id]++
}

func (c *standingsCache) forgetGym(gym string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.gymGenerations[gym]++
	for id, cached := range c.entries {
		if cached.gym == gym {
			delete(c.entries, id)
			c.generations[id]++
		}
	}
}

// store skips results whose build started before the latest change, so they can't outlive it.
func (c *standingsCache) gymGeneration(gym string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.gymGenerations[gym]
}

func (c *standingsCache) store(id string, generation, gymGeneration int, comp Competition, public bool, standings Standings) {
	expires := time.Now().Add(standingsCacheTTL)
	if standings.Visibility == "live" && comp.FreezeAt != nil && comp.FreezeAt.Before(expires) {
		expires = *comp.FreezeAt
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for stale, cached := range c.entries {
		if time.Now().After(cached.expires) {
			delete(c.entries, stale)
		}
	}
	if c.generations[id] == generation && c.gymGenerations[comp.Gym] == gymGeneration {
		c.entries[id] = cachedStandings{gym: comp.Gym, public: public, standings: standings, expires: expires}
	}
}

func (m *module) onCompetitionChange(e events.Event) {
	m.standingsCache.forget(strings.TrimPrefix(e.Topic, "competition_changes:"))
}

func (m *module) onGymChange(e events.Event) {
	m.standingsCache.forgetGym(strings.TrimPrefix(e.Topic, "gym:"))
}

// competitionGym answers from the standings cache when it can; public reports a gym everyone may see.
func (m *module) competitionGym(ctx context.Context, id string) (gym string, public bool, err error) {
	m.standingsCache.mu.Lock()
	cached, ok := m.standingsCache.entries[id]
	m.standingsCache.mu.Unlock()
	if ok && time.Now().Before(cached.expires) {
		return cached.gym, cached.public, nil
	}
	c, err := findCompetition(ctx, m.app.DB, id)
	return c.Gym, false, err
}

func (m *module) publicStandings(ctx context.Context, id string) (Standings, error) {
	cache := m.standingsCache
	cache.mu.Lock()
	cached, ok := cache.entries[id]
	generation := cache.generations[id]
	cache.mu.Unlock()
	if ok && time.Now().Before(cached.expires) {
		return cached.standings, nil
	}
	standings, err, _ := cache.builds.Do(id+":"+strconv.Itoa(generation), func() (any, error) {
		ctx := context.WithoutCancel(ctx)
		c, err := findCompetition(ctx, m.app.DB, id)
		if err != nil {
			return Standings{}, err
		}
		if c.Status == "draft" {
			return Standings{}, httpx.ErrNotFound
		}
		standings, err := m.computeStandings(ctx, c, false)
		if err != nil {
			return standings, err
		}
		gymGeneration := cache.gymGeneration(c.Gym)
		var public bool
		if err := m.app.DB.QueryRow(ctx, `SELECT gym_visible($1, '')`, c.Gym).Scan(&public); err != nil {
			return standings, err
		}
		cache.store(id, generation, gymGeneration, c, public, standings)
		return standings, err
	})
	return standings.(Standings), err
}
