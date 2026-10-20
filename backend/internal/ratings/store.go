package ratings

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/climbers"
	"gripello/internal/platform/db"
)

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

func queryRatings(ctx context.Context, q db.Querier, where *db.Where, tail string) ([]Rating, error) {
	return db.List[Rating](ctx, q, `SELECT `+ratingColumns+` FROM ratings`+where.SQL()+tail, where.Args...)
}

func findRating(ctx context.Context, q db.Querier, id string) (Rating, error) {
	where := &db.Where{}
	where.Add("id = ?", id)
	return db.First(queryRatings(ctx, q, where, ""))
}

func insertRating(ctx context.Context, q db.Querier, r Rating) error {
	_, err := q.Exec(ctx, `INSERT INTO ratings (id, gym, route_id, "user", rating, comment, grade, grade_system, grade_index, created, updated)
		VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, $8, $9, $10, $10)`,
		r.ID, r.Gym, r.RouteID, r.User, r.Rating, r.Comment, r.Grade, r.GradeSystem, r.GradeIndex, r.Created)
	return err
}

func updateRating(ctx context.Context, q db.Querier, r Rating) error {
	_, err := q.Exec(ctx, `UPDATE ratings SET rating = $2, comment = $3, grade = $4, grade_system = $5, grade_index = $6, updated = now() WHERE id = $1`,
		r.ID, r.Rating, r.Comment, r.Grade, r.GradeSystem, r.GradeIndex)
	return err
}

func queryBetas(ctx context.Context, q db.Querier, where *db.Where, tail string) ([]BetaVideo, error) {
	return db.List[BetaVideo](ctx, q, `SELECT `+betaColumns+` FROM beta_videos`+where.SQL()+` ORDER BY created DESC, id`+tail, where.Args...)
}

func findBeta(ctx context.Context, q db.Querier, id string) (BetaVideo, error) {
	where := &db.Where{}
	where.Add("id = ?", id)
	return db.First(queryBetas(ctx, q, where, ""))
}

func insertBeta(ctx context.Context, q db.Querier, b BetaVideo) error {
	_, err := q.Exec(ctx, `INSERT INTO beta_videos (id, gym, route, "user", url, file) VALUES ($1, $2, $3, $4, $5, $6)`,
		b.ID, b.Gym, b.Route, b.User, b.URL, b.File)
	return err
}

func deleteRow(ctx context.Context, q db.Querier, table, id string) error {
	_, err := q.Exec(ctx, `DELETE FROM `+table+` WHERE id = $1`, id)
	return err
}

func findRoute(ctx context.Context, q db.Querier, id string) (routeRef, error) {
	var r routeRef
	err := q.QueryRow(ctx, `SELECT id, gym, archived FROM routes WHERE id = $1`, id).Scan(&r.ID, &r.Gym, &r.Archived)
	return r, db.NotFound(err)
}

func gymBetaSettings(ctx context.Context, q db.Querier, gym string) (links, uploads, premoderate bool, err error) {
	err = q.QueryRow(ctx, `SELECT COALESCE((features->>'beta_links')::boolean, false), COALESCE((features->>'beta_uploads')::boolean, false),
		premoderate_betas FROM gyms WHERE id = $1`, gym).
		Scan(&links, &uploads, &premoderate)
	return
}

func ratingStats(ctx context.Context, q db.Querier, gym string) (Stats, error) {
	var s Stats
	err := q.QueryRow(ctx, `SELECT total_reviews, avg_rating::float8, low_rated, this_week FROM ratings_stats WHERE gym = $1`, gym).
		Scan(&s.TotalReviews, &s.AvgRating, &s.LowRated, &s.ThisWeek)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, nil
	}
	return s, err
}

func anonymousAuthors(ctx context.Context, q db.Querier, ids []string) (map[string]bool, error) {
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
