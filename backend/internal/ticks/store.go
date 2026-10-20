package ticks

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/apitime"
	"gripello/internal/platform/climbers"
	"gripello/internal/platform/db"
)

type Tick struct {
	ID          string            `db:"id" json:"id"`
	Created     time.Time         `db:"created" json:"created"`
	Updated     time.Time         `db:"updated" json:"updated"`
	User        string            `db:"user" json:"user"`
	Route       string            `db:"route" json:"route"`
	Type        string            `db:"type" json:"type"`
	Attempts    int               `db:"attempts" json:"attempts"`
	Date        apitime.Date      `db:"date" json:"date"`
	Note        string            `db:"note" json:"note"`
	Grade       string            `db:"grade" json:"grade"`
	GradeSystem string            `db:"grade_system" json:"grade_system"`
	GradeIndex  float64           `db:"grade_index" json:"grade_index"`
	RouteName   string            `db:"route_name" json:"route_name"`
	Climber     *climbers.Climber `db:"-" json:"climber,omitempty"`
	Expand      *tickExpand       `db:"-" json:"expand,omitempty"`
}

type tickExpand struct {
	Route *RouteSummary `json:"route,omitempty"`
}

type RouteSummary struct {
	ID          string  `db:"id" json:"id"`
	Gym         string  `db:"gym" json:"gym"`
	Name        string  `db:"name" json:"name"`
	Type        string  `db:"type" json:"type"`
	Color       string  `db:"color" json:"color"`
	Grade       string  `db:"grade" json:"grade"`
	GradeSystem string  `db:"grade_system" json:"grade_system"`
	GradeIndex  float64 `db:"grade_index" json:"grade_index"`
	Archived    bool    `db:"archived" json:"archived"`
	Permanent   bool    `db:"permanent" json:"permanent"`
	Location    string  `db:"location" json:"location"`
	Wall        string  `db:"wall" json:"wall"`
	GymSlug     string  `db:"gym_slug" json:"-"`
	GymName     string  `db:"gym_name" json:"-"`
	Expand      struct {
		Gym GymRef `json:"gym"`
	} `db:"-" json:"expand"`
}

type GymRef struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
}

type Season struct {
	ID       string       `db:"id" json:"id"`
	Created  time.Time    `db:"created" json:"created"`
	Updated  time.Time    `db:"updated" json:"updated"`
	Gym      string       `db:"gym" json:"gym"`
	Name     string       `db:"name" json:"name"`
	StartsAt apitime.Date `db:"starts_at" json:"starts_at"`
	EndsAt   apitime.Date `db:"ends_at" json:"ends_at"`
}

const tickColumns = `id, created, updated, "user", COALESCE(route, '') AS route, type, attempts, date, note, grade,
	grade_system, grade_index, route_name`

const qualifiedTickColumns = `t.id, t.created, t.updated, t."user", COALESCE(t.route, '') AS route, t.type, t.attempts, t.date, t.note,
	t.grade, t.grade_system, t.grade_index, t.route_name`

const friendTickColumns = `id, created, created AS updated, "user", COALESCE(route, '') AS route, type, attempts, date,
	'' AS note, grade, grade_system, grade_index, route_name`

func queryTicks(ctx context.Context, q db.Querier, sql string, args ...any) ([]Tick, error) {
	return db.List[Tick](ctx, q, sql, args...)
}

func findOwnTick(ctx context.Context, q db.Querier, id, user string) (Tick, error) {
	return db.First(queryTicks(ctx, q, `SELECT `+tickColumns+` FROM ticks WHERE id = $1 AND "user" = $2`, id, user))
}

func lockOwnTick(ctx context.Context, tx pgx.Tx, id, user string) (Tick, error) {
	if _, err := tx.Exec(ctx, `SELECT 1 FROM ticks WHERE id = $1 AND "user" = $2 FOR NO KEY UPDATE`, id, user); err != nil {
		return Tick{}, err
	}
	return findOwnTick(ctx, tx, id, user)
}

