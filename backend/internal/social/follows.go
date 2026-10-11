package social

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
)

const (
	followColumns = `id, created, updated, follower, followee, status`
	blockColumns  = `id, created, updated, blocker, blocked`
)

type Follow struct {
	ID       string    `json:"id"`
	Created  time.Time `json:"created"`
	Updated  time.Time `json:"updated"`
	Follower string    `json:"follower"`
	Followee string    `json:"followee"`
	Status   string    `json:"status"`
}

type Block struct {
	ID      string    `json:"id"`
	Created time.Time `json:"created"`
	Updated time.Time `json:"updated"`
	Blocker string    `json:"blocker"`
	Blocked string    `json:"blocked"`
}

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func invalid(field, code, message string) *httpx.Error {
	return httpx.NewError(http.StatusBadRequest, message).Field(field, code, message)
}

func queryFollows(ctx context.Context, q querier, sql string, args ...any) ([]Follow, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	follows, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Follow, error) {
		var f Follow
		return f, row.Scan(&f.ID, &f.Created, &f.Updated, &f.Follower, &f.Followee, &f.Status)
	})
	if follows == nil {
		follows = []Follow{}
	}
	return follows, err
}

func findFollow(ctx context.Context, q querier, sql string, args ...any) (Follow, error) {
	follows, err := queryFollows(ctx, q, sql, args...)
	if err != nil {
		return Follow{}, err
	}
	if len(follows) == 0 {
		return Follow{}, httpx.ErrNotFound
	}
	return follows[0], nil
}

func blockedEitherWay(ctx context.Context, q querier, a, b string) (bool, error) {
	var blocked bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM blocks WHERE (blocker = $1 AND blocked = $2) OR (blocker = $2 AND blocked = $1))`, a, b).Scan(&blocked)
	return blocked, err
}

type person struct {
	username, firstname, name, policy string
}

func findPerson(ctx context.Context, q querier, id string) (person, bool, error) {
	var p person
	err := q.QueryRow(ctx, `SELECT username, firstname, name, follow_policy FROM users WHERE id = $1`, id).Scan(&p.username, &p.firstname, &p.name, &p.policy)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, false, nil
	}
	return p, err == nil, err
}

func (p person) fullName() string {
	if full := strings.TrimSpace(p.firstname + " " + p.name); full != "" {
		return full
	}
	return p.username
}

func (m *module) listFollows(w http.ResponseWriter, r *http.Request) error {
	principal, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	query := r.URL.Query()
	sql := `SELECT ` + followColumns + ` FROM follows WHERE `
	switch query.Get("direction") {
	case "":
		sql += `(follower = $1 OR followee = $1)`
	case "following":
		sql += `follower = $1`
	case "followers":
		sql += `followee = $1`
	default:
		return invalid("direction", "validation_invalid_value", "direction must be followers or following.")
	}
	args := []any{principal.UserID}
	switch status := query.Get("status"); status {
	case "":
	case "pending", "accepted":
		args = append(args, status)
		sql += ` AND status = $2`
	default:
		return invalid("status", "validation_invalid_value", "status must be pending or accepted.")
	}
	follows, err := queryFollows(r.Context(), m.app.DB, sql+` ORDER BY created DESC, id`, args...)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, follows)
	return nil
}

func (m *module) postFollow(w http.ResponseWriter, r *http.Request) error {
	principal, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	var body struct {
		Followee string `json:"followee"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if body.Followee == "" {
		return invalid("followee", "validation_required", "Cannot be blank.")
	}
	if err := m.follows.Check(w, principal.UserID); err != nil {
		return err
	}
	cannotFollow := invalid("followee", "validation_invalid_value", "This climber can't be followed.")
	if body.Followee == principal.UserID {
		return cannotFollow
	}
	var follow Follow
	err = pgx.BeginFunc(r.Context(), m.app.DB, func(tx pgx.Tx) error {
		followee, ok, err := findPerson(r.Context(), tx, body.Followee)
		if err != nil {
			return err
		}
		if !ok {
			return cannotFollow
		}
		blocked, err := blockedEitherWay(r.Context(), tx, principal.UserID, body.Followee)
		if err != nil {
			return err
		}
		if blocked {
			return cannotFollow
		}
		status := "pending"
		switch followee.policy {
		case "closed":
			return cannotFollow
		case "open":
			status = "accepted"
		}
		follow, err = findFollow(r.Context(), tx, `INSERT INTO follows (id, follower, followee, status) VALUES ($1, $2, $3, $4)
			ON CONFLICT (follower, followee) DO NOTHING RETURNING `+followColumns, ids.New(), principal.UserID, body.Followee, status)
		if errors.Is(err, httpx.ErrNotFound) {
			return invalid("followee", "validation_not_unique", "You already follow this climber.")
		}
		if err != nil {
			return err
		}
		if err := publishFollow(r.Context(), tx, "create", follow); err != nil {
			return err
		}
		follower, _, err := findPerson(r.Context(), tx, principal.UserID)
		if err != nil {
			return err
		}
		n := Notify{Type: "follow_requested", Users: []string{follow.Followee}, Params: map[string]any{"name": follower.fullName()}, URL: "/friends?tab=requests"}
		if status == "accepted" {
			n.Type, n.URL = "new_follower", "/climber?id="+principal.UserID
		}
		return publishNotify(r.Context(), tx, n)
	})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, follow)
	return nil
}

