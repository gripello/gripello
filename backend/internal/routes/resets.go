package routes

import (
	"context"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
)

type removalBody struct {
	IDs        []string `json:"ids"`
	PlannedFor *string  `json:"planned_for"`
}

type Notify struct {
	Type   string         `json:"type"`
	Users  []string       `json:"users"`
	Gym    string         `json:"gym"`
	Params map[string]any `json:"params"`
	URL    string         `json:"url"`
}

func (m *module) planRemovalHandler(w http.ResponseWriter, r *http.Request) error {
	gym, err := resolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	var body removalBody
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	routes, err := m.planRemoval(r.Context(), gym, body)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": routes})
	return nil
}

// planRemoval sets or clears the planned strip date of active routes; followers of a wall hear once per new date.
func (m *module) planRemoval(ctx context.Context, gym string, body removalBody) ([]Route, error) {
	if err := m.require(ctx, gym, permManageRoutes); err != nil {
		return nil, err
	}
	if body.PlannedFor != nil {
		if _, err := time.Parse(time.DateOnly, *body.PlannedFor); err != nil {
			return nil, invalid("planned_for", "Must be a date.")
		}
	}
	out := []Route{}
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		newlyPlanned := map[string]int{}
		slices.Sort(body.IDs)
		for _, id := range slices.Compact(body.IDs) {
			original, err := findRoute(ctx, tx, id)
			if err != nil || original.Gym != gym || original.Archived {
				return httpx.ErrNotFound
			}
			if _, err := tx.Exec(ctx, `UPDATE routes SET removal_planned_for = $2, updated = now() WHERE id = $1`, id, body.PlannedFor); err != nil {
				return err
			}
			route, err := m.afterRouteUpdate(ctx, tx, original)
			if err != nil {
				return err
			}
			out = append(out, route)
			if body.PlannedFor != nil && route.Wall != "" && (original.RemovalPlannedFor == nil || *original.RemovalPlannedFor != *body.PlannedFor) {
				newlyPlanned[route.Wall]++
			}
		}
		for wall, count := range newlyPlanned {
			if err := notifyWallFollowers(ctx, tx, gym, wall, *body.PlannedFor, count); err != nil {
				return err
			}
		}
		return nil
	})
	return out, err
}

func notifyWallFollowers(ctx context.Context, tx pgx.Tx, gym, wall, date string, count int) error {
	n := Notify{Type: "wall_reset_planned", Gym: gym}
	var slug, wallName string
	err := tx.QueryRow(ctx, `SELECT g.slug, w.name, ARRAY(SELECT id FROM users WHERE w.id = ANY (followed_walls))
		FROM walls w JOIN gyms g ON g.id = w.gym WHERE w.id = $1`, wall).Scan(&slug, &wallName, &n.Users)
	if err != nil || len(n.Users) == 0 {
		return err
	}
	n.Params = map[string]any{"wall": wallName, "date": date, "count": count}
	n.URL = "/" + slug + "/map?wall=" + wall
	return events.PublishAs(ctx, tx, actor(ctx), "notify", "notify", n, events.Audience{})
}

type resetStat struct {
	Route          string     `db:"route" json:"route"`
	Ticks          int        `db:"ticks" json:"ticks"`
	RecentTicks    int        `db:"recent_ticks" json:"recent_ticks"`
	Climbers       int        `db:"climbers" json:"climbers"`
	LastTick       *time.Time `db:"last_tick" json:"last_tick"`
	AverageRating  *float64   `db:"average_rating" json:"average_rating"`
	Ratings        int        `db:"ratings" json:"ratings"`
	GradeDeviation *float64   `db:"grade_deviation" json:"grade_deviation"`
	OpenDefects    int        `db:"open_defects" json:"open_defects"`
}

const recentTickWindow = 30 * day

func (m *module) resetStatsHandler(w http.ResponseWriter, r *http.Request) error {
	gym, err := resolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	if err := m.require(r.Context(), gym, permManageRoutes); err != nil {
		return err
	}
	stats, err := resetStats(r.Context(), m.app.DB, gym, r.URL.Query().Get("location"), time.Now().Add(-recentTickWindow))
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": stats})
	return nil
}

// resetStats gathers what a setter weighs before stripping a route: traffic, stars, grade feedback and open defects.
func resetStats(ctx context.Context, q querier, gym, location string, recentSince time.Time) ([]resetStat, error) {
	rows, err := q.Query(ctx, `SELECT r.id AS route,
			COALESCE(t.ticks, 0) AS ticks, COALESCE(t.recent_ticks, 0) AS recent_ticks,
			COALESCE(t.climbers, 0) AS climbers, t.last_tick,
			s.average_rating, COALESCE(s.ratings, 0) AS ratings,
			CASE WHEN r.grade_index > 0 AND s.votes >= $4 THEN s.voted_grade - r.grade_index END AS grade_deviation,
			(SELECT COUNT(*) FROM open_route_defects d WHERE d.route = r.id)::int AS open_defects
		FROM routes r
		LEFT JOIN LATERAL (SELECT COUNT(*)::int AS ticks, COUNT(*) FILTER (WHERE date >= $3)::int AS recent_ticks,
				COUNT(DISTINCT "user")::int AS climbers, MAX(date) AS last_tick
			FROM ticks WHERE route = r.id) t ON true
		LEFT JOIN LATERAL (SELECT AVG(NULLIF(rating, 0))::float8 AS average_rating, COUNT(NULLIF(rating, 0))::int AS ratings,
				AVG(grade_index) FILTER (WHERE grade_index > 0)::float8 AS voted_grade,
				COUNT(*) FILTER (WHERE grade_index > 0)::int AS votes
			FROM ratings WHERE route_id = r.id) s ON true
		WHERE r.gym = $1 AND NOT r.archived AND ($2 = '' OR r.location = $2)`, gym, location, recentSince, minVotesForFeedback)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[resetStat])
}
