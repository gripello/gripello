package routes

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"gripello/internal/platform/apitime"
	"gripello/internal/platform/db"
	"gripello/internal/platform/httpx"
)

type Route struct {
	ID                string          `db:"id" json:"id"`
	Created           time.Time       `db:"created" json:"created"`
	Updated           time.Time       `db:"updated" json:"updated"`
	Gym               string          `db:"gym" json:"gym"`
	Name              string          `db:"name" json:"name"`
	AnchorPoint       int             `db:"anchor_point" json:"anchor_point"`
	Type              string          `db:"type" json:"type"`
	Comment           string          `db:"comment" json:"comment"`
	Creator           json.RawMessage `db:"creator" json:"creator"`
	Archived          bool            `db:"archived" json:"archived"`
	ArchivedAt        *time.Time      `db:"archived_at" json:"archived_at"`
	Color             string          `db:"color" json:"color"`
	ScrewDate         *apitime.Date   `db:"screw_date" json:"screw_date"`
	Location          string          `db:"location" json:"location"`
	Wall              string          `db:"wall" json:"wall"`
	WallPosition      float64         `db:"wall_position" json:"wall_position"`
	Grade             string          `db:"grade" json:"grade"`
	GradeSystem       string          `db:"grade_system" json:"grade_system"`
	GradeIndex        float64         `db:"grade_index" json:"grade_index"`
	Permanent         bool            `db:"permanent" json:"permanent"`
	RemovalPlannedFor *string         `db:"removal_planned_for" json:"removal_planned_for"`
	AverageRating     *float64        `db:"average_rating" json:"average_rating"`
	RatingsCount      int             `db:"ratings_count" json:"ratings_count"`
	SendsCount        *int            `db:"-" json:"sends_count,omitempty"`
	Expand            map[string]any  `db:"-" json:"expand,omitempty"`
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
	grade_index, permanent, removal_planned_for::text AS removal_planned_for, average_rating, ratings_count`

const locationColumns = `id, created, updated, gym, name, map_area, map, map_trace`

const wallColumns = `id, created, updated, gym, location, name, outline, edge, label, sort, anchor_from, anchor_to`

// db.Where builds a WHERE clause; each clause uses "?" for its single argument.
func queryRoutes(ctx context.Context, q db.Querier, where *db.Where, tail string) ([]Route, error) {
	return db.List[Route](ctx, q, `SELECT `+routeColumns+` FROM average_rating`+where.SQL()+tail, where.Args...)
}

func findRoute(ctx context.Context, q db.Querier, id string) (Route, error) {
	where := &db.Where{}
	where.Add("id = ?", id)
	return db.First(queryRoutes(ctx, q, where, ""))
}

// FOR NO KEY UPDATE lets ticks and ratings of the edited route insert; deletes take FOR UPDATE to hold them back.
func lockRoute(ctx context.Context, tx pgx.Tx, id string) (Route, error) {
	if _, err := tx.Exec(ctx, `SELECT 1 FROM routes WHERE id = $1 FOR NO KEY UPDATE`, id); err != nil {
		return Route{}, err
	}
	return findRoute(ctx, tx, id)
}

// lockRoutes takes the row locks in id order, so batches over the same routes queue instead of deadlocking.
func lockRoutes(ctx context.Context, tx pgx.Tx, ids []string) error {
	_, err := tx.Exec(ctx, `SELECT 1 FROM routes WHERE id = ANY($1) ORDER BY id FOR NO KEY UPDATE`, ids)
	return err
}

func lockLocation(ctx context.Context, tx pgx.Tx, id string) (Location, error) {
	if _, err := tx.Exec(ctx, `SELECT 1 FROM locations WHERE id = $1 FOR NO KEY UPDATE`, id); err != nil {
		return Location{}, err
	}
	return findLocation(ctx, tx, id)
}

// A wall's routes go before the wall, in id order like batch route edits, so a move or delete can't deadlock with them.
func lockWallRoutes(ctx context.Context, tx pgx.Tx, wall string) error {
	_, err := tx.Exec(ctx, `SELECT 1 FROM routes WHERE wall = $1 ORDER BY id FOR NO KEY UPDATE`, wall)
	return err
}

func lockWall(ctx context.Context, tx pgx.Tx, id string) (Wall, error) {
	if _, err := tx.Exec(ctx, `SELECT 1 FROM walls WHERE id = $1 FOR NO KEY UPDATE`, id); err != nil {
		return Wall{}, err
	}
	return findWall(ctx, tx, id)
}

func countRoutes(ctx context.Context, q db.Querier, where *db.Where) (int, error) {
	var total int
	err := q.QueryRow(ctx, `SELECT COUNT(*) FROM routes`+where.SQL(), where.Args...).Scan(&total)
	return total, err
}

func queryLocations(ctx context.Context, q db.Querier, where *db.Where) ([]Location, error) {
	return db.List[Location](ctx, q, `SELECT `+locationColumns+` FROM locations`+where.SQL()+` ORDER BY name, id`, where.Args...)
}

func findLocation(ctx context.Context, q db.Querier, id string) (Location, error) {
	where := &db.Where{}
	where.Add("id = ?", id)
	return db.First(queryLocations(ctx, q, where))
}

func queryWalls(ctx context.Context, q db.Querier, where *db.Where) ([]Wall, error) {
	return db.List[Wall](ctx, q, `SELECT `+wallColumns+` FROM walls`+where.SQL()+` ORDER BY sort, name, id`, where.Args...)
}

func findWall(ctx context.Context, q db.Querier, id string) (Wall, error) {
	where := &db.Where{}
	where.Add("id = ?", id)
	return db.First(queryWalls(ctx, q, where))
}

func gymRefs(ctx context.Context, q db.Querier, ids []string) (map[string]GymRef, error) {
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

func insertRoute(ctx context.Context, q db.Querier, id, gym string, r routeInput) error {
	_, err := q.Exec(ctx, `INSERT INTO routes (id, gym, name, anchor_point, type, comment, creator, archived, archived_at, color,
		screw_date, location, wall, wall_position, grade, grade_system, grade_index, permanent)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8 THEN now() END, $9, $10, NULLIF($11, ''), NULLIF($12, ''), $13, $14, $15, $16, $17)`,
		id, gym, r.Name, r.AnchorPoint, r.Type, r.Comment, r.Creator, r.Archived, r.Color, r.ScrewDate, r.Location, r.Wall,
		r.WallPosition, r.Grade, r.GradeSystem, r.GradeIndex, r.Permanent)
	return err
}

func updateRoute(ctx context.Context, q db.Querier, id string, r routeInput) error {
	_, err := q.Exec(ctx, `UPDATE routes SET name = $2, anchor_point = $3, type = $4, comment = $5, creator = $6,
		archived_at = `+archivedAtSQL("$7")+`, archived = $7, color = $8, screw_date = $9, location = NULLIF($10, ''),
		wall = NULLIF($11, ''), wall_position = $12, grade = $13, grade_system = $14, grade_index = $15, permanent = $16,
		removal_planned_for = CASE WHEN $7 THEN NULL ELSE removal_planned_for END, updated = now() WHERE id = $1`,
		id, r.Name, r.AnchorPoint, r.Type, r.Comment, r.Creator, r.Archived, r.Color, r.ScrewDate, r.Location, r.Wall,
		r.WallPosition, r.Grade, r.GradeSystem, r.GradeIndex, r.Permanent)
	return err
}

// archivedAtSQL stamps archiving, keeps an existing stamp while archived and clears it on restore; it reads the old row.
func archivedAtSQL(archived string) string {
	return `CASE WHEN NOT ` + archived + ` THEN NULL WHEN archived AND archived_at IS NOT NULL THEN archived_at ELSE now() END`
}

func setArchived(ctx context.Context, q db.Querier, id string, archived bool) error {
	_, err := q.Exec(ctx, `UPDATE routes SET archived_at = `+archivedAtSQL("$2")+`, archived = $2,
		removal_planned_for = CASE WHEN $2 THEN NULL ELSE removal_planned_for END, updated = now() WHERE id = $1`, id, archived)
	return err
}

func insertLocation(ctx context.Context, q db.Querier, id, gym string, l locationInput) error {
	_, err := q.Exec(ctx, `INSERT INTO locations (id, gym, name, map_area, map) VALUES ($1, $2, $3, $4, $5)`,
		id, gym, l.Name, nullJSON(l.MapArea), nullJSON(l.Map))
	return err
}

func updateLocation(ctx context.Context, q db.Querier, id string, l locationInput) error {
	_, err := q.Exec(ctx, `UPDATE locations SET name = $2, map_area = $3, map = $4, updated = now() WHERE id = $1`,
		id, l.Name, nullJSON(l.MapArea), nullJSON(l.Map))
	return err
}

func setMapTrace(ctx context.Context, q db.Querier, id, file string) error {
	_, err := q.Exec(ctx, `UPDATE locations SET map_trace = $2, updated = now() WHERE id = $1`, id, file)
	return err
}

func insertWall(ctx context.Context, q db.Querier, id, gym string, w wallInput) error {
	_, err := q.Exec(ctx, `INSERT INTO walls (id, gym, location, name, outline, edge, label, sort, anchor_from, anchor_to)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		id, gym, w.Location, w.Name, w.Outline, w.Edge, nullJSON(w.Label), w.Sort, w.AnchorFrom, w.AnchorTo)
	return err
}

