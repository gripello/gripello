package members

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"gripello/internal/platform/ids"
)

type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type role struct {
	ID          string    `json:"id"`
	Gym         string    `json:"gym"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Permissions []string  `json:"permissions"`
	Color       string    `json:"color"`
	Created     time.Time `json:"created"`
	Updated     time.Time `json:"updated"`
}

type membership struct {
	ID   string `json:"id"`
	User string `json:"user"`
	Gym  string `json:"gym"`
	Role string `json:"role"`
}

type memberUser struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	Firstname string `json:"firstname"`
	Name      string `json:"name"`
	Avatar    string `json:"avatar"`
	Email     string `json:"email,omitempty"`
}

type member struct {
	ID      string     `json:"id"`
	Gym     string     `json:"gym"`
	User    memberUser `json:"user"`
	Role    role       `json:"role"`
	Created time.Time  `json:"created"`
	Updated time.Time  `json:"updated"`
}

type gymRef struct {
	ID     string `json:"id"`
	Slug   string `json:"slug"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
}

type ownMembership struct {
	ID      string    `json:"id"`
	Gym     gymRef    `json:"gym"`
	Role    role      `json:"role"`
	Created time.Time `json:"created"`
}

type invite struct {
	ID        string    `json:"id"`
	Gym       string    `json:"gym"`
	Role      string    `json:"role"`
	RoleName  string    `json:"role_name"`
	Email     string    `json:"email"`
	Firstname string    `json:"firstname"`
	Name      string    `json:"name"`
	ExpiresAt time.Time `json:"expires_at"`
	Created   time.Time `json:"created"`
}

const roleColumns = `r.id, r.gym, r.name, r.description, r.permissions, r.color, r.created, r.updated`

func roleFields(r *role) []any {
	return []any{&r.ID, &r.Gym, &r.Name, &r.Description, &r.Permissions, &r.Color, &r.Created, &r.Updated}
}

func findRole(ctx context.Context, q querier, id string) (role, error) {
	var r role
	err := q.QueryRow(ctx, `SELECT `+roleColumns+` FROM roles r WHERE r.id = $1`, id).Scan(roleFields(&r)...)
	return r, err
}

func memberRole(ctx context.Context, q querier, userID, gymID string) (role, bool) {
	var r role
	err := q.QueryRow(ctx, `SELECT `+roleColumns+` FROM memberships m JOIN roles r ON r.id = m.role
		WHERE m."user" = $1 AND m.gym = $2`, userID, gymID).Scan(roleFields(&r)...)
	return r, err == nil
}

func isMember(ctx context.Context, q querier, userID, gymID string) bool {
	var ok bool
	q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM memberships WHERE "user" = $1 AND gym = $2)`, userID, gymID).Scan(&ok)
	return ok
}

func findMembership(ctx context.Context, q querier, id string) (membership, error) {
	var m membership
	err := q.QueryRow(ctx, `SELECT id, "user", gym, role FROM memberships WHERE id = $1`, id).Scan(&m.ID, &m.User, &m.Gym, &m.Role)
	return m, err
}

func lockGym(ctx context.Context, q querier, gymID string) error {
	_, err := q.Exec(ctx, `SELECT 1 FROM gyms WHERE id = $1 FOR UPDATE`, gymID)
	return err
}

func lockedMembership(ctx context.Context, q querier, m membership) (membership, error) {
	if err := lockGym(ctx, q, m.Gym); err != nil {
		return m, err
	}
	locked, err := findMembership(ctx, q, m.ID)
	if err != nil {
		return m, notFound(err)
	}
	return locked, nil
}

func otherAdminCount(ctx context.Context, q querier, gymID, exceptMembershipID string) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM memberships m JOIN roles r ON r.id = m.role
		WHERE m.gym = $1 AND m.id <> $2 AND r.name = $3`, gymID, exceptMembershipID, adminRoleName).Scan(&n)
	return n, err
}

