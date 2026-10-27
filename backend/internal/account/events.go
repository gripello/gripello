package account

import (
	"context"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/events"
)

const (
	KindUserDeleted    = "user.deleted"
	kindSessionRevoked = "session.revoked"
)

type UserDeleted struct {
	ID string `json:"id"`
}

func userTopic(id string) string { return "user:" + id }

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
