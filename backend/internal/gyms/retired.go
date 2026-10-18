package gyms

import (
	"net/http"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
)

type retiredSlug struct {
	ID        string `json:"id"`
	Slug      string `json:"slug"`
	GymName   string `json:"gym_name"`
	RetiredAt string `json:"retired_at"`
}

func (m *module) listRetiredSlugs(w http.ResponseWriter, r *http.Request) error {
	if _, err := requirePlatformAdmin(r.Context()); err != nil {
		return err
	}
	rows, err := m.db.Query(r.Context(), `SELECT id, slug, gym_name, to_char(retired_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM retired_slugs ORDER BY retired_at DESC, slug`)
	if err != nil {
		return err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (retiredSlug, error) {
		var s retiredSlug
		return s, row.Scan(&s.ID, &s.Slug, &s.GymName, &s.RetiredAt)
	})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	return nil
}

// freeRetiredSlug lets a new gym take the slug of a deleted one.
func (m *module) freeRetiredSlug(w http.ResponseWriter, r *http.Request) error {
	p, err := requirePlatformAdmin(r.Context())
	if err != nil {
		return err
	}
	ctx := r.Context()
	err = pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		var slug string
		if err := tx.QueryRow(ctx, `DELETE FROM retired_slugs WHERE id = $1 RETURNING slug`, r.PathValue("id")).Scan(&slug); err != nil {
			if err == pgx.ErrNoRows {
				return httpx.ErrNotFound
			}
			return err
		}
		return events.PublishAs(ctx, tx, p.UserID, "platform", "retired_slug.deleted", map[string]string{"id": r.PathValue("id"), "slug": slug}, events.Audience{PlatformAdmins: true})
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