func (m *module) acceptFollow(w http.ResponseWriter, r *http.Request) error {
	principal, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	var follow Follow
	err = pgx.BeginFunc(r.Context(), m.app.DB, func(tx pgx.Tx) error {
		follow, err = findFollow(r.Context(), tx, `SELECT `+followColumns+` FROM follows WHERE id = $1 AND followee = $2 FOR UPDATE`, r.PathValue("id"), principal.UserID)
		if err != nil {
			return err
		}
		if follow.Status != "pending" {
			return httpx.NewError(http.StatusBadRequest, "Only pending follow requests can be accepted.")
		}
		follow, err = findFollow(r.Context(), tx, `UPDATE follows SET status = 'accepted' WHERE id = $1 RETURNING `+followColumns, follow.ID)
		if err != nil {
			return err
		}
		if err := publishFollow(r.Context(), tx, "update", follow); err != nil {
			return err
		}
		followee, _, err := findPerson(r.Context(), tx, principal.UserID)
		if err != nil {
			return err
		}
		return publishNotify(r.Context(), tx, Notify{Type: "follow_accepted", Users: []string{follow.Follower},
			Params: map[string]any{"name": followee.fullName()}, URL: "/climber?id=" + principal.UserID})
	})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, follow)
	return nil
}

func (m *module) deleteFollow(w http.ResponseWriter, r *http.Request) error {
	principal, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	if err := m.follows.Check(w, principal.UserID); err != nil {
		return err
	}
	err = pgx.BeginFunc(r.Context(), m.app.DB, func(tx pgx.Tx) error {
		follow, err := findFollow(r.Context(), tx, `DELETE FROM follows WHERE id = $1 AND (follower = $2 OR followee = $2) RETURNING `+followColumns,
			r.PathValue("id"), principal.UserID)
		if err != nil {
			return err
		}
		return publishFollow(r.Context(), tx, "delete", follow)
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func queryBlocks(ctx context.Context, q querier, sql string, args ...any) ([]Block, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	blocks, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Block, error) {
		var b Block
		return b, row.Scan(&b.ID, &b.Created, &b.Updated, &b.Blocker, &b.Blocked)
	})
	if blocks == nil {
		blocks = []Block{}
	}
	return blocks, err
}

func (m *module) listBlocks(w http.ResponseWriter, r *http.Request) error {
	principal, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	blocks, err := queryBlocks(r.Context(), m.app.DB, `SELECT `+blockColumns+` FROM blocks WHERE blocker = $1 ORDER BY created DESC, id`, principal.UserID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, blocks)
	return nil
}

// postBlock ends follows both ways; the blocked climber then no longer finds the blocker in search or profiles.
func (m *module) postBlock(w http.ResponseWriter, r *http.Request) error {
	principal, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	var body struct {
		Blocked string `json:"blocked"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if body.Blocked == "" {
		return invalid("blocked", "validation_required", "Cannot be blank.")
	}
	if body.Blocked == principal.UserID {
		return invalid("blocked", "validation_invalid_value", "You can't block yourself.")
	}
	var block Block
	err = pgx.BeginFunc(r.Context(), m.app.DB, func(tx pgx.Tx) error {
		if _, ok, err := findPerson(r.Context(), tx, body.Blocked); err != nil || !ok {
			if err == nil {
				err = invalid("blocked", "validation_invalid_value", "Unknown climber.")
			}
			return err
		}
		blocks, err := queryBlocks(r.Context(), tx, `INSERT INTO blocks (id, blocker, blocked) VALUES ($1, $2, $3)
			ON CONFLICT (blocker, blocked) DO NOTHING RETURNING `+blockColumns, ids.New(), principal.UserID, body.Blocked)
		if err != nil {
			return err
		}
		if len(blocks) == 0 {
			return invalid("blocked", "validation_not_unique", "This climber is already blocked.")
		}
		block = blocks[0]
		ended, err := queryFollows(r.Context(), tx, `DELETE FROM follows WHERE (follower = $1 AND followee = $2) OR (follower = $2 AND followee = $1) RETURNING `+followColumns,
			principal.UserID, body.Blocked)
		if err != nil {
			return err
		}
		for _, follow := range ended {
			if err := publishFollow(r.Context(), tx, "delete", follow); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, block)
	return nil
}

func (m *module) deleteBlock(w http.ResponseWriter, r *http.Request) error {
	principal, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	tag, err := m.app.DB.Exec(r.Context(), `DELETE FROM blocks WHERE id = $1 AND blocker = $2`, r.PathValue("id"), principal.UserID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.ErrNotFound
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
