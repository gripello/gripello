package tenancy

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/db"
	"gripello/internal/platform/httpx"
)

const (
	PermJudgeCompetitions  = "judge_competitions"
	PermManageComments     = "manage_comments"
	PermManageCompetitions = "manage_competitions"
	PermManageReports      = "manage_reports"
	PermManageRoutes       = "manage_routes"
	PermManageSettings     = "manage_settings"
	PermManageTasks        = "manage_tasks"
	PermManageUsers        = "manage_users"
	PermRunInventory       = "run_inventory"
	PermViewAnalytics      = "view_analytics"
	PermViewAuditLog       = "view_audit_log"
)

// FeatureFlags are the keys of gyms.features, mirrored in shared/utils/featureFlags.ts.
var FeatureFlags = []string{"beta_links", "beta_uploads"}

// Platform admins hold these on every gym without a membership; other staff pages still need one.
var PlatformAdminGrants = []string{PermManageSettings, PermManageUsers}

type Permissions struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Permissions { return &Permissions{pool: pool} }

// Can reports whether the user holds perm in gym through a membership role, in one query.
func (p *Permissions) Can(ctx context.Context, userID, gym, permission string) bool {
	return p.holdsAny(ctx, userID, gym, []string{permission})
}

// Has reports whether the signed-in caller holds any of permissions in gym, counting PlatformAdminGrants.
func (p *Permissions) Has(ctx context.Context, gym string, permissions ...string) bool {
	principal, ok := auth.From(ctx)
	if !ok {
		return false
	}
	if principal.PlatformAdmin && slices.ContainsFunc(permissions, func(perm string) bool { return slices.Contains(PlatformAdminGrants, perm) }) {
		return true
	}
	return gym != "" && p.holdsAny(ctx, principal.UserID, gym, permissions)
}

// Require answers 401 for guests and 403 unless Has holds.
func (p *Permissions) Require(ctx context.Context, gym string, permissions ...string) error {
	if _, err := auth.Require(ctx); err != nil {
		return err
	}
	if !p.Has(ctx, gym, permissions...) {
		return httpx.ErrForbidden
	}
	return nil
}

func (p *Permissions) holdsAny(ctx context.Context, userID, gym string, permissions []string) bool {
	var ok bool
	p.pool.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM memberships m JOIN roles r ON r.id = m.role
		WHERE m."user" = $1 AND m.gym = $2 AND effective_permissions(m.gym, r.permissions) && $3::text[])`, userID, gym, permissions).Scan(&ok)
	return ok
}

func (p *Permissions) Follows(ctx context.Context, followerID, followeeID string) bool {
	var ok bool
	p.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM follows WHERE follower = $1 AND followee = $2 AND status = 'accepted')`,
		followerID, followeeID).Scan(&ok)
	return ok
}

// UsersWith lists everyone holding permission in gym, so one query answers a whole fan-out.
func (p *Permissions) UsersWith(ctx context.Context, gym, permission string) ([]string, error) {
	return p.userIDs(ctx, `SELECT m."user" FROM memberships m JOIN roles r ON r.id = m.role
		WHERE m.gym = $1 AND $2 = ANY (effective_permissions(m.gym, r.permissions))`, gym, permission)
}

func (p *Permissions) Followers(ctx context.Context, followeeID string) ([]string, error) {
	return p.userIDs(ctx, `SELECT follower FROM follows WHERE followee = $1 AND status = 'accepted'`, followeeID)
}

func (p *Permissions) userIDs(ctx context.Context, query string, args ...any) ([]string, error) {
	rows, err := p.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// Memberships returns gym → permission names for one user; loaded once per request by the auth middleware's callers.
func (p *Permissions) Memberships(ctx context.Context, userID string) (map[string][]string, error) {
	rows, err := p.pool.Query(ctx, `SELECT m.gym, effective_permissions(m.gym, r.permissions) FROM memberships m JOIN roles r ON r.id = m.role WHERE m."user" = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]string{}
	for rows.Next() {
		var gym string
		var perms []string
		if err := rows.Scan(&gym, &perms); err != nil {
			return nil, err
		}
		out[gym] = perms
	}
	return out, rows.Err()
}

// ResolveGym finds a gym by id, slug or previous slug; gyms the caller may not see (gym_visible) answer 404.
func ResolveGym(ctx context.Context, q db.Querier, key string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id FROM gyms WHERE (id = $1 OR id = (SELECT gym FROM gym_slugs WHERE slug = $1)) AND gym_visible(id, $2)
		ORDER BY (id = $1) DESC LIMIT 1`, key, auth.UserID(ctx)).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", httpx.ErrNotFound
	}
	return id, err
}

func RequireGym(ctx context.Context, q db.Querier, gymID string) error {
	var ok bool
	if err := q.QueryRow(ctx, `SELECT gym_visible($1, $2)`, gymID, auth.UserID(ctx)).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return httpx.ErrNotFound
	}
	return nil
}

// GymViewers answers ["*"] for a gym everyone may see, else the members allowed to see it.
func (p *Permissions) GymViewers(ctx context.Context, gym string) ([]string, error) {
	return p.userIDs(ctx, `SELECT '*' WHERE gym_visible($1, '')
		UNION ALL SELECT m."user" FROM memberships m WHERE NOT gym_visible($1, '') AND m.gym = $1 AND gym_visible($1, m."user")`, gym)
}

func GymSlug(ctx context.Context, q db.Querier, gym string) string {
	var slug string
	q.QueryRow(ctx, `SELECT slug FROM gyms WHERE id = $1`, gym).Scan(&slug)
	return slug
}

// GymPath prefixes path with the gym's slug; an unknown gym leaves path as it is.
func GymPath(ctx context.Context, q db.Querier, gym, path string) string {
	if slug := GymSlug(ctx, q, gym); slug != "" {
		return "/" + slug + path
	}
	return path
}

var ErrGymMove = httpx.BadRequest("Records cannot move to another gym.")

// RejectGymMove refuses a patch whose gym differs from the record's.
func RejectGymMove(patch map[string]json.RawMessage, current string) error {
	raw, ok := patch["gym"]
	if !ok {
		return nil
	}
	var gym string
	if json.Unmarshal(raw, &gym) != nil {
		return httpx.Invalid("gym", "Invalid value.")
	}
	if gym != current {
		return ErrGymMove
	}
	return nil
}
