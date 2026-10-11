package ratings

import (
	"bytes"
	"context"
	"encoding/json"
	"slices"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
)

const (
	TopicRatingCreated = "rating.created"
	TopicBetaCreated   = "beta.created"
	TopicBetaPending   = "beta.pending"
)

type GymChange struct {
	Collection string   `json:"collection"`
	Action     string   `json:"action"`
	Record     any      `json:"record"`
	Changed    []string `json:"changed,omitempty"`
}

type RatingCreated struct {
	ID    string `json:"id"`
	Gym   string `json:"gym"`
	Route string `json:"route"`
	User  string `json:"user"`
}

type BetaCreated struct {
	ID    string `json:"id"`
	Gym   string `json:"gym"`
	Route string `json:"route"`
	User  string `json:"user"`
}

// BetaPending carries a held submission; the upload is staged at FileKey (moderation_items/<id>/<file>) and no beta_videos row exists.
type BetaPending struct {
	ID      string `json:"id"`
	Gym     string `json:"gym"`
	Route   string `json:"route"`
	User    string `json:"user"`
	URL     string `json:"url"`
	File    string `json:"file"`
	FileKey string `json:"file_key,omitempty"`
}

var derivedFields = map[string]bool{"updated": true, "author": true, "mine": true, "expand": true}

func changedFields(before, after any) []string {
	var old, updated map[string]json.RawMessage
	b, _ := json.Marshal(before)
	a, _ := json.Marshal(after)
	json.Unmarshal(b, &old)
	json.Unmarshal(a, &updated)
	changed := []string{}
	for field, value := range updated {
		if !derivedFields[field] && !bytes.Equal(old[field], value) {
			changed = append(changed, field)
		}
	}
	slices.Sort(changed)
	return changed
}

func actorOf(ctx context.Context) string {
	p, _ := auth.From(ctx)
	return p.UserID
}

var kindSuffix = map[string]string{"create": "created", "update": "updated", "delete": "deleted"}

// publishRatingChange sends PocketBase's audience variants so each client gets exactly one: guests the bare record,
// signed-in non-authors author + mine:false, the author mine:true.
func (m *module) publishRatingChange(ctx context.Context, tx pgx.Tx, actor, action string, rating Rating, changed []string) error {
	topic, kind := "gym_changes:"+rating.Gym, "rating."+kindSuffix[action]
	bare := rating
	bare.Author, bare.Mine, bare.Expand = nil, nil, nil
	if rating.User == "" {
		return events.PublishAs(ctx, tx, actor, topic, kind, GymChange{"ratings", action, bare, changed}, events.Audience{Public: true})
	}
	if err := events.PublishAs(ctx, tx, actor, topic, kind, GymChange{"ratings", action, bare, changed}, events.Audience{GuestsOnly: true}); err != nil {
		return err
	}
	found, err := m.authors(ctx, []string{rating.User}, true)
	if err != nil {
		return err
	}
	signedIn := bare
	if c, ok := found[rating.User]; ok {
		signedIn.Author = &c
	}
	notMine, mine := false, true
	signedIn.Mine = &notMine
	if err := events.PublishAs(ctx, tx, actor, topic, kind, GymChange{"ratings", action, signedIn, changed},
		events.Audience{SignedIn: true, NotUsers: []string{rating.User}}); err != nil {
		return err
	}
	own := signedIn
	own.Mine = &mine
	return events.PublishAs(ctx, tx, actor, topic, kind, GymChange{"ratings", action, own, changed}, events.Audience{Users: []string{rating.User}})
}

func (m *module) publishBetaChange(ctx context.Context, tx pgx.Tx, actor, action string, beta BetaVideo) error {
	topic, kind := "gym_changes:"+beta.Gym, "beta."+kindSuffix[action]
	bare := beta
	bare.Author = nil
	if err := events.PublishAs(ctx, tx, actor, topic, kind, GymChange{"beta_videos", action, bare, nil}, events.Audience{GuestsOnly: true}); err != nil {
		return err
	}
	found, err := m.authors(ctx, []string{beta.User}, false)
	if err != nil {
		return err
	}
	withAuthor := bare
	if c, ok := found[beta.User]; ok {
		withAuthor.Author = &c
	}
	return events.PublishAs(ctx, tx, actor, topic, kind, GymChange{"beta_videos", action, withAuthor, nil}, events.Audience{SignedIn: true})
}
