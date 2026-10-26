package climbers

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/db"
	"gripello/internal/platform/events"
)

// OwnRecordSQL selects a users row aliased u the way its owner sees it: every column but the credentials.
const OwnRecordSQL = `to_jsonb(u) - 'password_hash' - 'token_key'`

// DerivedUserFields change with other fields and never count as edits.
var DerivedUserFields = []string{"updated", "verified_at"}

func OwnRecord(ctx context.Context, q db.Querier, userID string) (json.RawMessage, error) {
	var record json.RawMessage
	err := q.QueryRow(ctx, `SELECT `+OwnRecordSQL+` FROM users u WHERE id = $1`, userID).Scan(&record)
	return record, err
}

type UserUpdated struct {
	Record  json.RawMessage `json:"record"`
	Changed []string        `json:"changed"`
}

// PublishUserUpdated hands the user's devices their new record and the fields that changed.
func PublishUserUpdated(ctx context.Context, tx pgx.Tx, actor, userID string, record json.RawMessage, changed []string) error {
	return events.PublishAs(ctx, tx, actor, "user:"+userID, "user.updated", UserUpdated{Record: record, Changed: changed}, events.Audience{Users: []string{userID}})
}

// UnfollowWalls drops walls from every follower's followed_walls and sends each of them the updated own record.
func UnfollowWalls(ctx context.Context, tx pgx.Tx, actor string, walls []string) error {
	rows, err := tx.Query(ctx, `UPDATE users SET followed_walls = ARRAY(SELECT f FROM unnest(followed_walls) f WHERE f <> ALL ($1))
		WHERE followed_walls && $1 RETURNING id`, walls)
	if err != nil {
		return err
	}
	followers, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	for _, id := range followers {
		record, err := OwnRecord(ctx, tx, id)
		if err != nil {
			return err
		}
		if err := PublishUserUpdated(ctx, tx, actor, id, record, []string{"followed_walls"}); err != nil {
			return err
		}
	}
	return nil
}
