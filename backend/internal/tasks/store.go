package tasks

import (
	"context"
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

type Task struct {
	ID             string         `db:"id" json:"id"`
	Created        time.Time      `db:"created" json:"created"`
	Updated        time.Time      `db:"updated" json:"updated"`
	Gym            string         `db:"gym" json:"gym"`
	Kind           string         `db:"kind" json:"kind"`
	Title          string         `db:"title" json:"title"`
	Category       string         `db:"category" json:"category"`
	Priority       int            `db:"priority" json:"priority"`
	Status         string         `db:"status" json:"status"`
	Route          string         `db:"route" json:"route"`
	Wall           string         `db:"wall" json:"wall"`
	Location       string         `db:"location" json:"location"`
	Description    string         `db:"description" json:"description"`
	Photo          string         `db:"photo" json:"photo"`
	Reporter       string         `db:"reporter" json:"reporter"`
	Assignee       string         `db:"assignee" json:"assignee"`
	DueDate        *time.Time     `db:"due_date" json:"due_date"`
	ResolutionNote string         `db:"resolution_note" json:"resolution_note"`
	DoneAt         *time.Time     `db:"done_at" json:"done_at"`
	DoneBy         string         `db:"done_by" json:"done_by"`
	RouteType      string         `db:"route_type" json:"route_type"`
	Grade          string         `db:"grade" json:"grade"`
	Expand         map[string]any `db:"-" json:"expand,omitempty"`
}

type OpenDefect struct {
	ID       string    `json:"id"`
	Route    string    `json:"route"`
	Category string    `json:"category"`
	Created  time.Time `json:"created"`
}

type Assignee struct {
	ID   string `json:"id"`
	User string `json:"user"`
	Gym  string `json:"gym"`
	Name string `json:"name"`
}

type RouteSummary struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Grade       string `json:"grade"`
	GradeSystem string `json:"grade_system"`
	Color       string `json:"color"`
	Type        string `json:"type"`
	Location    string `json:"location"`
	Wall        string `json:"wall"`
	Archived    bool   `json:"archived"`
}

type WallRef struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Location string `json:"location"`
}

const taskColumns = `id, created, updated, gym, kind, title, category, priority, status, COALESCE(route, '') AS route,
	COALESCE(wall, '') AS wall, COALESCE(location, '') AS location, description, photo, COALESCE(reporter, '') AS reporter,
	COALESCE(assignee, '') AS assignee, due_date, resolution_note, done_at, COALESCE(done_by, '') AS done_by, route_type, grade`

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

func queryTasks(ctx context.Context, q querier, where *conditions, tail string) ([]Task, error) {
	rows, err := q.Query(ctx, `SELECT `+taskColumns+` FROM tasks`+where.sql()+tail, where.args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Task])
}

func countTasks(ctx context.Context, q querier, where *conditions) (int, error) {
	var total int
	err := q.QueryRow(ctx, `SELECT COUNT(*) FROM tasks`+where.sql(), where.args...).Scan(&total)
	return total, err
}

func findTask(ctx context.Context, q querier, id string) (Task, error) {
	where := &conditions{}
	where.add("id = ?", id)
	items, err := queryTasks(ctx, q, where, "")
	if err != nil {
		return Task{}, err
	}
	if len(items) == 0 {
		return Task{}, httpx.ErrNotFound
	}
	return items[0], nil
}

func insertTask(ctx context.Context, q querier, t Task) error {
	_, err := q.Exec(ctx, `INSERT INTO tasks (id, gym, kind, title, category, priority, status, route, wall, location, description,
		photo, reporter, assignee, due_date, resolution_note, done_at, done_by, route_type, grade)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''), NULLIF($9, ''), NULLIF($10, ''), $11, $12, NULLIF($13, ''),
		NULLIF($14, ''), $15, $16, $17, NULLIF($18, ''), $19, $20)`,
		t.ID, t.Gym, t.Kind, t.Title, t.Category, t.Priority, t.Status, t.Route, t.Wall, t.Location, t.Description,
		t.Photo, t.Reporter, t.Assignee, t.DueDate, t.ResolutionNote, t.DoneAt, t.DoneBy, t.RouteType, t.Grade)
	return err
}

func saveTask(ctx context.Context, q querier, t Task) error {
	_, err := q.Exec(ctx, `UPDATE tasks SET title = $2, category = $3, priority = $4, status = $5, route = NULLIF($6, ''),
		wall = NULLIF($7, ''), location = NULLIF($8, ''), description = $9, photo = $10, assignee = NULLIF($11, ''),
		due_date = $12, resolution_note = $13, done_at = $14, done_by = NULLIF($15, ''), route_type = $16, grade = $17,
		updated = now() WHERE id = $1`,
		t.ID, t.Title, t.Category, t.Priority, t.Status, t.Route, t.Wall, t.Location, t.Description, t.Photo, t.Assignee,
		t.DueDate, t.ResolutionNote, t.DoneAt, t.DoneBy, t.RouteType, t.Grade)
	return err
}

type routeTarget struct {
	Gym      string
	Location string
	Wall     string
	Name     string
	Archived bool
}

func findRouteTarget(ctx context.Context, q querier, id string) (routeTarget, error) {
	var r routeTarget
	err := q.QueryRow(ctx, `SELECT gym, COALESCE(location, ''), COALESCE(wall, ''), name, archived FROM routes WHERE id = $1`, id).
		Scan(&r.Gym, &r.Location, &r.Wall, &r.Name, &r.Archived)
	return r, err
}