func roleMemberIDs(ctx context.Context, q querier, roleID string) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT "user" FROM memberships WHERE role = $1 ORDER BY "user"`, roleID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

type memberQuery struct {
	Search string
	Role   string
	Sort   string
	Page   int
	Limit  int
}

var memberSorts = map[string]string{
	"":         `lower(u.firstname), lower(u.name), u.username`,
	"name":     `lower(u.firstname), lower(u.name), u.username`,
	"-name":    `lower(u.firstname) DESC, lower(u.name) DESC, u.username DESC`,
	"created":  `m.created, m.id`,
	"-created": `m.created DESC, m.id`,
}

const memberFrom = ` FROM memberships m JOIN users u ON u.id = m."user" JOIN roles r ON r.id = m.role
	WHERE m.gym = $1 AND ($2 = '' OR m.role = $2)
	AND ($3 = '' OR u.username ILIKE $3 OR u.firstname ILIKE $3 OR u.name ILIKE $3 OR (u.email_visibility AND u.email ILIKE $3))`

func likePattern(search string) string {
	if search == "" {
		return ""
	}
	return "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(search) + "%"
}

func listMembers(ctx context.Context, q querier, gymID string, query memberQuery) ([]member, error) {
	sql := `SELECT m.id, m.gym, m.created, m.updated,
			u.id, u.username, u.firstname, u.name, u.avatar, CASE WHEN u.email_visibility THEN u.email ELSE '' END,
			` + roleColumns + memberFrom + ` ORDER BY ` + memberSorts[query.Sort]
	args := []any{gymID, query.Role, likePattern(query.Search)}
	if query.Limit > 0 {
		sql += ` LIMIT $4 OFFSET $5`
		args = append(args, query.Limit, (query.Page-1)*query.Limit)
	}
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (member, error) {
		var m member
		fields := append([]any{&m.ID, &m.Gym, &m.Created, &m.Updated,
			&m.User.ID, &m.User.Username, &m.User.Firstname, &m.User.Name, &m.User.Avatar, &m.User.Email}, roleFields(&m.Role)...)
		return m, row.Scan(fields...)
	})
}

func countMembers(ctx context.Context, q querier, gymID string, query memberQuery) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*)`+memberFrom, gymID, query.Role, likePattern(query.Search)).Scan(&n)
	return n, err
}

func listOwnMemberships(ctx context.Context, q querier, userID string) ([]ownMembership, error) {
	rows, err := q.Query(ctx, `SELECT m.id, m.created, g.id, g.slug, g.name, g.active, `+roleColumns+`
		FROM memberships m JOIN gyms g ON g.id = m.gym JOIN roles r ON r.id = m.role
		WHERE m."user" = $1 ORDER BY g.name`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (ownMembership, error) {
		var m ownMembership
		fields := append([]any{&m.ID, &m.Created, &m.Gym.ID, &m.Gym.Slug, &m.Gym.Name, &m.Gym.Active}, roleFields(&m.Role)...)
		return m, row.Scan(fields...)
	})
}

type listedRole struct {
	role
	Members int    `json:"members"`
	GymSlug string `json:"gym_slug,omitempty"`
	GymName string `json:"gym_name,omitempty"`
}

func listRoles(ctx context.Context, q querier, gymID, search string, limit int) ([]listedRole, error) {
	sql := `SELECT ` + roleColumns + `, (SELECT count(*) FROM memberships m WHERE m.role = r.id), g.slug, g.name
		FROM roles r JOIN gyms g ON g.id = r.gym
		WHERE ($1 = '' OR r.gym = $1) AND ($2 = '' OR r.name ILIKE $2) ORDER BY r.name, g.name`
	args := []any{gymID, likePattern(search)}
	if limit > 0 {
		sql += ` LIMIT $3`
		args = append(args, limit)
	}
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (listedRole, error) {
		var r listedRole
		err := row.Scan(append(roleFields(&r.role), &r.Members, &r.GymSlug, &r.GymName)...)
		if gymID != "" {
			r.GymSlug, r.GymName = "", ""
		}
		return r, err
	})
}

