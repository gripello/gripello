package social

import (
	"context"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/events"
)

const (
	TopicFollowChanges = "follow_changes"
	TopicFollowChanged = "follow.changed"
	TopicNotify        = "notify"
	KindNotify         = "notify"
)

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

type Notify struct {
	Type   string         `json:"type"`
	Users  []string       `json:"users"`
	Gym    string         `json:"gym"`
	Params map[string]any `json:"params"`
	URL    string         `json:"url"`
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

func publishNotify(ctx context.Context, tx pgx.Tx, n Notify) error {
	return events.Publish(ctx, tx, TopicNotify, KindNotify, n, events.Audience{})
}
