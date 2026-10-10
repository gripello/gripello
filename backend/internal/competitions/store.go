package competitions

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
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

type Competition struct {
	ID              string          `db:"id" json:"id"`
	Created         time.Time       `db:"created" json:"created"`
	Updated         time.Time       `db:"updated" json:"updated"`
	Gym             string          `db:"gym" json:"gym"`
	Name            string          `db:"name" json:"name"`
	Description     string          `db:"description" json:"description"`
	Location        string          `db:"location" json:"location"`
	Status          string          `db:"status" json:"status"`
	StartsAt        time.Time       `db:"starts_at" json:"starts_at"`
	EndsAt          time.Time       `db:"ends_at" json:"ends_at"`
	ScoringFormat   string          `db:"scoring_format" json:"scoring_format"`
	Scoring         json.RawMessage `db:"scoring" json:"scoring"`
	LiveRanking     bool            `db:"live_ranking" json:"live_ranking"`
	FreezeMinutes   int             `db:"freeze_minutes" json:"freeze_minutes"`
	FreezeAt        *time.Time      `db:"freeze_at" json:"freeze_at"`
	Discipline      string          `db:"discipline" json:"discipline"`
	RegistrationURL string          `db:"registration_url" json:"registration_url"`
	RequiresPayment bool            `db:"requires_payment" json:"requires_payment"`
	Expand          map[string]any  `db:"-" json:"expand,omitempty"`
}

type Category struct {
	ID           string    `db:"id" json:"id"`
	Created      time.Time `db:"created" json:"created"`
	Updated      time.Time `db:"updated" json:"updated"`
	Competition  string    `db:"competition" json:"competition"`
	Name         string    `db:"name" json:"name"`
	Gender       string    `db:"gender" json:"gender"`
	MinBirthYear int       `db:"min_birth_year" json:"min_birth_year"`
	MaxBirthYear int       `db:"max_birth_year" json:"max_birth_year"`
	Sort         int       `db:"sort" json:"sort"`
}

type CompRoute struct {
	ID          string         `db:"id" json:"id"`
	Created     time.Time      `db:"created" json:"created"`
	Updated     time.Time      `db:"updated" json:"updated"`
	Competition string         `db:"competition" json:"competition"`
	Route       string         `db:"route" json:"route"`
	Number      int            `db:"number" json:"number"`
	Points      float64        `db:"points" json:"points"`
	Zone        bool           `db:"zone" json:"zone"`
	Voided      bool           `db:"voided" json:"voided"`
	HoldCount   int            `db:"hold_count" json:"hold_count"`
	Expand      map[string]any `db:"-" json:"expand,omitempty"`
}

type Entry struct {
	ID              string         `db:"id" json:"id"`
	Created         time.Time      `db:"created" json:"created"`
	Updated         time.Time      `db:"updated" json:"updated"`
	Competition     string         `db:"competition" json:"competition"`
	User            string         `db:"user" json:"user"`
	Category        string         `db:"category" json:"category"`
	Bib             int            `db:"bib" json:"bib"`
	DisplayName     string         `db:"display_name" json:"display_name"`
	BirthYear       int            `db:"birth_year" json:"birth_year"`
	Hidden          bool           `db:"hidden" json:"hidden"`
	GuardianConsent bool           `db:"guardian_consent" json:"guardian_consent"`
	Status          string         `db:"status" json:"status"`
	Paid            bool           `db:"paid" json:"paid"`
	Expand          map[string]any `db:"-" json:"expand,omitempty"`
}

type Score struct {
	ID          string    `db:"id" json:"id"`
	Created     time.Time `db:"created" json:"created"`
	Updated     time.Time `db:"updated" json:"updated"`
	Competition string    `db:"competition" json:"competition"`
	Entry       string    `db:"entry" json:"entry"`
	CompRoute   string    `db:"comp_route" json:"comp_route"`
	Attempts    int       `db:"attempts" json:"attempts"`
	ZoneAttempt int       `db:"zone_attempt" json:"zone_attempt"`
	TopAttempt  int       `db:"top_attempt" json:"top_attempt"`
	Style       string    `db:"style" json:"style"`
	Height      int       `db:"height" json:"height"`
	HeightPlus  bool      `db:"height_plus" json:"height_plus"`
	ScoredBy    string    `db:"scored_by" json:"-"`
}

type Standing struct {
	ID          string `db:"id" json:"id"`
	Competition string `db:"competition" json:"competition"`
	Category    string `db:"category" json:"category"`
	Bib         int    `db:"bib" json:"bib"`
	DisplayName string `db:"display_name" json:"display_name"`
}

