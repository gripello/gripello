package members

import (
	"context"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/events"
)

const (
	KindMembershipChanged = "membership.changed"
	KindRoleChanged       = "role.changed"
	KindInviteChanged     = "invite.changed"
)

type MembershipChanged struct {
	Action       string   `json:"action"`
	ID           string   `json:"id"`
	Gym          string   `json:"gym"`
	Users        []string `json:"users"`
	Role         string   `json:"role"`
	PreviousRole string   `json:"previous_role,omitempty"`
	Added        []string `json:"added"`
	Removed      []string `json:"removed"`
}

type RoleChanged struct {
	Action  string   `json:"action"`
	ID      string   `json:"id"`
	Gym     string   `json:"gym"`
	Users   []string `json:"users"`
	Added   []string `json:"added"`
	Removed []string `json:"removed"`
}

type InviteChanged struct {
	Action string   `json:"action"`
	ID     string   `json:"id"`
	Gym    string   `json:"gym"`
	Users  []string `json:"users,omitempty"`
}

func publishToGym(ctx context.Context, tx pgx.Tx, actor, gymID, kind string, payload any, affectedUsers []string) error {
	return events.PublishAs(ctx, tx, actor, "gym:"+gymID, kind, payload, events.Audience{Users: affectedUsers, GymPerm: gymID + ":manage_users"})
}
