package tenancy

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
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
