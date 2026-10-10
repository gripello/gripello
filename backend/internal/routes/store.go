package routes

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"gripello/internal/platform/httpx"
)

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

type Route struct {
	ID            string          `db:"id" json:"id"`
	Created       time.Time       `db:"created" json:"created"`
	Updated       time.Time       `db:"updated" json:"updated"`
	Gym           string          `db:"gym" json:"gym"`
	Name          string          `db:"name" json:"name"`
	AnchorPoint   int             `db:"anchor_point" json:"anchor_point"`
	Type          string          `db:"type" json:"type"`
	Comment       string          `db:"comment" json:"comment"`
	Creator       json.RawMessage `db:"creator" json:"creator"`
	Archived      bool            `db:"archived" json:"archived"`
	ArchivedAt    *time.Time      `db:"archived_at" json:"archived_at"`
	Color         string          `db:"color" json:"color"`
	ScrewDate     *time.Time      `db:"screw_date" json:"screw_date"`
	Location      string          `db:"location" json:"location"`
	Wall          string          `db:"wall" json:"wall"`
	WallPosition  float64         `db:"wall_position" json:"wall_position"`
	Grade         string          `db:"grade" json:"grade"`
	GradeSystem   string          `db:"grade_system" json:"grade_system"`
	GradeIndex    float64         `db:"grade_index" json:"grade_index"`
	Permanent     bool            `db:"permanent" json:"permanent"`
	AverageRating *float64        `db:"average_rating" json:"average_rating"`
	RatingsCount  int             `db:"ratings_count" json:"ratings_count"`
	Expand        map[string]any  `db:"-" json:"expand,omitempty"`
}

type Location struct {
	ID       string          `db:"id" json:"id"`
	Created  time.Time       `db:"created" json:"created"`
	Updated  time.Time       `db:"updated" json:"updated"`
	Gym      string          `db:"gym" json:"gym"`
	Name     string          `db:"name" json:"name"`
	MapArea  json.RawMessage `db:"map_area" json:"map_area"`
	Map      json.RawMessage `db:"map" json:"map"`
	MapTrace string          `db:"map_trace" json:"map_trace"`
}

type Wall struct {
	ID         string          `db:"id" json:"id"`
	Created    time.Time       `db:"created" json:"created"`
	Updated    time.Time       `db:"updated" json:"updated"`
	Gym        string          `db:"gym" json:"gym"`
	Location   string          `db:"location" json:"location"`
	Name       string          `db:"name" json:"name"`
	Outline    json.RawMessage `db:"outline" json:"outline"`
	Edge       json.RawMessage `db:"edge" json:"edge"`
	Label      json.RawMessage `db:"label" json:"label"`
	Sort       int             `db:"sort" json:"sort"`
	AnchorFrom int             `db:"anchor_from" json:"anchor_from"`
	AnchorTo   int             `db:"anchor_to" json:"anchor_to"`
}

type GymRef struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
}

const routeColumns = `id, created, updated, gym, name, anchor_point, type, comment, creator, archived, archived_at, color,
	screw_date, COALESCE(location, '') AS location, COALESCE(wall, '') AS wall, wall_position, grade, grade_system,
	grade_index, permanent, average_rating, ratings_count`

const locationColumns = `id, created, updated, gym, name, map_area, map, map_trace`

const wallColumns = `id, created, updated, gym, location, name, outline, edge, label, sort, anchor_from, anchor_to`

// conditions builds a WHERE clause; each clause uses "?" for its single argument.
type conditions struct {
	clauses []string
	args    []any
}

func (c *conditions) add(clause string, arg any) {
	c.args = append(c.args, arg)
	c.clauses = append(c.clauses, strings.Replace(clause, "?", "$"+strconv.Itoa(len(c.args)), -1))
}

func (c *conditions) sql() string {
	if len(c.clauses) == 0 {
		return ""
	}
	return " WHERE " + strings.Join(c.clauses, " AND ")
}

func (c *conditions) next(arg any) string {
	c.args = append(c.args, arg)
	return "$" + strconv.Itoa(len(c.args))
}

