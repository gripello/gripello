package ticks

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
)

const (
	TopicOwnTicks      = "own_ticks"
	TopicFollowedTicks = "followed_ticks"
	TopicTickChanged   = "tick.changed"
)

type TickChange struct {
	Action string `json:"action"`
	Record Tick   `json:"record"`
}

type TickChanged struct {
	User  string    `json:"user"`
	Route string    `json:"route"`
	Gym   string    `json:"gym"`
	Date  time.Time `json:"date"`
}

var kindOf = map[string]string{"create": "tick.created", "update": "tick.updated", "delete": "tick.deleted"}

// publishTick emits one tick.changed per affected day so leaderboards covering either day get capped.
func publishTick(ctx context.Context, tx pgx.Tx, action string, tick Tick, days ...time.Time) error {
	tick.Expand, tick.Climber = nil, nil
	kind := kindOf[action]
	principal, _ := auth.From(ctx)
	actor := principal.UserID
	if err := events.PublishAs(ctx, tx, actor, TopicOwnTicks, kind, TickChange{Action: action, Record: tick}, events.Audience{Users: []string{tick.User}}); err != nil {
		return err
	}
	private, err := ticksPrivate(ctx, tx, tick.User)
	if err != nil {
		return err
	}
	if !private {
		shared := tick
		shared.Note = ""
		if err := events.PublishAs(ctx, tx, actor, TopicFollowedTicks, kind, TickChange{Action: action, Record: shared}, events.Audience{FollowersOf: tick.User}); err != nil {
			return err
		}
	}
	gym := routeGym(ctx, tx, tick.Route)
	for i, day := range days {
		if i > 0 && day.Equal(days[0]) {
			continue
		}
		if err := events.PublishAs(ctx, tx, actor, TopicTickChanged, kind, TickChanged{User: tick.User, Route: tick.Route, Gym: gym, Date: day}, events.Audience{}); err != nil {
			return err
		}
	}
	return nil
}
