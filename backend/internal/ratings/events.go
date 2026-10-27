package ratings

import (
	"context"

	"github.com/jackc/pgx/v5"

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

var derivedFields = []string{"updated", "author", "mine", "expand"}

var kindSuffix = map[string]string{"create": "created", "update": "updated", "delete": "deleted"}

// publishRatingChange sends three audience variants so each client gets exactly one: guests the bare record,
// signed-in non-authors author + mine:false, the author mine:true.
func (m *module) publishRatingChange(ctx context.Context, tx pgx.Tx, actor, action string, rating Rating, changed []string) error {
	topic, kind := "gym_changes:"+rating.Gym, "rating."+kindSuffix[action]
	bare := rating
	bare.Author, bare.Mine, bare.Expand = nil, nil, nil
	if rating.User == "" {
		return events.PublishAs(ctx, tx, actor, topic, kind, GymChange{"ratings", action, bare, changed}, events.Audience{Public: true})
	}
	found, err := m.authors(ctx, []string{rating.User}, true)
	if err != nil {
		return err
	}
	// The envelope actor feeds the gym audit log: an anonymous reviewer's own actions must not name them there either.
	if _, named := found[rating.User]; actor == rating.User && !named {
		actor = ""
	}
	if err := events.PublishAs(ctx, tx, actor, topic, kind, GymChange{"ratings", action, bare, changed}, events.Audience{GuestsOnly: true}); err != nil {
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
