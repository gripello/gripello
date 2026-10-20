package ticks

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/apitime"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
)

const (
	TopicOwnTicks      = "own_ticks"
	TopicFollowedTicks = "followed_ticks"
	TopicTickChanged   = "tick.changed"
	TopicLeaderboard   = "leaderboard:"

	KindLeaderboardChanged = "leaderboard.changed"
	leaderboardJob         = "leaderboard.changed"
	leaderboardWindow      = 15 * time.Second
)

type TickChange struct {
	Action string `json:"action"`
	Record Tick   `json:"record"`
}

type TickChanged struct {
	User  string       `json:"user"`
	Route string       `json:"route"`
	Gym   string       `json:"gym"`
	Date  apitime.Date `json:"date"`
}

var kindOf = map[string]string{"create": "tick.created", "update": "tick.updated", "delete": "tick.deleted"}

// publishTick emits one tick.changed per affected day so consumers covering either day see the change.
func publishTick(ctx context.Context, tx pgx.Tx, action string, tick Tick, days ...apitime.Date) error {
	private, err := ticksPrivate(ctx, tx, tick.User)
	if err != nil {
		return err
	}
	gym := routeGym(ctx, tx, tick.Route)
	if err := publishTickRecord(ctx, tx, action, tick, private, gym); err != nil {
		return err
	}
	for i, day := range days {
		if i > 0 && day == days[0] {
			continue
		}
		if err := publishTickChanged(ctx, tx, action, TickChanged{User: tick.User, Route: tick.Route, Gym: gym, Date: day}); err != nil {
			return err
		}
	}
	return nil
}

// publishTickRecord sends the tick to its owner and, unless the climber's ticks are private, to their followers.
func publishTickRecord(ctx context.Context, tx pgx.Tx, action string, tick Tick, private bool, gym string) error {
	tick.Expand, tick.Climber = nil, nil
	kind := kindOf[action]
	actor := auth.UserID(ctx)
	if err := events.PublishAs(ctx, tx, actor, TopicOwnTicks, kind, TickChange{Action: action, Record: tick}, events.Audience{Users: []string{tick.User}}); err != nil {
		return err
	}
	if private {
		return nil
	}
	tick.Note = ""
	return events.PublishAs(ctx, tx, actor, TopicFollowedTicks, kind, TickChange{Action: action, Record: tick}, events.Audience{FollowersOf: tick.User, Gym: gym})
}

func publishTickChanged(ctx context.Context, tx pgx.Tx, action string, change TickChanged) error {
	return events.PublishAs(ctx, tx, auth.UserID(ctx), TopicTickChanged, kindOf[action], change, events.Audience{})
}

// Seasons ride gym_changes like the other gym content: pickers patch them in place.
func publishSeason(ctx context.Context, tx pgx.Tx, action string, season Season) error {
	actor := ""
	if p, ok := auth.From(ctx); ok {
		actor = p.UserID
	}
	payload := map[string]any{"collection": "seasons", "action": action, "record": season}
	return events.PublishAs(ctx, tx, actor, "gym_changes:"+season.Gym, "season."+action+"d", payload, events.Audience{Public: true})
}
