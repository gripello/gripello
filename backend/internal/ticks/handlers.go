package ticks

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/httpx"
)

const (
	defaultPageSize = 50
	maxPageSize     = 1000
)

type tickPage struct {
	Items []Tick `json:"items"`
	Page  int    `json:"page"`
	Limit int    `json:"limit"`
	Total *int   `json:"total,omitempty"`
}

var ownTickOrders = map[string]string{
	"": "date DESC, created DESC", "-date,-created": "date DESC, created DESC", "date": "date, created",
	"-created": "created DESC", "created": "created", "-grade_index": "grade_index DESC, date DESC", "grade_index": "grade_index, date DESC",
}

var feedOrders = map[string]string{"": "date DESC, created DESC", "-date": "date DESC, created DESC", "-created": "created DESC"}

func orderBy(r *http.Request, orders map[string]string) (string, error) {
	order, ok := orders[r.URL.Query().Get("sort")]
	if !ok {
		return "", invalid("sort", "Unknown sort.")
	}
	return " ORDER BY " + order + ", id", nil
}

// pageOf runs sql (a SELECT of tick columns) for one page; total=true adds the row count.
func (m *module) pageOf(r *http.Request, sql, order string, args ...any) (tickPage, error) {
	page, limit, tail := paging(r)
	items, err := queryTicks(r.Context(), m.app.DB, sql+order+tail, args...)
	if err != nil {
		return tickPage{}, err
	}
	result := tickPage{Items: nonNil(items), Page: page, Limit: limit}
	if r.URL.Query().Get("total") == "true" {
		var total int
		if err := m.app.DB.QueryRow(r.Context(), `SELECT COUNT(*) FROM (`+sql+`) AS page`, args...).Scan(&total); err != nil {
			return tickPage{}, err
		}
		result.Total = &total
	}
	return result, nil
}

func atoi(value string, fallback int) int {
	if n, err := strconv.Atoi(value); err == nil {
		return n
	}
	return fallback
}

func paging(r *http.Request) (page, limit int, tail string) {
	query := r.URL.Query()
	page = max(1, atoi(query.Get("page"), 1))
	limit = min(maxPageSize, max(1, atoi(query.Get("limit"), defaultPageSize)))
	return page, limit, " LIMIT " + strconv.Itoa(limit) + " OFFSET " + strconv.Itoa((page-1)*limit)
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
	if since := query.Get("since"); since != "" {
		at, ok := parseTime(since)
		if !ok {
			return invalid("since", "Invalid date.")
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
	httpx.JSON(w, http.StatusOK, result)
	return nil
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
	httpx.JSON(w, http.StatusOK, routes)
	return nil
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
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, tick)
	return nil
}

func (m *module) patchTick(w http.ResponseWriter, r *http.Request) error {
	p, err := decodePatch(r)
	if err != nil {
		return err
	}
	tick, err := m.updateTick(r.Context(), r.PathValue("id"), p)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, tick)
	return nil
}

func (m *module) deleteTickHandler(w http.ResponseWriter, r *http.Request) error {
	if err := m.deleteTick(r.Context(), r.PathValue("id")); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
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
	httpx.JSON(w, http.StatusOK, result)
	return nil
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
	var result tickPage
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
	httpx.JSON(w, http.StatusOK, result)
	return nil
}

func (m *module) getLeaderboard(w http.ResponseWriter, r *http.Request) error {
	gym, err := resolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
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
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, result)
	return nil
}

func (m *module) listSeasons(w http.ResponseWriter, r *http.Request) error {
	gym, err := resolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
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
	httpx.JSON(w, http.StatusOK, items)
	return nil
}

func (m *module) postSeason(w http.ResponseWriter, r *http.Request) error {
	gym, err := resolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	p, err := decodePatch(r)
	if err != nil {
		return err
	}
	season, err := m.createSeason(r.Context(), gym, p)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, season)
	return nil
}

func (m *module) patchSeason(w http.ResponseWriter, r *http.Request) error {
	p, err := decodePatch(r)
	if err != nil {
		return err
	}
	season, err := m.updateSeason(r.Context(), r.PathValue("id"), p)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, season)
	return nil
}

func (m *module) deleteSeasonHandler(w http.ResponseWriter, r *http.Request) error {
	if err := m.deleteSeason(r.Context(), r.PathValue("id")); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func nonNil(items []Tick) []Tick {
	if items == nil {
		return []Tick{}
	}
	return items
}
