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
