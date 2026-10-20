package social

import (
	"context"
	"encoding/json"
	"log/slog"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/events"
)

const (
	TopicFollowChanges = "follow_changes"
	TopicFollowChanged = "follow.changed"
	TopicClimbers      = "climbers"
)

// The fields other people see of a climber: names, avatar and what the profile page shows.
var publicProfileFields = []string{"username", "firstname", "name", "avatar", "banner", "ticks_private", "follow_policy"}

type FollowChange struct {
	Action string `json:"action"`
	Record Follow `json:"record"`
}

type FollowChanged struct {
	Follower string `json:"follower"`
	Followee string `json:"followee"`
	Status   string `json:"status"`
	Action   string `json:"action"`
}

var followKinds = map[string]string{"create": "follow.created", "update": "follow.updated", "delete": "follow.deleted"}

func publishFollow(ctx context.Context, tx pgx.Tx, action string, f Follow) error {
	kind := followKinds[action]
	if err := events.Publish(ctx, tx, TopicFollowChanges, kind, FollowChange{Action: action, Record: f},
		events.Audience{Users: []string{f.Follower, f.Followee}}); err != nil {
		return err
	}
	return events.Publish(ctx, tx, TopicFollowChanged, kind,
		FollowChanged{Follower: f.Follower, Followee: f.Followee, Status: f.Status, Action: action}, events.Audience{})
}

// Blocks are private: only the blocker's own devices learn about them.
func publishBlock(ctx context.Context, tx pgx.Tx, action string, b Block) error {
	return events.Publish(ctx, tx, TopicFollowChanges, "block."+action+"d", map[string]any{"action": action, "record": b},
		events.Audience{Users: []string{b.Blocker}})
}

// onProfileChange tells signed-in clients which climber to look up again; names travel only through /climbers.
func (m *module) onProfileChange(e events.Event) {
	kind := "climber.updated"
	switch e.Kind {
	case "user.deleted":
		kind = "climber.deleted"
	case "user.updated":
		var update struct {
			Changed []string `json:"changed"`
		}
		json.Unmarshal(e.Payload, &update)
		if update.Changed != nil && !slices.ContainsFunc(update.Changed, func(field string) bool {
			return slices.Contains(publicProfileFields, field)
		}) {
			return
		}
	default:
		return
	}
	id := strings.TrimPrefix(e.Topic, "user:")
	err := pgx.BeginFunc(context.Background(), m.app.DB, func(tx pgx.Tx) error {
		return events.Publish(context.Background(), tx, TopicClimbers, kind, map[string]string{"id": id}, events.Audience{SignedIn: true})
	})
	if err != nil {
		slog.Error("social: climber change not published", "error", err)
	}
}
