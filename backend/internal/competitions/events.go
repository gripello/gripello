package competitions

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
)

const (
	KindChanged        = "competition.changed"
	TopicNotify        = "notify"
	KindNotify         = "notify"
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

type Notify struct {
	Type   string         `json:"type"`
	Users  []string       `json:"users"`
	Gym    string         `json:"gym"`
	Params map[string]any `json:"params"`
	URL    string         `json:"url"`
}

type EntryCreated struct {
	ID          string `json:"id"`
	Competition string `json:"competition"`
	Gym         string `json:"gym"`
	User        string `json:"user"`
}

type Tick struct {
	ID          string    `json:"id"`
	Created     time.Time `json:"created"`
	Updated     time.Time `json:"updated"`
	User        string    `json:"user"`
	Route       string    `json:"route"`
	Type        string    `json:"type"`
	Attempts    int       `json:"attempts"`
	Date        time.Time `json:"date"`
	Note        string    `json:"note"`
	Grade       string    `json:"grade"`
	GradeSystem string    `json:"grade_system"`
	GradeIndex  float64   `json:"grade_index"`
	RouteName   string    `json:"route_name"`
}

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

// publishChange: drafts reach only managers; an entry's owner gets user+entry, everyone else the stripped change.
func publishChange(ctx context.Context, tx pgx.Tx, c Competition, kind, user, entry string) error {
	change := Change{Competition: c.ID, Gym: c.Gym, Kind: kind, User: user, Entry: entry, At: time.Now().UnixMilli()}
	topic := "competition_changes:" + c.ID
	if c.Status == "draft" {
		return publish(ctx, tx, topic, KindChanged, change, events.Audience{GymPerm: c.Gym + ":" + permManage})
	}
	if user == "" {
		return publish(ctx, tx, topic, KindChanged, change, events.Audience{Public: true})
	}
	if err := publish(ctx, tx, topic, KindChanged, change, events.Audience{Users: []string{user}}); err != nil {
		return err
	}
	stripped := change
	stripped.User, stripped.Entry = "", ""
	if err := publish(ctx, tx, topic, KindChanged, stripped, events.Audience{GuestsOnly: true}); err != nil {
		return err
	}
	return publish(ctx, tx, topic, KindChanged, stripped, events.Audience{SignedIn: true, NotUsers: []string{user}})
}

func publishTick(ctx context.Context, tx pgx.Tx, tick Tick, gym string, private bool) error {
	change := TickChange{Action: "create", Record: tick}
	if err := publish(ctx, tx, TopicOwnTicks, "tick.created", change, events.Audience{Users: []string{tick.User}}); err != nil {
		return err
	}
	if !private {
		shared := change
		shared.Record.Note = ""
		if err := publish(ctx, tx, TopicFollowedTicks, "tick.created", shared, events.Audience{FollowersOf: tick.User}); err != nil {
			return err
		}
	}
	return publish(ctx, tx, TopicTickChanged, "tick.created",
		TickChanged{User: tick.User, Route: tick.Route, Gym: gym, Date: tick.Date}, events.Audience{})
}

func publishNotify(ctx context.Context, tx pgx.Tx, n Notify) error {
	if len(n.Users) == 0 {
		return nil
	}
	return publish(ctx, tx, TopicNotify, KindNotify, n, events.Audience{})
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
	p, _ := auth.From(ctx)
	return events.PublishAs(ctx, tx, p.UserID, topic, kind, payload, audience)
}
