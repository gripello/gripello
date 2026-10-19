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
	kindGymTrial   = "gym.trial_changed"
	TopicSettings  = "settings"
)

type gymDeleted struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
}

// A gone gym passes the hub's visibility gate, so events of a gym the public must not see carry a closed audience themselves.
func publishGym(ctx context.Context, tx pgx.Tx, actor, kind, gymID string, public bool, payload any) error {
	audience := events.Audience{Public: true}
	if !public {
		audience = events.Audience{GymPerm: gymID + ":manage_settings"}
	}
	return events.PublishAs(ctx, tx, actor, "gym:"+gymID, kind, payload, audience)
}

type trialEvent struct {
	Gym         string `json:"gym"`
	TrialEndsAt any    `json:"trial_ends_at"`
}

// The trial end is for the gym's members (their permissions follow it) and platform admins only.
func publishTrial(ctx context.Context, tx pgx.Tx, actor, gymID string, endsAt any) error {
	rows, err := tx.Query(ctx, `SELECT "user" FROM memberships WHERE gym = $1`, gymID)
	if err != nil {
		return err
	}
	members, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	return events.PublishAs(ctx, tx, actor, "gym:"+gymID, kindGymTrial, trialEvent{Gym: gymID, TrialEndsAt: endsAt},
		events.Audience{Users: members, PlatformAdmins: true})
}
