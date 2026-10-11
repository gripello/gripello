package account

import (
	"context"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func userRecord(ctx context.Context, q querier, id string) (json.RawMessage, error) {
	var record json.RawMessage
	err := q.QueryRow(ctx, `SELECT to_jsonb(u) - 'password_hash' - 'token_key' FROM users u WHERE id = $1`, id).Scan(&record)
	return record, err
}

// withMemberships adds the caller's memberships (gym + role with permissions), one call for usePermissions.
func withMemberships(ctx context.Context, q querier, userID string, record json.RawMessage) (json.RawMessage, error) {
	var merged json.RawMessage
	err := q.QueryRow(ctx, `SELECT $2::jsonb || jsonb_build_object('memberships', COALESCE(jsonb_agg(jsonb_build_object(
			'id', m.id,
			'gym', jsonb_build_object('id', g.id, 'slug', g.slug, 'name', g.name, 'active', g.active),
			'role', jsonb_build_object('id', r.id, 'name', r.name, 'permissions', r.permissions)) ORDER BY g.name), '[]'))
		FROM memberships m JOIN gyms g ON g.id = m.gym JOIN roles r ON r.id = m.role WHERE m."user" = $1`, userID, record).Scan(&merged)
	return merged, err
}

func changedFields(before, after json.RawMessage) []string {
	var old, updated map[string]json.RawMessage
	json.Unmarshal(before, &old)
	json.Unmarshal(after, &updated)
	changed := []string{}
	for field, value := range updated {
		if field != "updated" && string(old[field]) != string(value) {
			changed = append(changed, field)
		}
	}
	sort.Strings(changed)
	return changed
}

// updateUser writes validated columns; names come from profileFields, never from the request.
func updateUser(ctx context.Context, q querier, id string, changes map[string]any) error {
	if len(changes) == 0 {
		return nil
	}
	columns := make([]string, 0, len(changes))
	for column := range changes {
		columns = append(columns, column)
	}
	sort.Strings(columns)
	sets := make([]string, len(columns))
	args := []any{id}
	for i, column := range columns {
		args = append(args, changes[column])
		sets[i] = column + " = $" + strconv.Itoa(len(args))
	}
	_, err := q.Exec(ctx, `UPDATE users SET `+strings.Join(sets, ", ")+` WHERE id = $1`, args...)
	return err
}

func usernameTaken(ctx context.Context, q querier, username, exceptID string) (bool, error) {
	var taken bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE lower(username) = lower($1) AND id <> $2)`, username, exceptID).Scan(&taken)
	return taken, err
}

func missingWalls(ctx context.Context, q querier, wallIDs []string) (bool, error) {
	var found int
	err := q.QueryRow(ctx, `SELECT count(*) FROM walls WHERE id = ANY ($1)`, wallIDs).Scan(&found)
	return found != len(wallIDs), err
}

// soleAdminOf lists gyms where userID holds the only admin membership.
func soleAdminOf(ctx context.Context, q querier, userID string) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT m.gym FROM memberships m JOIN roles r ON r.id = m.role
		WHERE m."user" = $1 AND r.name = 'admin'
		AND NOT EXISTS (SELECT 1 FROM memberships o JOIN roles orole ON orole.id = o.role
		                WHERE o.gym = m.gym AND o."user" <> m."user" AND orole.name = 'admin')`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func idsOf(ctx context.Context, q querier, sql string, args ...any) ([]string, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

const contributionsLimit = 200

type contributionRoute struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
	Grade string `json:"grade"`
	Gym   string `json:"gym"`
}

type contribution struct {
	ID      string             `json:"id"`
	Created string             `json:"created"`
	Rating  float64            `json:"rating,omitempty"`
	Comment string             `json:"comment,omitempty"`
	URL     string             `json:"url,omitempty"`
	File    string             `json:"file,omitempty"`
	Route   *contributionRoute `json:"route"`
}

func ownContributions(ctx context.Context, q querier, userID string) (reviews, betas []contribution, err error) {
	const route = `rt.id, COALESCE(rt.name, ''), COALESCE(rt.color, ''), COALESCE(rt.grade, ''), COALESCE(rt.gym, '')`
	scan := func(row pgx.CollectableRow) (contribution, error) {
		var c contribution
		var created time.Time
		var r contributionRoute
		var routeID *string
		err := row.Scan(&c.ID, &created, &c.Rating, &c.Comment, &c.URL, &c.File, &routeID, &r.Name, &r.Color, &r.Grade, &r.Gym)
		c.Created = created.UTC().Format("2006-01-02 15:04:05.000Z")
		if routeID != nil {
			r.ID = *routeID
			c.Route = &r
		}
		return c, err
	}
	rows, err := q.Query(ctx, `SELECT x.id, x.created, x.rating::float8, x.comment, '', '', `+route+`
		FROM ratings x LEFT JOIN routes rt ON rt.id = x.route_id WHERE x."user" = $1 ORDER BY x.created DESC LIMIT $2`, userID, contributionsLimit)
	if err != nil {
		return nil, nil, err
	}
	if reviews, err = pgx.CollectRows(rows, scan); err != nil {
		return nil, nil, err
	}
	rows, err = q.Query(ctx, `SELECT x.id, x.created, 0::float8, '', x.url, x.file, `+route+`
		FROM beta_videos x LEFT JOIN routes rt ON rt.id = x.route WHERE x."user" = $1 ORDER BY x.created DESC LIMIT $2`, userID, contributionsLimit)
	if err != nil {
		return nil, nil, err
	}
	betas, err = pgx.CollectRows(rows, scan)
	return emptyIfNil(reviews), emptyIfNil(betas), err
}

func emptyIfNil(items []contribution) []contribution {
	if items == nil {
		return []contribution{}
	}
	return items
}
