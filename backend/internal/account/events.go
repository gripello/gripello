package account

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/events"
)

const (
	KindUserUpdated    = "user.updated"
	KindUserDeleted    = "user.deleted"
	kindSessionRevoked = "session.revoked"
)

// UserUpdated carries the user's own record (no credentials) and the fields that changed.
type UserUpdated struct {
	Record  json.RawMessage `json:"record"`
	Changed []string        `json:"changed"`
}

type UserDeleted struct {
	ID string `json:"id"`
}

func userTopic(id string) string { return "user:" + id }

func publishUser(ctx context.Context, tx pgx.Tx, userID, kind string, payload any) error {
	return events.Publish(ctx, tx, userTopic(userID), kind, payload, events.Audience{Users: []string{userID}})
}

// Same payload the authn module sends, so the realtime hub drops the connections of a deleted account.
func publishSessionsRevoked(ctx context.Context, tx pgx.Tx, userID string, sessionIDs []string) error {
	for _, id := range sessionIDs {
		payload := map[string]string{"session": id, "user": userID}
		if err := events.Publish(ctx, tx, "session.revoked", kindSessionRevoked, payload, events.Audience{Users: []string{userID}}); err != nil {
			return err
		}
	}
	return nil
}
