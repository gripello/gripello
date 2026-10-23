package competitions

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/apitime"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
	"gripello/internal/platform/tenancy"
)

const (
	KindChanged        = "competition.changed"
	TopicEntryCreated  = "entry.created"
	TopicEntryDeleted  = "entry.deleted"
	TopicOwnTicks      = "own_ticks"
	TopicFollowedTicks = "followed_ticks"
	TopicTickChanged   = "tick.changed"
)

type Change struct {
	Competition string `json:"competition"`
	Gym         string `json:"gym"`
	Kind        string `json:"kind"`
	User        string `json:"user,omitempty"`
	Entry       string `json:"entry,omitempty"`
	At          int64  `json:"at"`
}

type EntryCreated struct {
	ID          string `json:"id"`
	Competition string `json:"competition"`
	Gym         string `json:"gym"`
	User        string `json:"user"`
}

type Tick struct {
	ID          string       `json:"id"`
	Created     time.Time    `json:"created"`
	Updated     time.Time    `json:"updated"`
	User        string       `json:"user"`
	Route       string       `json:"route"`
	Type        string       `json:"type"`
	Attempts    int          `json:"attempts"`
	Date        apitime.Date `json:"date"`
	Note        string       `json:"note"`
	Grade       string       `json:"grade"`
	GradeSystem string       `json:"grade_system"`
	GradeIndex  float64      `json:"grade_index"`
	RouteName   string       `json:"route_name"`
}

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

// publishChange: drafts reach only managers; an entry's owner gets user+entry, everyone else the stripped change.
func publishChange(ctx context.Context, tx pgx.Tx, c Competition, kind, user, entry string) error {
	change := Change{Competition: c.ID, Gym: c.Gym, Kind: kind, User: user, Entry: entry, At: time.Now().UnixMilli()}
	topic := "competition_changes:" + c.ID
	audience := events.Audience{Public: true, Gym: c.Gym}
	if c.Status == "draft" {
		audience = events.Audience{GymPerm: c.Gym + ":" + tenancy.PermManageCompetitions, Gym: c.Gym}
	}
	// lists of a gym's competitions follow the lifecycle without subscribing to every competition
	if kind == "competition" {
		if err := publish(ctx, tx, "competitions:"+c.Gym, KindChanged, change, audience); err != nil {
			return err
		}
	}
	if c.Status == "draft" {
		return publish(ctx, tx, topic, KindChanged, change, audience)
	}
	if user == "" {
		return publish(ctx, tx, topic, KindChanged, change, events.Audience{Public: true, Gym: c.Gym})
	}
	if err := publish(ctx, tx, topic, KindChanged, change, events.Audience{Users: []string{user}, Gym: c.Gym}); err != nil {
		return err
	}
	stripped := change
	stripped.User, stripped.Entry = "", ""
	if err := publish(ctx, tx, topic, KindChanged, stripped, events.Audience{GuestsOnly: true, Gym: c.Gym}); err != nil {
		return err
	}
	return publish(ctx, tx, topic, KindChanged, stripped, events.Audience{SignedIn: true, NotUsers: []string{user}, Gym: c.Gym})
}

// publishTick takes the action "create" or "delete", like the ticks module's events.
func publishTick(ctx context.Context, tx pgx.Tx, action string, tick Tick, gym string, private bool) error {
	kind := "tick." + action + "d"
	change := TickChange{Action: action, Record: tick}
	if err := publish(ctx, tx, TopicOwnTicks, kind, change, events.Audience{Users: []string{tick.User}}); err != nil {
		return err
	}
	if !private {
		shared := change
		shared.Record.Note = ""
		if err := publish(ctx, tx, TopicFollowedTicks, kind, shared, events.Audience{FollowersOf: tick.User, Gym: gym}); err != nil {
			return err
		}
	}
	return publish(ctx, tx, TopicTickChanged, kind,
		TickChanged{User: tick.User, Route: tick.Route, Gym: gym, Date: tick.Date}, events.Audience{})
}

func publishEntryCreated(ctx context.Context, tx pgx.Tx, e Entry, gym string) error {
	return publish(ctx, tx, TopicEntryCreated, TopicEntryCreated,
		EntryCreated{ID: e.ID, Competition: e.Competition, Gym: gym, User: e.User}, events.Audience{})
}

func publishEntryDeleted(ctx context.Context, tx pgx.Tx, e Entry, gym string) error {
	return publish(ctx, tx, TopicEntryDeleted, TopicEntryDeleted,
		EntryCreated{ID: e.ID, Competition: e.Competition, Gym: gym, User: e.User}, events.Audience{})
}

func publish(ctx context.Context, tx pgx.Tx, topic, kind string, payload any, audience events.Audience) error {
	return events.PublishAs(ctx, tx, auth.UserID(ctx), topic, kind, payload, audience)
}
