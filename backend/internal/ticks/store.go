package ticks

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"gripello/internal/platform/climbers"
	"gripello/internal/platform/httpx"
)

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

type Tick struct {
	ID          string            `db:"id" json:"id"`
	Created     time.Time         `db:"created" json:"created"`
	Updated     time.Time         `db:"updated" json:"updated"`
	User        string            `db:"user" json:"user"`
	Route       string            `db:"route" json:"route"`
	Type        string            `db:"type" json:"type"`
	Attempts    int               `db:"attempts" json:"attempts"`
	Date        time.Time         `db:"date" json:"date"`
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
	ID       string    `db:"id" json:"id"`
	Created  time.Time `db:"created" json:"created"`
	Updated  time.Time `db:"updated" json:"updated"`
	Gym      string    `db:"gym" json:"gym"`
	Name     string    `db:"name" json:"name"`
	StartsAt time.Time `db:"starts_at" json:"starts_at"`
	EndsAt   time.Time `db:"ends_at" json:"ends_at"`
}

const tickColumns = `id, created, updated, "user", COALESCE(route, '') AS route, type, attempts, date, note, grade,
	grade_system, grade_index, route_name`

const friendTickColumns = `id, created, created AS updated, "user", COALESCE(route, '') AS route, type, attempts, date,
	'' AS note, grade, grade_system, grade_index, route_name`

func queryTicks(ctx context.Context, q querier, sql string, args ...any) ([]Tick, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Tick])
}

func findOwnTick(ctx context.Context, q querier, id, user string) (Tick, error) {
	items, err := queryTicks(ctx, q, `SELECT `+tickColumns+` FROM ticks WHERE id = $1 AND "user" = $2`, id, user)
	if err != nil {
		return Tick{}, err
	}
	if len(items) == 0 {
		return Tick{}, httpx.ErrNotFound
	}
	return items[0], nil
}

func expandRoutes(ctx context.Context, q querier, items []Tick) error {
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

func findRouteSnapshot(ctx context.Context, q querier, id string) (routeSnapshot, error) {
	var r routeSnapshot
	err := q.QueryRow(ctx, `SELECT gym, name, grade, grade_system, grade_index FROM routes WHERE id = $1`, id).
		Scan(&r.Gym, &r.Name, &r.Grade, &r.GradeSystem, &r.GradeIndex)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, httpx.ErrNotFound
	}
	return r, err
}

func routeGym(ctx context.Context, q querier, route string) string {
	var gym string
	if route != "" {
		q.QueryRow(ctx, `SELECT gym FROM routes WHERE id = $1`, route).Scan(&gym)
	}
	return gym
}

func ticksPrivate(ctx context.Context, q querier, user string) (bool, error) {
	var private bool
	err := q.QueryRow(ctx, `SELECT ticks_private FROM users WHERE id = $1`, user).Scan(&private)
	return private, err
}

func insertTick(ctx context.Context, q querier, t Tick) error {
	_, err := q.Exec(ctx, `INSERT INTO ticks (id, "user", route, type, attempts, date, note, grade, grade_system, grade_index, route_name)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		t.ID, t.User, t.Route, t.Type, t.Attempts, t.Date, t.Note, t.Grade, t.GradeSystem, t.GradeIndex, t.RouteName)
	return err
}

func updateTick(ctx context.Context, q querier, t Tick) error {
	_, err := q.Exec(ctx, `UPDATE ticks SET type = $2, attempts = $3, date = $4, note = $5, updated = now() WHERE id = $1`,
		t.ID, t.Type, t.Attempts, t.Date, t.Note)
	return err
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func resolveGym(ctx context.Context, q querier, idOrSlug string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id FROM gyms WHERE id = $1 OR slug = $1 LIMIT 1`, idOrSlug).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", httpx.ErrNotFound
	}
	return id, err
}

const seasonColumns = `id, created, updated, gym, name, starts_at, ends_at`

func querySeasons(ctx context.Context, q querier, sql string, args ...any) ([]Season, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Season])
}

func findSeason(ctx context.Context, q querier, id string) (Season, error) {
	items, err := querySeasons(ctx, q, `SELECT `+seasonColumns+` FROM seasons WHERE id = $1`, id)
	if err != nil {
		return Season{}, err
	}
	if len(items) == 0 {
		return Season{}, httpx.ErrNotFound
	}
	return items[0], nil
}

func parseTime(value string) (time.Time, bool) {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05.000Z07:00", "2006-01-02 15:04:05Z07:00", "2006-01-02 15:04:05.000Z", "2006-01-02 15:04:05Z", "2006-01-02"} {
		if t, err := time.Parse(layout, value); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}