func queryRoutes(ctx context.Context, q querier, where *conditions, tail string) ([]Route, error) {
	rows, err := q.Query(ctx, `SELECT `+routeColumns+` FROM average_rating`+where.sql()+tail, where.args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Route])
}

func findRoute(ctx context.Context, q querier, id string) (Route, error) {
	where := &conditions{}
	where.add("id = ?", id)
	return one(queryRoutes(ctx, q, where, ""))
}

func countRoutes(ctx context.Context, q querier, where *conditions) (int, error) {
	var total int
	err := q.QueryRow(ctx, `SELECT COUNT(*) FROM routes`+where.sql(), where.args...).Scan(&total)
	return total, err
}

func queryLocations(ctx context.Context, q querier, where *conditions) ([]Location, error) {
	rows, err := q.Query(ctx, `SELECT `+locationColumns+` FROM locations`+where.sql()+` ORDER BY name, id`, where.args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Location])
}

func findLocation(ctx context.Context, q querier, id string) (Location, error) {
	where := &conditions{}
	where.add("id = ?", id)
	return one(queryLocations(ctx, q, where))
}

func queryWalls(ctx context.Context, q querier, where *conditions) ([]Wall, error) {
	rows, err := q.Query(ctx, `SELECT `+wallColumns+` FROM walls`+where.sql()+` ORDER BY sort, name, id`, where.args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Wall])
}