func knownPermissions(ctx context.Context, q querier, names []string) (bool, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM permissions WHERE name = ANY ($1)`, names).Scan(&n)
	return n == len(names), err
}

const inviteColumns = `i.id, i.gym, i.role, r.name, i.email, i.firstname, i.name, i.expires_at, i.created`

func inviteFields(i *invite) []any {
	return []any{&i.ID, &i.Gym, &i.Role, &i.RoleName, &i.Email, &i.Firstname, &i.Name, &i.ExpiresAt, &i.Created}
}

func listInvites(ctx context.Context, q querier, gymID string) ([]invite, error) {
	rows, err := q.Query(ctx, `SELECT `+inviteColumns+` FROM invites i JOIN roles r ON r.id = i.role
		WHERE i.gym = $1 AND i.expires_at > now() ORDER BY i.created DESC`, gymID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (invite, error) {
		var i invite
		return i, row.Scan(inviteFields(&i)...)
	})
}

func findInviteByID(ctx context.Context, q querier, id string) (invite, error) {
	var i invite
	err := q.QueryRow(ctx, `SELECT `+inviteColumns+` FROM invites i JOIN roles r ON r.id = i.role WHERE i.id = $1`, id).Scan(inviteFields(&i)...)
	return i, err
}

func findInviteByTokenHash(ctx context.Context, q querier, hash string) (invite, error) {
	var i invite
	err := q.QueryRow(ctx, `SELECT `+inviteColumns+` FROM invites i JOIN roles r ON r.id = i.role
		WHERE i.token_hash = $1 AND i.expires_at > now()`, hash).Scan(inviteFields(&i)...)
	return i, err
}

func upsertInvite(ctx context.Context, q querier, id string, i invite, tokenHash string) (string, bool, error) {
	var inserted bool
	err := q.QueryRow(ctx, `INSERT INTO invites (id, gym, role, email, firstname, name, token_hash, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (gym, email) DO UPDATE SET role = EXCLUDED.role, firstname = EXCLUDED.firstname, name = EXCLUDED.name,
			token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at
		RETURNING id, xmax = 0`, id, i.Gym, i.Role, i.Email, i.Firstname, i.Name, tokenHash, i.ExpiresAt).Scan(&id, &inserted)
	return id, inserted, err
}

func pruneExpiredInvites(ctx context.Context, q querier) error {
	_, err := q.Exec(ctx, `DELETE FROM invites WHERE expires_at < now()`)
	return err
}

func userIDByEmail(ctx context.Context, q querier, email string) (string, bool) {
	var id string
	err := q.QueryRow(ctx, `SELECT id FROM users WHERE lower(email) = lower($1) AND email <> ''`, email).Scan(&id)
	return id, err == nil
}

func userEmail(ctx context.Context, q querier, userID string) string {
	var email string
	q.QueryRow(ctx, `SELECT email FROM users WHERE id = $1`, userID).Scan(&email)
	return email
}

func gymSlug(ctx context.Context, q querier, gymID string) string {
	var slug string
	q.QueryRow(ctx, `SELECT slug FROM gyms WHERE id = $1`, gymID).Scan(&slug)
	return slug
}

// SetMembership is the admin CLI's upsert (roleID "" removes the membership); it publishes like the API so caches and staff pages follow.
func SetMembership(ctx context.Context, db interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}, userID, gymID, roleID string) (id string, err error) {
	err = pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		var previousRole string
		previousPermissions := []string{}
		err := tx.QueryRow(ctx, `SELECT m.id, m.role, r.permissions FROM memberships m JOIN roles r ON r.id = m.role
			WHERE m."user" = $1 AND m.gym = $2`, userID, gymID).Scan(&id, &previousRole, &previousPermissions)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if roleID == "" {
			if id == "" {
				return nil
			}
			if _, err := tx.Exec(ctx, `DELETE FROM memberships WHERE id = $1`, id); err != nil {
				return err
			}
			deleted := id
			id = ""
			return publishToGym(ctx, tx, "", gymID, KindMembershipChanged, MembershipChanged{
				Action: "deleted", ID: deleted, Gym: gymID, Users: []string{userID}, PreviousRole: previousRole,
				Added: []string{}, Removed: previousPermissions,
			}, []string{userID})
		}
		action := "updated"
		if id == "" {
			action, id = "created", ids.New()
		}
		var permissions []string
		if err := tx.QueryRow(ctx, `INSERT INTO memberships (id, "user", gym, role) VALUES ($1, $2, $3, $4)
			ON CONFLICT ("user", gym) DO UPDATE SET role = EXCLUDED.role, updated = now()
			RETURNING (SELECT permissions FROM roles WHERE id = $4)`, id, userID, gymID, roleID).Scan(&permissions); err != nil {
			return err
		}
		return publishToGym(ctx, tx, "", gymID, KindMembershipChanged, MembershipChanged{
			Action: action, ID: id, Gym: gymID, Users: []string{userID}, Role: roleID, PreviousRole: previousRole,
			Added: addedPermissions(previousPermissions, permissions), Removed: addedPermissions(permissions, previousPermissions),
		}, []string{userID})
	})
	return id, err
}
