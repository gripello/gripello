package ratings

import (
	"context"
	"errors"
	"strconv"
	"strings"
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

type Rating struct {
	ID          string            `db:"id" json:"id"`
	Created     time.Time         `db:"created" json:"created"`
	Updated     time.Time         `db:"updated" json:"updated"`
	Gym         string            `db:"gym" json:"gym"`
	RouteID     string            `db:"route_id" json:"route_id"`
	User        string            `db:"user" json:"-"`
	Rating      int               `db:"rating" json:"rating"`
	Comment     string            `db:"comment" json:"comment"`
	Grade       string            `db:"grade" json:"grade"`
	GradeSystem string            `db:"grade_system" json:"grade_system"`
	GradeIndex  float64           `db:"grade_index" json:"grade_index"`
	Author      *climbers.Climber `db:"-" json:"author,omitempty"`
	Mine        *bool             `db:"-" json:"mine,omitempty"`
	Expand      map[string]any    `db:"-" json:"expand,omitempty"`
}

type BetaVideo struct {
	ID      string            `db:"id" json:"id"`
	Created time.Time         `db:"created" json:"created"`
	Updated time.Time         `db:"updated" json:"updated"`
	Gym     string            `db:"gym" json:"gym"`
	Route   string            `db:"route" json:"route"`
	User    string            `db:"user" json:"user"`
	URL     string            `db:"url" json:"url"`
	File    string            `db:"file" json:"file"`
	Author  *climbers.Climber `db:"-" json:"author,omitempty"`
	Expand  map[string]any    `db:"-" json:"expand,omitempty"`
}

type routeRef struct {
	ID       string
	Gym      string
	Archived bool
}

type Stats struct {
	TotalReviews int      `json:"total_reviews"`
	AvgRating    *float64 `json:"avg_rating"`
	LowRated     int      `json:"low_rated"`
	ThisWeek     int      `json:"this_week"`
}

const ratingColumns = `id, created, updated, gym, route_id, COALESCE("user", '') AS "user", rating, comment, grade, grade_system, grade_index`

const betaColumns = `id, created, updated, gym, route, "user", url, file`

type conditions struct {
	clauses []string
	args    []any
}

func (c *conditions) add(clause string, arg any) {
	c.args = append(c.args, arg)
	c.clauses = append(c.clauses, strings.ReplaceAll(clause, "?", "$"+strconv.Itoa(len(c.args))))
}

func (c *conditions) sql() string {
	if len(c.clauses) == 0 {
		return ""
	}
	return " WHERE " + strings.Join(c.clauses, " AND ")
}

func queryRatings(ctx context.Context, q querier, where *conditions, tail string) ([]Rating, error) {
	rows, err := q.Query(ctx, `SELECT `+ratingColumns+` FROM ratings`+where.sql()+tail, where.args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Rating])
}

func findRating(ctx context.Context, q querier, id string) (Rating, error) {
	where := &conditions{}
	where.add("id = ?", id)
	return one(queryRatings(ctx, q, where, ""))
}

func insertRating(ctx context.Context, q querier, r Rating) error {
	_, err := q.Exec(ctx, `INSERT INTO ratings (id, gym, route_id, "user", rating, comment, grade, grade_system, grade_index, created, updated)
		VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, $8, $9, $10, $10)`,
		r.ID, r.Gym, r.RouteID, r.User, r.Rating, r.Comment, r.Grade, r.GradeSystem, r.GradeIndex, r.Created)
	return err
}

func updateRating(ctx context.Context, q querier, r Rating) error {
	_, err := q.Exec(ctx, `UPDATE ratings SET rating = $2, comment = $3, grade = $4, grade_system = $5, grade_index = $6, updated = now() WHERE id = $1`,
		r.ID, r.Rating, r.Comment, r.Grade, r.GradeSystem, r.GradeIndex)
	return err
}

func queryBetas(ctx context.Context, q querier, where *conditions, tail string) ([]BetaVideo, error) {
	rows, err := q.Query(ctx, `SELECT `+betaColumns+` FROM beta_videos`+where.sql()+` ORDER BY created DESC, id`+tail, where.args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[BetaVideo])
}

func findBeta(ctx context.Context, q querier, id string) (BetaVideo, error) {
	where := &conditions{}
	where.add("id = ?", id)
	return one(queryBetas(ctx, q, where, ""))
}

func insertBeta(ctx context.Context, q querier, b BetaVideo) error {
	_, err := q.Exec(ctx, `INSERT INTO beta_videos (id, gym, route, "user", url, file) VALUES ($1, $2, $3, $4, $5, $6)`,
		b.ID, b.Gym, b.Route, b.User, b.URL, b.File)
	return err
}

func deleteRow(ctx context.Context, q querier, table, id string) error {
	_, err := q.Exec(ctx, `DELETE FROM `+table+` WHERE id = $1`, id)
	return err
}

func findRoute(ctx context.Context, q querier, id string) (routeRef, error) {
	var r routeRef
	err := q.QueryRow(ctx, `SELECT id, gym, archived FROM routes WHERE id = $1`, id).Scan(&r.ID, &r.Gym, &r.Archived)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, httpx.ErrNotFound
	}
	return r, err
}

func resolveGym(ctx context.Context, q querier, idOrSlug string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id FROM gyms WHERE id = $1 OR slug = $1 LIMIT 1`, idOrSlug).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", httpx.ErrNotFound
	}
	return id, err
}

func gymBetaSettings(ctx context.Context, q querier, gym string) (enabled, premoderate bool, err error) {
	err = q.QueryRow(ctx, `SELECT COALESCE((features->>'beta_videos')::boolean, false), premoderate_betas FROM gyms WHERE id = $1`, gym).
		Scan(&enabled, &premoderate)
	return
}

func ratingStats(ctx context.Context, q querier, gym string) (Stats, error) {
	var s Stats
	err := q.QueryRow(ctx, `SELECT total_reviews, avg_rating::float8, low_rated, this_week FROM ratings_stats WHERE gym = $1`, gym).
		Scan(&s.TotalReviews, &s.AvgRating, &s.LowRated, &s.ThisWeek)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, nil
	}
	return s, err
}

func anonymousAuthors(ctx context.Context, q querier, ids []string) (map[string]bool, error) {
	rows, err := q.Query(ctx, `SELECT id FROM users WHERE id = ANY ($1) AND reviews_anonymous`, ids)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, pgx.RowTo[string])
	out := map[string]bool{}
	for _, id := range list {
		out[id] = true
	}
	return out, err
}

func one[T any](items []T, err error) (T, error) {
	var zero T
	if err != nil {
		return zero, err
	}
	if len(items) == 0 {
		return zero, httpx.ErrNotFound
	}
	return items[0], nil
}