func findWall(ctx context.Context, q querier, id string) (Wall, error) {
	where := &conditions{}
	where.add("id = ?", id)
	return one(queryWalls(ctx, q, where))
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

func resolveGym(ctx context.Context, q querier, idOrSlug string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id FROM gyms WHERE id = $1 OR slug = $1 LIMIT 1`, idOrSlug).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", httpx.ErrNotFound
	}
	return id, err
}

func gymRefs(ctx context.Context, q querier, ids []string) (map[string]GymRef, error) {
	rows, err := q.Query(ctx, `SELECT id, slug, name FROM gyms WHERE id = ANY ($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]GymRef{}
	for rows.Next() {
		var g GymRef
		if err := rows.Scan(&g.ID, &g.Slug, &g.Name); err != nil {
			return nil, err
		}
		out[g.ID] = g
	}
	return out, rows.Err()
}

func insertRoute(ctx context.Context, q querier, id, gym string, r routeInput) error {
	_, err := q.Exec(ctx, `INSERT INTO routes (id, gym, name, anchor_point, type, comment, creator, archived, archived_at, color,
		screw_date, location, wall, wall_position, grade, grade_system, grade_index, permanent)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8 THEN now() END, $9, $10, NULLIF($11, ''), NULLIF($12, ''), $13, $14, $15, $16, $17)`,
		id, gym, r.Name, r.AnchorPoint, r.Type, r.Comment, r.Creator, r.Archived, r.Color, r.ScrewDate, r.Location, r.Wall,
		r.WallPosition, r.Grade, r.GradeSystem, r.GradeIndex, r.Permanent)
	return err
}

func updateRoute(ctx context.Context, q querier, id string, r routeInput) error {
	_, err := q.Exec(ctx, `UPDATE routes SET name = $2, anchor_point = $3, type = $4, comment = $5, creator = $6,
		archived_at = `+archivedAtSQL("$7")+`, archived = $7, color = $8, screw_date = $9, location = NULLIF($10, ''),
		wall = NULLIF($11, ''), wall_position = $12, grade = $13, grade_system = $14, grade_index = $15, permanent = $16,
		updated = now() WHERE id = $1`,
		id, r.Name, r.AnchorPoint, r.Type, r.Comment, r.Creator, r.Archived, r.Color, r.ScrewDate, r.Location, r.Wall,
		r.WallPosition, r.Grade, r.GradeSystem, r.GradeIndex, r.Permanent)
	return err
}

// archivedAtSQL stamps archiving, keeps an existing stamp while archived and clears it on restore; it reads the old row.
func archivedAtSQL(archived string) string {
	return `CASE WHEN NOT ` + archived + ` THEN NULL WHEN archived AND archived_at IS NOT NULL THEN archived_at ELSE now() END`
}

func setArchived(ctx context.Context, q querier, id string, archived bool) error {
	_, err := q.Exec(ctx, `UPDATE routes SET archived_at = `+archivedAtSQL("$2")+`, archived = $2, updated = now() WHERE id = $1`, id, archived)
	return err
}

func insertLocation(ctx context.Context, q querier, id, gym string, l locationInput) error {
	_, err := q.Exec(ctx, `INSERT INTO locations (id, gym, name, map_area, map) VALUES ($1, $2, $3, $4, $5)`,
		id, gym, l.Name, nullJSON(l.MapArea), nullJSON(l.Map))
	return err
}

func updateLocation(ctx context.Context, q querier, id string, l locationInput) error {
	_, err := q.Exec(ctx, `UPDATE locations SET name = $2, map_area = $3, map = $4, updated = now() WHERE id = $1`,
		id, l.Name, nullJSON(l.MapArea), nullJSON(l.Map))
	return err
}

func setMapTrace(ctx context.Context, q querier, id, file string) error {
	_, err := q.Exec(ctx, `UPDATE locations SET map_trace = $2, updated = now() WHERE id = $1`, id, file)
	return err
}

func insertWall(ctx context.Context, q querier, id, gym string, w wallInput) error {
	_, err := q.Exec(ctx, `INSERT INTO walls (id, gym, location, name, outline, edge, label, sort, anchor_from, anchor_to)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		id, gym, w.Location, w.Name, w.Outline, w.Edge, nullJSON(w.Label), w.Sort, w.AnchorFrom, w.AnchorTo)
	return err
}

func updateWall(ctx context.Context, q querier, id string, w wallInput) error {
	_, err := q.Exec(ctx, `UPDATE walls SET location = $2, name = $3, outline = $4, edge = $5, label = $6, sort = $7,
		anchor_from = $8, anchor_to = $9, updated = now() WHERE id = $1`,
		id, w.Location, w.Name, w.Outline, w.Edge, nullJSON(w.Label), w.Sort, w.AnchorFrom, w.AnchorTo)
	return err
}

func deleteRow(ctx context.Context, q querier, table, id string) error {
	_, err := q.Exec(ctx, `DELETE FROM `+table+` WHERE id = $1`, id)
	return err
}

func count(ctx context.Context, q querier, sql string, args ...any) (int, error) {
	var n int
	err := q.QueryRow(ctx, sql, args...).Scan(&n)
	return n, err
}

func usedColors(ctx context.Context, q querier, gym string) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT color FROM used_colors WHERE gym = $1 AND color <> '' ORDER BY color`, gym)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func nullJSON(raw json.RawMessage) any {
	if isEmptyJSON(raw) {
		return nil
	}
	return raw
}

// uniqueViolation turns a unique index hit on name into the field error PocketBase used.
func uniqueViolation(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return httpx.NewError(400, "Failed to save record.").Field("name", "validation_not_unique", "Value must be unique.")
	}
	return err
}

func parseTime(value string) (*time.Time, bool) {
	if value == "" {
		return nil, true
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05.000Z07:00", "2006-01-02 15:04:05Z07:00", "2006-01-02 15:04:05.000Z", "2006-01-02 15:04:05Z", "2006-01-02"} {
		if t, err := time.Parse(layout, value); err == nil {
			return &t, true
		}
	}
	return nil, false
}

type WallWithLocation struct {
	Wall
	LocationName string `db:"location_name" json:"location_name"`
}

func wallsWithLocation(ctx context.Context, q querier, wallIDs []string) ([]WallWithLocation, error) {
	rows, err := q.Query(ctx, `SELECT w.id, w.created, w.updated, w.gym, w.location, w.name, w.outline, w.edge, w.label,
		w.sort, w.anchor_from, w.anchor_to, l.name AS location_name
		FROM walls w JOIN locations l ON l.id = w.location WHERE w.id = ANY ($1) ORDER BY l.name, w.sort, w.name, w.id`, wallIDs)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[WallWithLocation])
}