func updateWall(ctx context.Context, q db.Querier, id string, w wallInput) error {
	_, err := q.Exec(ctx, `UPDATE walls SET location = $2, name = $3, outline = $4, edge = $5, label = $6, sort = $7,
		anchor_from = $8, anchor_to = $9, updated = now() WHERE id = $1`,
		id, w.Location, w.Name, w.Outline, w.Edge, nullJSON(w.Label), w.Sort, w.AnchorFrom, w.AnchorTo)
	return err
}

func deleteRow(ctx context.Context, q db.Querier, table, id string) error {
	_, err := q.Exec(ctx, `DELETE FROM `+table+` WHERE id = $1`, id)
	return err
}

func count(ctx context.Context, q db.Querier, sql string, args ...any) (int, error) {
	var n int
	err := q.QueryRow(ctx, sql, args...).Scan(&n)
	return n, err
}

func usedColors(ctx context.Context, q db.Querier, gym string) ([]string, error) {
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

// uniqueViolation turns a unique index hit on name into a field error.
func uniqueViolation(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return httpx.BadRequest("Failed to save record.").Field("name", "validation_not_unique", "Value must be unique.")
	}
	return err
}

func parseDay(value string) (*apitime.Date, bool) {
	if value == "" {
		return nil, true
	}
	day, err := apitime.ParseDate(value)
	return &day, err == nil
}

type WallWithLocation struct {
	Wall
	LocationName string `db:"location_name" json:"location_name"`
}

func wallsWithLocation(ctx context.Context, q db.Querier, wallIDs []string, viewer string) ([]WallWithLocation, error) {
	rows, err := q.Query(ctx, `SELECT w.id, w.created, w.updated, w.gym, w.location, w.name, w.outline, w.edge, w.label,
		w.sort, w.anchor_from, w.anchor_to, l.name AS location_name
		FROM walls w JOIN locations l ON l.id = w.location WHERE w.id = ANY ($1) AND gym_visible(w.gym, $2) ORDER BY l.name, w.sort, w.name, w.id`, wallIDs, viewer)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[WallWithLocation])
}
