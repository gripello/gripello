package routes

import (
	"context"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
)

const TopicRouteArchived = "route.archived"

type GymChange struct {
	Collection string   `json:"collection"`
	Action     string   `json:"action"`
	Record     any      `json:"record"`
	Changed    []string `json:"changed,omitempty"`
}

type RouteArchived struct {
	Route string `json:"route"`
	Gym   string `json:"gym"`
}

var kindPrefix = map[string]string{"routes": "route", "walls": "wall", "locations": "location"}

var kindSuffix = map[string]string{"create": "created", "update": "updated", "delete": "deleted"}

func publishGymChange(ctx context.Context, tx pgx.Tx, gym, collection, action string, record any) error {
	return publishChange(ctx, tx, gym, collection, action, record, nil)
}

func publishUpdate(ctx context.Context, tx pgx.Tx, gym, collection string, before, after any) error {
	return publishChange(ctx, tx, gym, collection, "update", after, events.ChangedFields(before, after, derivedFields...))
}

func publishChange(ctx context.Context, tx pgx.Tx, gym, collection, action string, record any, changed []string) error {
	return events.PublishAs(ctx, tx, auth.UserID(ctx), "gym_changes:"+gym, kindPrefix[collection]+"."+kindSuffix[action],
		GymChange{Collection: collection, Action: action, Record: record, Changed: changed}, events.Audience{Public: true})
}

var derivedFields = []string{"updated", "average_rating", "ratings_count", "expand"}

func publishRouteArchived(ctx context.Context, tx pgx.Tx, route Route) error {
	return events.PublishAs(ctx, tx, auth.UserID(ctx), TopicRouteArchived, TopicRouteArchived, RouteArchived{Route: route.ID, Gym: route.Gym}, events.Audience{})
}