func expandRoutes(ctx context.Context, q db.Querier, items []Tick) error {
	var routeIDs []string
	for _, tick := range items {
		if tick.Route != "" {
			routeIDs = append(routeIDs, tick.Route)
		}
	}
	if len(routeIDs) == 0 {
		return nil
	}
	rows, err := q.Query(ctx, `SELECT r.id, r.gym, r.name, r.type, r.color, r.grade, r.grade_system, r.grade_index, r.archived,
		r.permanent, COALESCE(r.location, '') AS location, COALESCE(r.wall, '') AS wall, g.slug AS gym_slug, g.name AS gym_name
		FROM routes r JOIN gyms g ON g.id = r.gym WHERE r.id = ANY ($1)`, routeIDs)
	if err != nil {
		return err
	}
	routes, err := pgx.CollectRows(rows, pgx.RowToStructByName[RouteSummary])
	if err != nil {
		return err
	}
	byID := map[string]*RouteSummary{}
	for i := range routes {
		routes[i].Expand.Gym = GymRef{ID: routes[i].Gym, Slug: routes[i].GymSlug, Name: routes[i].GymName}
		byID[routes[i].ID] = &routes[i]
	}
	for i := range items {
		if route := byID[items[i].Route]; route != nil {
			items[i].Expand = &tickExpand{Route: route}
		}
	}
	return nil
}

type routeSnapshot struct {
	Gym         string
	Name        string
	Grade       string
	GradeSystem string
	GradeIndex  float64
}

func findRouteSnapshot(ctx context.Context, q db.Querier, id string) (routeSnapshot, error) {
	var r routeSnapshot
	err := q.QueryRow(ctx, `SELECT gym, name, grade, grade_system, grade_index FROM routes WHERE id = $1`, id).
		Scan(&r.Gym, &r.Name, &r.Grade, &r.GradeSystem, &r.GradeIndex)
	return r, db.NotFound(err)
}

func routeGym(ctx context.Context, q db.Querier, route string) string {
	var gym string
	if route != "" {
		q.QueryRow(ctx, `SELECT gym FROM routes WHERE id = $1`, route).Scan(&gym)
	}
	return gym
}

func ticksPrivate(ctx context.Context, q db.Querier, user string) (bool, error) {
	var private bool
	err := q.QueryRow(ctx, `SELECT ticks_private FROM users WHERE id = $1`, user).Scan(&private)
	return private, err
}

func insertTick(ctx context.Context, q db.Querier, t Tick) error {
	_, err := q.Exec(ctx, `INSERT INTO ticks (id, "user", route, type, attempts, date, note, grade, grade_system, grade_index, route_name)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		t.ID, t.User, t.Route, t.Type, t.Attempts, t.Date, t.Note, t.Grade, t.GradeSystem, t.GradeIndex, t.RouteName)
	return err
}

func updateTick(ctx context.Context, q db.Querier, t Tick) error {
	_, err := q.Exec(ctx, `UPDATE ticks SET type = $2, attempts = $3, date = $4, note = $5, updated = now() WHERE id = $1`,
		t.ID, t.Type, t.Attempts, t.Date, t.Note)
	return err
}

const seasonColumns = `id, created, updated, gym, name, starts_at, ends_at`

func querySeasons(ctx context.Context, q db.Querier, sql string, args ...any) ([]Season, error) {
	return db.List[Season](ctx, q, sql, args...)
}

func findSeason(ctx context.Context, q db.Querier, id string) (Season, error) {
	return db.First(querySeasons(ctx, q, `SELECT `+seasonColumns+` FROM seasons WHERE id = $1`, id))
}

// parseDay takes a YYYY-MM-DD day or an RFC 3339 timestamp, which counts as its UTC day.
func parseDay(value string) (apitime.Date, bool) {
	if day, err := apitime.ParseDate(value); err == nil {
		return day, true
	}
	if at, err := apitime.Parse(value); err == nil {
		return apitime.DateOf(at), true
	}
	return "", false
}
