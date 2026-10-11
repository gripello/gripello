package gyms

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
)

const settingsID = "platformsetting"

type queryer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type gymState struct {
	ID            string
	Slug          string
	Name          string
	Active        bool
	Features      map[string]any
	PreviousSlugs []string
	Files         map[string]string
}

type seededRole struct {
	name        string
	description string
	color       string
	permissions []string
}

// admin gets every permission (nil); the routesetter list is fixed.
var seededGymRoles = []seededRole{
	{name: "admin", description: "Full access", color: "#7C4DFF"},
	{
		name:        "routesetter",
		description: "Can manage routes, comments, and inventory",
		color:       "#26A69A",
		permissions: []string{"manage_routes", "view_analytics", "manage_comments", "run_inventory", "manage_tasks", "manage_competitions", "judge_competitions"},
	},
}

// Children first where a foreign key restricts the delete (entries → categories, walls/routes/competitions → locations, memberships → roles).
var gymDeletionOrder = []string{
	"DELETE FROM competition_entries WHERE competition IN (SELECT id FROM competitions WHERE gym = $1)",
	"DELETE FROM competitions WHERE gym = $1",
	"DELETE FROM seasons WHERE gym = $1",
	"DELETE FROM tasks WHERE gym = $1",
	"DELETE FROM reports WHERE gym = $1",
	"DELETE FROM beta_videos WHERE gym = $1",
	"DELETE FROM ratings WHERE gym = $1",
	"DELETE FROM routes WHERE gym = $1",
	"DELETE FROM walls WHERE gym = $1",
	"DELETE FROM locations WHERE gym = $1",
	"DELETE FROM invites WHERE gym = $1",
	"DELETE FROM memberships WHERE gym = $1",
	"DELETE FROM roles WHERE gym = $1",
	"DELETE FROM gyms WHERE id = $1",
}

func loadGym(ctx context.Context, q queryer, id string) (*gymState, error) {
	g := gymState{Files: map[string]string{}}
	var logo, icon, sign, cover string
	err := q.QueryRow(ctx, `SELECT id, slug, name, active, features, previous_slugs, page_logo, page_icon, sign_image, cover_image
		FROM gyms WHERE id = $1`, id).
		Scan(&g.ID, &g.Slug, &g.Name, &g.Active, &g.Features, &g.PreviousSlugs, &logo, &icon, &sign, &cover)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	g.Files["page_logo"], g.Files["page_icon"], g.Files["sign_image"], g.Files["cover_image"] = logo, icon, sign, cover
	if g.PreviousSlugs == nil {
		g.PreviousSlugs = []string{}
	}
	return &g, nil
}

type foundGym struct {
	ID     string
	Active bool
	JSON   json.RawMessage
}

// findGym resolves a slug, a previous slug (answer carries redirect_to) or an id.
func findGym(ctx context.Context, q queryer, key string) (*foundGym, error) {
	var g foundGym
	err := q.QueryRow(ctx, `SELECT id, active, to_jsonb(g) || CASE WHEN slug <> $1 AND id <> $1
			THEN jsonb_build_object('redirect_to', slug) ELSE '{}'::jsonb END
		FROM gyms g WHERE slug = $1 OR id = $1 OR previous_slugs ? $1
		ORDER BY (slug = $1) DESC, (id = $1) DESC LIMIT 1`, key).Scan(&g.ID, &g.Active, &g.JSON)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.ErrNotFound
	}
	return &g, err
}

func listGyms(ctx context.Context, q queryer, includeInactive bool) (json.RawMessage, error) {
	var items json.RawMessage
	err := q.QueryRow(ctx, `SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY g.name), '[]') FROM gyms g WHERE active OR $1`,
		includeInactive).Scan(&items)
	return items, err
}

func gymJSON(ctx context.Context, q queryer, id string) (json.RawMessage, error) {
	var out json.RawMessage
	err := q.QueryRow(ctx, `SELECT to_jsonb(g) FROM gyms g WHERE id = $1`, id).Scan(&out)
	return out, err
}

