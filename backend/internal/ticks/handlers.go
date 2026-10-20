package ticks

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/tenancy"
)

const (
	defaultPageSize = 50
	maxPageSize     = 1000
)

var ownTickOrders = map[string]string{
	"": "date DESC, created DESC", "-date,-created": "date DESC, created DESC", "date": "date, created",
	"-created": "created DESC", "created": "created", "-grade_index": "grade_index DESC, date DESC", "grade_index": "grade_index, date DESC",
}

var feedOrders = map[string]string{"": "date DESC, created DESC", "-date": "date DESC, created DESC", "-created": "created DESC"}

func orderBy(r *http.Request, orders map[string]string) (string, error) {
	order, ok := orders[r.URL.Query().Get("sort")]
	if !ok {
		return "", httpx.Invalid("sort", "Unknown sort.")
	}
	return " ORDER BY " + order + ", id", nil
}

// pageOf runs sql (a SELECT of tick columns) for one page; total=true adds the row count.
func (m *module) pageOf(r *http.Request, sql, order string, args ...any) (httpx.PageOf[Tick], error) {
	page := httpx.Page(r, defaultPageSize, maxPageSize)
	items, err := queryTicks(r.Context(), m.app.DB, sql+order+page.SQL(), args...)
	if err != nil {
		return httpx.PageOf[Tick]{}, err
	}
	result := httpx.PageOf[Tick]{Items: nonNil(items), Page: page.Page, Limit: page.Limit}
	if r.URL.Query().Get("total") == "true" {
		var total int
		if err := m.app.DB.QueryRow(r.Context(), `SELECT COUNT(*) FROM (`+sql+`) AS page`, args...).Scan(&total); err != nil {
			return httpx.PageOf[Tick]{}, err
		}
		result.Total = &total
	}
	return result, nil
}

func (m *module) listOwnTicks(w http.ResponseWriter, r *http.Request) error {
	principal, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	query := r.URL.Query()
	sql := `SELECT ` + tickColumns + ` FROM ticks WHERE "user" = $1`
	args := []any{principal.UserID}
	if route := query.Get("route"); route != "" {
		args = append(args, route)
		sql += ` AND route = $` + strconv.Itoa(len(args))
	}
	// The home-screen widget narrows the week's stats to one gym.
	if gym := query.Get("gym"); gym != "" {
		args = append(args, gym)
		sql += ` AND route IN (SELECT id FROM routes WHERE gym = $` + strconv.Itoa(len(args)) + `)`
	}
	if since := query.Get("since"); since != "" {
		at, ok := parseDay(since)
		if !ok {
			return httpx.Invalid("since", "Invalid date.")
		}
		args = append(args, at)
		sql += ` AND date >= $` + strconv.Itoa(len(args))
	}
	order, err := orderBy(r, ownTickOrders)
	if err != nil {
		return err
	}
	result, err := m.pageOf(r, sql, order, args...)
	if err != nil {
		return err
	}
	if err := expandRoutes(r.Context(), m.app.DB, result.Items); err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, result, nil)
}

func (m *module) listSends(w http.ResponseWriter, r *http.Request) error {
	principal, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	rows, err := m.app.DB.Query(r.Context(), `SELECT route FROM tick_sends WHERE "user" = $1`, principal.UserID)
	if err != nil {
		return err
	}
	routes := []string{}
	for rows.Next() {
		var route string
		if err := rows.Scan(&route); err != nil {
			rows.Close()
			return err
		}
		routes = append(routes, route)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, routes, nil)
}

func decodePatch(r *http.Request) (patch, error) {
	var p patch
	if err := httpx.Decode(r, &p); err != nil {
		return nil, err
	}
	return p, nil
}

func (m *module) postTick(w http.ResponseWriter, r *http.Request) error {
	p, err := decodePatch(r)
	if err != nil {
		return err
	}
	tick, err := m.createTick(r.Context(), p)
	return httpx.Respond(w, http.StatusCreated, tick, err)
}

func (m *module) patchTick(w http.ResponseWriter, r *http.Request) error {
	p, err := decodePatch(r)
	if err != nil {
		return err
	}
	tick, err := m.updateTick(r.Context(), r.PathValue("id"), p)
	return httpx.Respond(w, http.StatusOK, tick, err)
}

func (m *module) deleteTickHandler(w http.ResponseWriter, r *http.Request) error {
	return httpx.NoContent(w, m.deleteTick(r.Context(), r.PathValue("id")))
}