func findWallTarget(ctx context.Context, q querier, id string) (gym, location string, err error) {
	err = q.QueryRow(ctx, `SELECT gym, location FROM walls WHERE id = $1`, id).Scan(&gym, &location)
	return
}

func findLocationGym(ctx context.Context, q querier, id string) (string, error) {
	var gym string
	err := q.QueryRow(ctx, `SELECT gym FROM locations WHERE id = $1`, id).Scan(&gym)
	return gym, err
}

func resolveGym(ctx context.Context, q querier, idOrSlug string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id FROM gyms WHERE id = $1 OR slug = $1 LIMIT 1`, idOrSlug).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", httpx.ErrNotFound
	}
	return id, err
}

type gymInfo struct {
	Slug, Name, Language, ContactEmail string
}

func findGym(ctx context.Context, q querier, id string) (gymInfo, error) {
	var g gymInfo
	err := q.QueryRow(ctx, `SELECT slug, name, language, contact_email FROM gyms WHERE id = $1`, id).
		Scan(&g.Slug, &g.Name, &g.Language, &g.ContactEmail)
	return g, err
}

func platformContactEmail(ctx context.Context, q querier) string {
	var email string
	q.QueryRow(ctx, `SELECT contact_email FROM settings ORDER BY id LIMIT 1`).Scan(&email)
	return email
}

const managersSQL = `SELECT DISTINCT m."user" FROM memberships m JOIN roles r ON r.id = m.role
	WHERE m.gym = $1 AND 'manage_tasks' = ANY (r.permissions)`

func taskManagers(ctx context.Context, q querier, gym string) ([]string, error) {
	rows, err := q.Query(ctx, managersSQL+` ORDER BY 1`, gym)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

type mailRecipient struct {
	ID, Email, Language string
}

func managerMailRecipients(ctx context.Context, q querier, gym string) ([]mailRecipient, error) {
	rows, err := q.Query(ctx, `SELECT id, email, language FROM users WHERE email <> '' AND id IN (`+managersSQL+`) ORDER BY id`, gym)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (mailRecipient, error) {
		var r mailRecipient
		return r, row.Scan(&r.ID, &r.Email, &r.Language)
	})
}

// refuseWhileHidden keeps moderation's hide in force: only a restore brings description and photo back.
func refuseWhileHidden(ctx context.Context, q querier, id string) error {
	var hidden bool
	if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM moderation_items WHERE content_type = 'task' AND content_id = $1
		AND state = 'hidden')`, id).Scan(&hidden); err != nil {
		return err
	}
	if hidden {
		return httpx.NewError(403, "This report was hidden by moderation.")
	}
	return nil
}

func holdsManageTasks(ctx context.Context, q querier, user, gym string) (bool, error) {
	var ok bool
	err := q.QueryRow(ctx, `SELECT EXISTS (`+managersSQL+` AND m."user" = $2)`, gym, user).Scan(&ok)
	return ok, err
}

func openDefects(ctx context.Context, q querier, gym string, routes []string) ([]OpenDefect, error) {
	sql := `SELECT id, route, category, created FROM open_route_defects WHERE gym = $1`
	args := []any{gym}
	if routes != nil {
		sql += ` AND route = ANY ($2)`
		args = append(args, routes)
	}
	rows, err := q.Query(ctx, sql+` ORDER BY created, id`, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (OpenDefect, error) {
		var d OpenDefect
		return d, row.Scan(&d.ID, &d.Route, &d.Category, &d.Created)
	})
}

func listAssignees(ctx context.Context, q querier, gym string) ([]Assignee, error) {
	rows, err := q.Query(ctx, `SELECT id, "user", gym, name FROM task_assignees WHERE gym = $1 ORDER BY name, id`, gym)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Assignee, error) {
		var a Assignee
		return a, row.Scan(&a.ID, &a.User, &a.Gym, &a.Name)
	})
}

func routeSummaries(ctx context.Context, q querier, ids []string) (map[string]RouteSummary, error) {
	rows, err := q.Query(ctx, `SELECT id, name, grade, grade_system, color, type, COALESCE(location, ''), COALESCE(wall, ''), archived
		FROM routes WHERE id = ANY ($1)`, ids)
	if err != nil {
		return nil, err
	}
	out := map[string]RouteSummary{}
	_, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (struct{}, error) {
		var r RouteSummary
		err := row.Scan(&r.ID, &r.Name, &r.Grade, &r.GradeSystem, &r.Color, &r.Type, &r.Location, &r.Wall, &r.Archived)
		out[r.ID] = r
		return struct{}{}, err
	})
	return out, err
}

func wallRefs(ctx context.Context, q querier, ids []string) (map[string]WallRef, error) {
	rows, err := q.Query(ctx, `SELECT id, name, location FROM walls WHERE id = ANY ($1)`, ids)
	if err != nil {
		return nil, err
	}
	out := map[string]WallRef{}
	_, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (struct{}, error) {
		var w WallRef
		err := row.Scan(&w.ID, &w.Name, &w.Location)
		out[w.ID] = w
		return struct{}{}, err
	})
	return out, err
}

func locationName(ctx context.Context, q querier, id string) string {
	var name string
	q.QueryRow(ctx, `SELECT name FROM locations WHERE id = $1`, id).Scan(&name)
	return name
}

func routeName(ctx context.Context, q querier, id string) string {
	var name string
	q.QueryRow(ctx, `SELECT name FROM routes WHERE id = $1`, id).Scan(&name)
	return name
}
