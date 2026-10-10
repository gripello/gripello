package moderation

import (
	"context"
	"maps"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/climbers"
	"gripello/internal/platform/events"
)

const (
	TopicModeration     = "moderation"
	KindContentHidden   = "content.hidden"
	KindContentRestored = "content.restored"
	TopicNotify         = "notify"
	KindNotify          = "notify"
	topicBetaCreated    = "beta.created"
	topicRouteArchived  = "route.archived"
)

// ContentChange tells the owning module that moderation hid or restored its content.
type ContentChange struct {
	ContentType string `json:"content_type"`
	ContentID   string `json:"content_id"`
	Gym         string `json:"gym"`
	Author      string `json:"author"`
}

type Notify struct {
	Type   string         `json:"type"`
	Users  []string       `json:"users"`
	Gym    string         `json:"gym"`
	Params map[string]any `json:"params"`
	URL    string         `json:"url"`
}

type GymChange struct {
	Collection string `json:"collection"`
	Action     string `json:"action"`
	Record     any    `json:"record"`
}

// ItemChange is what the inbox receives on moderation:<gym> and moderation:platform.
type ItemChange struct {
	Action string `json:"action"`
	Record Item   `json:"record"`
}

var kindSuffix = map[string]string{"create": "created", "update": "updated", "delete": "deleted"}

// publish attributes the event to the signed-in caller of a request; event consumers run without one.
func publish(ctx context.Context, tx pgx.Tx, topic, kind string, payload any, audience events.Audience) error {
	actor := ""
	if p, ok := auth.From(ctx); ok {
		actor = p.UserID
	}
	return events.PublishAs(ctx, tx, actor, topic, kind, payload, audience)
}

func publishNotify(ctx context.Context, tx pgx.Tx, n Notify) error {
	if len(n.Users) == 0 {
		return nil
	}
	return publish(ctx, tx, TopicNotify, KindNotify, n, events.Audience{})
}

func publishTopic(ctx context.Context, tx pgx.Tx, topic string, payload any) error {
	return publish(ctx, tx, topic, topic, payload, events.Audience{})
}

func publishContentChange(ctx context.Context, tx pgx.Tx, kind string, it Item) error {
	return publish(ctx, tx, TopicModeration, kind,
		ContentChange{ContentType: it.ContentType, ContentID: it.ContentID, Gym: it.Gym, Author: it.Author}, events.Audience{})
}

// publishItem feeds the inbox; gym staff never get the author id over the wire (anonymous reviewers).
func publishItem(ctx context.Context, tx pgx.Tx, action string, it Item) error {
	kind := "moderation_item." + kindSuffix[action]
	admins, err := platformAdmins(ctx, tx)
	if err != nil {
		return err
	}
	if len(admins) > 0 {
		if err := publish(ctx, tx, "moderation:platform", kind, ItemChange{action, it}, events.Audience{Users: admins}); err != nil {
			return err
		}
	}
	if it.Gym == "" {
		return nil
	}
	concealed := it
	concealed.Author = ""
	// Platform admins open gym inboxes without a membership.
	return publish(ctx, tx, "moderation:"+it.Gym, kind, ItemChange{action, concealed},
		events.Audience{GymPerm: it.Gym + ":manage_comments", Users: admins})
}

const routeColumns = `id, created, updated, gym, name, anchor_point, type, comment, creator, archived, archived_at, color,
	screw_date, COALESCE(location, '') AS location, COALESCE(wall, '') AS wall, wall_position, grade, grade_system,
	grade_index, permanent, average_rating, ratings_count`

// publishGymChange sends the gym_changes events the owning module would have sent for this change.
func (m *module) publishGymChange(ctx context.Context, tx pgx.Tx, kindName, action string, record map[string]any) error {
	gym, _ := record["gym"].(string)
	topic := "gym_changes:" + gym
	switch kindName {
	case "route":
		var route map[string]any
		if err := tx.QueryRow(ctx, `SELECT to_jsonb(x) FROM (SELECT `+routeColumns+` FROM average_rating WHERE id = $1) x`, record["id"]).Scan(&route); err != nil {
			return err
		}
		return publish(ctx, tx, topic, "route.updated", GymChange{"routes", "update", route}, events.Audience{Public: true})
	case "rating":
		author, _ := record["user"].(string)
		bare := maps.Clone(record)
		delete(bare, "user")
		kind := "rating." + kindSuffix[action]
		if action == "delete" || author == "" {
			return publish(ctx, tx, topic, kind, GymChange{"ratings", action, bare}, events.Audience{Public: true})
		}
		if err := publish(ctx, tx, topic, kind, GymChange{"ratings", action, bare}, events.Audience{GuestsOnly: true}); err != nil {
			return err
		}
		signedIn := maps.Clone(bare)
		if c, ok := m.author(ctx, tx, author, true); ok {
			signedIn["author"] = c
		}
		signedIn["mine"] = false
		if err := publish(ctx, tx, topic, kind, GymChange{"ratings", action, signedIn},
			events.Audience{SignedIn: true, NotUsers: []string{author}}); err != nil {
			return err
		}
		own := maps.Clone(signedIn)
		own["mine"] = true
		return publish(ctx, tx, topic, kind, GymChange{"ratings", action, own}, events.Audience{Users: []string{author}})
	case "beta_video":
		kind := "beta." + kindSuffix[action]
		if action == "delete" {
			return publish(ctx, tx, topic, kind, GymChange{"beta_videos", action, record}, events.Audience{Public: true})
		}
		if err := publish(ctx, tx, topic, kind, GymChange{"beta_videos", action, record}, events.Audience{GuestsOnly: true}); err != nil {
			return err
		}
		withAuthor := maps.Clone(record)
		if author, _ := record["user"].(string); author != "" {
			if c, ok := m.author(ctx, tx, author, false); ok {
				withAuthor["author"] = c
			}
		}
		return publish(ctx, tx, topic, kind, GymChange{"beta_videos", action, withAuthor}, events.Audience{SignedIn: true})
	}
	return nil
}

// author resolves a climber; reviews leave out authors who chose reviews_anonymous.
func (m *module) author(ctx context.Context, q querier, userID string, honourAnonymous bool) (climbers.Climber, bool) {
	found, err := m.climbers.Get(ctx, []string{userID})
	c, ok := found[userID]
	if err != nil || !ok {
		return c, false
	}
	if honourAnonymous {
		var anonymous bool
		q.QueryRow(ctx, `SELECT reviews_anonymous FROM users WHERE id = $1`, userID).Scan(&anonymous)
		return c, !anonymous
	}
	return c, true
}
