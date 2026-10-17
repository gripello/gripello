package tenancy

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/httpx"
)

// Platform admins hold these on every gym without a membership; other staff pages still need one.
var PlatformAdminGrants = []string{"manage_settings", "manage_users"}

type Permissions struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Permissions { return &Permissions{pool: pool} }

// Can is the rule `memberships_via_user.gym ?= gym && ...role.permissions.name ?= perm` as one query.
func (p *Permissions) Can(ctx context.Context, userID, gym, permission string) bool {
	var ok bool
	p.pool.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM memberships m JOIN roles r ON r.id = m.role
		WHERE m."user" = $1 AND m.gym = $2 AND $3 = ANY (r.permissions))`, userID, gym, permission).Scan(&ok)
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
		WHERE m.gym = $1 AND $2 = ANY (r.permissions)`, gym, permission)
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
	rows, err := p.pool.Query(ctx, `SELECT m.gym, r.permissions FROM memberships m JOIN roles r ON r.id = m.role WHERE m."user" = $1`, userID)
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

type Querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func Viewer(ctx context.Context) string {
	p, _ := auth.From(ctx)
	return p.UserID
}

// ResolveGym finds a gym by id or slug; gyms the caller may not see (gym_visible) answer 404.
func ResolveGym(ctx context.Context, q Querier, key string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id FROM gyms WHERE (id = $1 OR slug = $1) AND gym_visible(id, $2) LIMIT 1`, key, Viewer(ctx)).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", httpx.ErrNotFound
	}
	return id, err
}

func RequireGym(ctx context.Context, q Querier, gymID string) error {
	var ok bool
	if err := q.QueryRow(ctx, `SELECT gym_visible($1, $2)`, gymID, Viewer(ctx)).Scan(&ok); err != nil {
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