func slugTaken(ctx context.Context, q queryer, gymID, slug string) (bool, error) {
	var taken bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM gyms WHERE id <> $1 AND (slug = $2 OR previous_slugs ? $2))
		OR EXISTS (SELECT 1 FROM retired_slugs WHERE slug = $2)`, gymID, slug).Scan(&taken)
	return taken, err
}

// Create returns the gym with that slug, creating it with its seeded roles first (`gripello admin create-gym`).
func Create(ctx context.Context, db interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}, slug, name string) (id string, err error) {
	err = pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `SELECT id FROM gyms WHERE slug = $1`, slug).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			id = ids.New()
			err = insertGym(ctx, tx, id, slug, name)
		}
		if err != nil {
			return err
		}
		return seedRoles(ctx, tx, id)
	})
	return id, err
}

func insertGym(ctx context.Context, q queryer, id, slug, name string) error {
	_, err := q.Exec(ctx, `INSERT INTO gyms (id, slug, name) VALUES ($1, $2, $3)`, id, slug, name)
	return err
}

// updateRow writes changes whose keys come from a field whitelist, never from the request directly.
func updateRow(ctx context.Context, q queryer, table, id string, changes map[string]any) error {
	if len(changes) == 0 {
		return nil
	}
	columns := make([]string, 0, len(changes))
	for column := range changes {
		columns = append(columns, column)
	}
	slices.Sort(columns)
	sets := make([]string, len(columns))
	args := []any{id}
	for i, column := range columns {
		args = append(args, changes[column])
		sets[i] = pgx.Identifier{column}.Sanitize() + " = $" + strconv.Itoa(len(args))
	}
	_, err := q.Exec(ctx, "UPDATE "+table+" SET "+strings.Join(sets, ", ")+" WHERE id = $1", args...)
	return err
}

func seedRoles(ctx context.Context, q queryer, gymID string) error {
	for _, role := range seededGymRoles {
		_, err := q.Exec(ctx, `INSERT INTO roles (id, gym, name, description, color, permissions)
			VALUES ($1, $2, $3, $4, $5, ARRAY(SELECT name FROM permissions WHERE $6::text[] IS NULL OR name = ANY ($6) ORDER BY name))
			ON CONFLICT (gym, name) DO NOTHING`, ids.New(), gymID, role.name, role.description, role.color, role.permissions)
		if err != nil {
			return err
		}
	}
	return nil
}

// gymBlobDirs lists the file directories of everything deleteGym removes; user-owned dirs (avatars) stay.
func gymBlobDirs(ctx context.Context, q pgx.Tx, gymID string) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT 'gyms/' || $1::text
		UNION ALL SELECT 'beta_videos/' || id FROM beta_videos WHERE gym = $1 AND file <> ''
		UNION ALL SELECT 'tasks/' || id FROM tasks WHERE gym = $1 AND photo <> ''
		UNION ALL SELECT 'moderation_items/' || id FROM moderation_items WHERE gym = $1 AND cardinality(files) > 0
		UNION ALL SELECT 'locations/' || id FROM locations WHERE gym = $1`, gymID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func deleteGym(ctx context.Context, q queryer, gym *gymState) error {
	for _, statement := range gymDeletionOrder {
		if _, err := q.Exec(ctx, statement, gym.ID); err != nil {
			return err
		}
	}
	for _, slug := range append([]string{gym.Slug}, gym.PreviousSlugs...) {
		if slug == "" {
			continue
		}
		if _, err := q.Exec(ctx, `INSERT INTO retired_slugs (id, slug, gym_name) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING`,
			ids.New(), slug, gym.Name); err != nil {
			return err
		}
	}
	return nil
}

func settingsJSON(ctx context.Context, q queryer) (json.RawMessage, error) {
	if _, err := q.Exec(ctx, `INSERT INTO settings (id) VALUES ($1) ON CONFLICT DO NOTHING`, settingsID); err != nil {
		return nil, err
	}
	var out json.RawMessage
	err := q.QueryRow(ctx, `SELECT to_jsonb(s) FROM settings s WHERE id = $1`, settingsID).Scan(&out)
	return out, err
}

func listPermissions(ctx context.Context, q queryer) (json.RawMessage, error) {
	var items json.RawMessage
	err := q.QueryRow(ctx, `SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'label', label) ORDER BY name), '[]')
		FROM permissions`).Scan(&items)
	return items, err
}
