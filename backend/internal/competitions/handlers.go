package competitions

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"gripello/internal/platform/httpx"
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
	gym, err := resolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
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
	gym, err := resolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
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
	c, err := findCompetition(r.Context(), m.app.DB, r.PathValue("id"))
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
	c, err := findCompetition(r.Context(), m.app.DB, r.PathValue("id"))
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

func (m *module) getStandings(w http.ResponseWriter, r *http.Request) error {
	c, err := findCompetition(r.Context(), m.app.DB, r.PathValue("id"))
	if err != nil {
		return err
	}
	if c.Status == "draft" {
		return httpx.ErrNotFound
	}
	items, err := m.standings(r.Context(), c.ID, false)
	if err != nil {
		return err
	}
	categories, err := m.categories(r.Context(), c.ID)
	return respond(w, http.StatusOK, map[string]any{"items": items, "categories": categories}, err)
}

type Results struct {
	Visibility  string      `json:"visibility"`
	Competition Competition `json:"competition"`
	Categories  []Category  `json:"categories"`
	Entries     []Standing  `json:"entries"`
	Routes      []CompRoute `json:"routes"`
	Scores      []Score     `json:"scores"`
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

// getResults bundles what buildStandings needs; managers always get live data, others only what resultsVisibility allows.
func (m *module) getResults(w http.ResponseWriter, r *http.Request) error {
	c, v, err := m.loadVisible(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	out := Results{Visibility: resultsVisibility(c, time.Now()), Competition: c,
		Categories: []Category{}, Entries: []Standing{}, Routes: []CompRoute{}, Scores: []Score{}}
	if v.manager && out.Visibility != "final" {
		out.Visibility = "live"
	}
	if out.Visibility == "hidden" || out.Visibility == "frozen" {
		return respond(w, http.StatusOK, out, nil)
	}
	ctx := r.Context()
	if out.Categories, err = m.categories(ctx, c.ID); err != nil {
		return err
	}
	if out.Entries, err = m.standings(ctx, c.ID, v.manager); err != nil {
		return err
	}
	if out.Routes, err = list[CompRoute](ctx, m.app.DB, `SELECT `+routeColumns+` FROM competition_routes
		WHERE competition = $1 ORDER BY number, id`, c.ID); err != nil {
		return err
	}
	out.Scores, err = list[Score](ctx, m.app.DB, `SELECT `+scoreColumns+` FROM competition_scores
		WHERE competition = $1 ORDER BY created, id`, c.ID)
	return respond(w, http.StatusOK, out, err)
}
