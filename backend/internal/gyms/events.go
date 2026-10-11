package gyms

import (
	"context"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/events"
)

const (
	kindGymCreated = "gym.created"
	kindGymUpdated = "gym.updated"
	kindGymDeleted = "gym.deleted"
)

type gymDeleted struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
}

func publishGym(ctx context.Context, tx pgx.Tx, actor, kind, gymID string, active bool, payload any) error {
	audience := events.Audience{Public: true}
	if !active {
		audience = events.Audience{GymPerm: gymID + ":manage_settings"}
	}
	return events.PublishAs(ctx, tx, actor, "gym:"+gymID, kind, payload, audience)
}