type RouteSummary struct {
	ID          string         `db:"id" json:"id"`
	Name        string         `db:"name" json:"name"`
	Grade       string         `db:"grade" json:"grade"`
	GradeSystem string         `db:"grade_system" json:"grade_system"`
	Color       string         `db:"color" json:"color"`
	Type        string         `db:"type" json:"type"`
	Location    string         `db:"location" json:"location"`
	Wall        string         `db:"wall" json:"wall"`
	WallName    string         `db:"wall_name" json:"-"`
	Archived    bool           `db:"archived" json:"archived"`
	Expand      map[string]any `db:"-" json:"expand,omitempty"`
}

const (
	competitionColumns = `id, created, updated, gym, name, description, location, status, starts_at, ends_at, scoring_format,
		scoring, live_ranking, freeze_minutes, freeze_at, discipline, registration_url, requires_payment`
	categoryColumns = `id, created, updated, competition, name, gender, min_birth_year, max_birth_year, sort`
	routeColumns    = `id, created, updated, competition, route, number, points, zone, voided, hold_count`
	entryColumns    = `id, created, updated, competition, "user", category, bib, display_name, birth_year, hidden,
		guardian_consent, status, paid`
	scoreColumns = `id, created, updated, competition, entry, comp_route, attempts, zone_attempt, top_attempt, style,
		height, height_plus, scored_by`
)

func list[T any](ctx context.Context, q querier, sql string, args ...any) ([]T, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	items, err := pgx.CollectRows(rows, pgx.RowToStructByName[T])
	if items == nil {
		items = []T{}
	}
	return items, err
}

func one[T any](ctx context.Context, q querier, sql string, args ...any) (T, error) {
	items, err := list[T](ctx, q, sql, args...)
	if err != nil {
		var zero T
		return zero, err
	}
	if len(items) == 0 {
		var zero T
		return zero, httpx.ErrNotFound
	}
	return items[0], nil
}

func findCompetition(ctx context.Context, q querier, id string) (Competition, error) {
	return one[Competition](ctx, q, `SELECT `+competitionColumns+` FROM competitions WHERE id = $1`, id)
}

func findCategory(ctx context.Context, q querier, id string) (Category, error) {
	return one[Category](ctx, q, `SELECT `+categoryColumns+` FROM competition_categories WHERE id = $1`, id)
}

func findCompRoute(ctx context.Context, q querier, id string) (CompRoute, error) {
	return one[CompRoute](ctx, q, `SELECT `+routeColumns+` FROM competition_routes WHERE id = $1`, id)
}

func findEntry(ctx context.Context, q querier, id string) (Entry, error) {
	return one[Entry](ctx, q, `SELECT `+entryColumns+` FROM competition_entries WHERE id = $1`, id)
}

func findScore(ctx context.Context, q querier, id string) (Score, error) {
	return one[Score](ctx, q, `SELECT `+scoreColumns+` FROM competition_scores WHERE id = $1`, id)
}

func resolveGym(ctx context.Context, q querier, idOrSlug string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id FROM gyms WHERE id = $1 OR slug = $1 LIMIT 1`, idOrSlug).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", httpx.ErrNotFound
	}
	return id, err
}

func locationGym(ctx context.Context, q querier, id string) (string, error) {
	var gym string
	err := q.QueryRow(ctx, `SELECT gym FROM locations WHERE id = $1`, id).Scan(&gym)
	return gym, err
}

func gymSlug(ctx context.Context, q querier, id string) string {
	var slug string
	q.QueryRow(ctx, `SELECT slug FROM gyms WHERE id = $1`, id).Scan(&slug)
	return slug
}

func insertCompetition(ctx context.Context, q querier, c Competition) error {
	_, err := q.Exec(ctx, `INSERT INTO competitions (id, gym, name, description, location, status, starts_at, ends_at,
		scoring_format, scoring, live_ranking, freeze_minutes, freeze_at, discipline, registration_url, requires_payment)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
		c.ID, c.Gym, c.Name, c.Description, c.Location, c.Status, c.StartsAt, c.EndsAt, c.ScoringFormat, jsonbArg(c.Scoring),
		c.LiveRanking, c.FreezeMinutes, c.FreezeAt, c.Discipline, c.RegistrationURL, c.RequiresPayment)
	return err
}

func saveCompetition(ctx context.Context, q querier, c Competition) error {
	_, err := q.Exec(ctx, `UPDATE competitions SET name = $2, description = $3, location = $4, status = $5, starts_at = $6,
		ends_at = $7, scoring_format = $8, scoring = $9, live_ranking = $10, freeze_minutes = $11, freeze_at = $12,
		discipline = $13, registration_url = $14, requires_payment = $15, updated = now() WHERE id = $1`,
		c.ID, c.Name, c.Description, c.Location, c.Status, c.StartsAt, c.EndsAt, c.ScoringFormat, jsonbArg(c.Scoring),
		c.LiveRanking, c.FreezeMinutes, c.FreezeAt, c.Discipline, c.RegistrationURL, c.RequiresPayment)
	return err
}

func jsonbArg(raw json.RawMessage) any {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	return string(raw)
}