func (m *module) listFeed(w http.ResponseWriter, r *http.Request) error {
	principal, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	query := r.URL.Query()
	sql := `SELECT ` + friendTickColumns + ` FROM friend_ticks WHERE viewer = $1`
	args := []any{principal.UserID}
	if gym := query.Get("gym"); gym != "" {
		args = append(args, gym)
		sql += ` AND route IN (SELECT id FROM routes WHERE gym = $2)`
	}
	order, err := orderBy(r, feedOrders)
	if err != nil {
		return err
	}
	result, err := m.pageOf(r, sql, order, args...)
	if err != nil {
		return err
	}
	if err := m.withClimbersAndRoutes(r.Context(), result.Items); err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, result, nil)
}

func (m *module) withClimbersAndRoutes(ctx context.Context, items []Tick) error {
	userIDs := make([]string, len(items))
	for i, tick := range items {
		userIDs[i] = tick.User
	}
	people, err := m.climbers.Get(ctx, userIDs)
	if err != nil {
		return err
	}
	for i := range items {
		if person, ok := people[items[i].User]; ok {
			items[i].Climber = &person
		}
	}
	return expandRoutes(ctx, m.app.DB, items)
}

// Your own ticks, or a followed climber's through friend_ticks (accepted follow, ticks not private); nobody else's.
func (m *module) listClimberTicks(w http.ResponseWriter, r *http.Request) error {
	principal, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	climber := r.PathValue("id")
	const order = ` ORDER BY date DESC, created DESC, id`
	var result httpx.PageOf[Tick]
	if climber == principal.UserID {
		result, err = m.pageOf(r, `SELECT `+tickColumns+` FROM ticks WHERE "user" = $1`, order, climber)
	} else {
		result, err = m.pageOf(r, `SELECT `+friendTickColumns+` FROM friend_ticks WHERE viewer = $1 AND "user" = $2`, order, principal.UserID, climber)
	}
	if err != nil {
		return err
	}
	if err := expandRoutes(r.Context(), m.app.DB, result.Items); err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, result, nil)
}

func (m *module) getLeaderboard(w http.ResponseWriter, r *http.Request) error {
	gym, err := tenancy.ResolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	query := r.URL.Query()
	kind := query.Get("kind")
	if kind != "route" {
		kind = "boulder"
	}
	from, to := rollingLeaderboardWindow(time.Now())
	seasonID := query.Get("season")
	if seasonID != "" {
		season, err := findSeason(r.Context(), m.app.DB, seasonID)
		if err != nil || season.Gym != gym {
			return httpx.ErrNotFound
		}
		from, to = seasonWindow(season)
	}
	viewer := ""
	if principal, ok := auth.From(r.Context()); ok {
		viewer = principal.UserID
	}
	result, err := m.leaderboard(r.Context(), gym, kind, seasonID, viewer, from, to)
	return httpx.Respond(w, http.StatusOK, result, err)
}

func (m *module) listSeasons(w http.ResponseWriter, r *http.Request) error {
	gym, err := tenancy.ResolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	items, err := querySeasons(r.Context(), m.app.DB, `SELECT `+seasonColumns+` FROM seasons WHERE gym = $1 ORDER BY starts_at DESC, id`, gym)
	if err != nil {
		return err
	}
	if items == nil {
		items = []Season{}
	}
	return httpx.Respond(w, http.StatusOK, items, nil)
}

func (m *module) postSeason(w http.ResponseWriter, r *http.Request) error {
	gym, err := tenancy.ResolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	p, err := decodePatch(r)
	if err != nil {
		return err
	}
	season, err := m.createSeason(r.Context(), gym, p)
	return httpx.Respond(w, http.StatusCreated, season, err)
}

func (m *module) patchSeason(w http.ResponseWriter, r *http.Request) error {
	p, err := decodePatch(r)
	if err != nil {
		return err
	}
	season, err := m.updateSeason(r.Context(), r.PathValue("id"), p)
	return httpx.Respond(w, http.StatusOK, season, err)
}

func (m *module) deleteSeasonHandler(w http.ResponseWriter, r *http.Request) error {
	return httpx.NoContent(w, m.deleteSeason(r.Context(), r.PathValue("id")))
}

func nonNil(items []Tick) []Tick {
	if items == nil {
		return []Tick{}
	}
	return items
}