func saveCategory(ctx context.Context, q querier, c Category, creating bool) error {
	sql := `UPDATE competition_categories SET name = $3, gender = $4, min_birth_year = $5, max_birth_year = $6, sort = $7,
		updated = now() WHERE id = $1 AND competition = $2`
	if creating {
		sql = `INSERT INTO competition_categories (id, competition, name, gender, min_birth_year, max_birth_year, sort)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`
	}
	_, err := q.Exec(ctx, sql, c.ID, c.Competition, c.Name, c.Gender, c.MinBirthYear, c.MaxBirthYear, c.Sort)
	return err
}

func saveCompRoute(ctx context.Context, q querier, r CompRoute, creating bool) error {
	sql := `UPDATE competition_routes SET route = $3, number = $4, points = $5, zone = $6, voided = $7, hold_count = $8,
		updated = now() WHERE id = $1 AND competition = $2`
	if creating {
		sql = `INSERT INTO competition_routes (id, competition, route, number, points, zone, voided, hold_count)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`
	}
	_, err := q.Exec(ctx, sql, r.ID, r.Competition, r.Route, r.Number, r.Points, r.Zone, r.Voided, r.HoldCount)
	return err
}

func saveEntry(ctx context.Context, q querier, e Entry, creating bool) error {
	sql := `UPDATE competition_entries SET category = $4, bib = $5, display_name = $6, birth_year = $7, hidden = $8,
		guardian_consent = $9, status = $10, paid = $11, updated = now() WHERE id = $1 AND competition = $2 AND "user" = $3`
	if creating {
		sql = `INSERT INTO competition_entries (id, competition, "user", category, bib, display_name, birth_year, hidden,
			guardian_consent, status, paid) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`
	}
	_, err := q.Exec(ctx, sql, e.ID, e.Competition, e.User, e.Category, e.Bib, e.DisplayName, e.BirthYear, e.Hidden,
		e.GuardianConsent, e.Status, e.Paid)
	return err
}

// upsertScore returns ErrNotFound when a climber would overwrite a score somebody else (a judge) wrote.
func upsertScore(ctx context.Context, q querier, s Score, staff bool) (Score, error) {
	return one[Score](ctx, q, `INSERT INTO competition_scores (id, competition, entry, comp_route, attempts, zone_attempt,
		top_attempt, style, height, height_plus, scored_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (entry, comp_route) DO UPDATE SET attempts = EXCLUDED.attempts, zone_attempt = EXCLUDED.zone_attempt,
		top_attempt = EXCLUDED.top_attempt, style = EXCLUDED.style, height = EXCLUDED.height,
		height_plus = EXCLUDED.height_plus, scored_by = EXCLUDED.scored_by, updated = now()
		WHERE $12 OR competition_scores.scored_by IN ('', EXCLUDED.scored_by)
		RETURNING `+scoreColumns,
		s.ID, s.Competition, s.Entry, s.CompRoute, s.Attempts, s.ZoneAttempt, s.TopAttempt, s.Style, s.Height, s.HeightPlus,
		s.ScoredBy, staff)
}

// refuseWhileHidden keeps moderation's hide in force: only a restore brings the hidden fields back.
func refuseWhileHidden(ctx context.Context, q querier, contentType, id string) error {
	var hidden bool
	if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM moderation_items WHERE content_type = $1 AND content_id = $2
		AND state = 'hidden')`, contentType, id).Scan(&hidden); err != nil {
		return err
	}
	if hidden {
		return httpx.NewError(http.StatusForbidden, "This content was hidden by moderation.")
	}
	return nil
}

func nextBib(ctx context.Context, q querier, competition string) (int, error) {
	var bib int
	err := q.QueryRow(ctx, `SELECT COALESCE(MAX(bib), 0) + 1 FROM competition_entries WHERE competition = $1`, competition).Scan(&bib)
	return bib, err
}

func routeSummaries(ctx context.Context, q querier, ids []string) (map[string]RouteSummary, error) {
	items, err := list[RouteSummary](ctx, q, `SELECT r.id, r.name, r.grade, r.grade_system, r.color, r.type,
		COALESCE(r.location, '') AS location, COALESCE(r.wall, '') AS wall, COALESCE(w.name, '') AS wall_name, r.archived
		FROM routes r LEFT JOIN walls w ON w.id = r.wall WHERE r.id = ANY ($1)`, ids)
	out := map[string]RouteSummary{}
	for _, r := range items {
		if r.Wall != "" {
			r.Expand = map[string]any{"wall": map[string]string{"id": r.Wall, "name": r.WallName, "location": r.Location}}
		}
		out[r.ID] = r
	}
	return out, err
}

func isUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == constraint
}

// PostgreSQL 18 reports ON DELETE RESTRICT violations as restrict_violation (23001) instead of 23503.
func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && (pgErr.Code == "23503" || pgErr.Code == "23001")
}
