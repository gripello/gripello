package platformadmin

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/events"
)

// Platform pages list every gym and user; they hear of changes through slim ids on the platform topic,
// which reaches platform admins only, instead of subscribing to each gym: and user: topic.
var relayedKinds = map[string]string{
	"gym:":  "platform_gyms.changed",
	"user:": "platform_users.changed",
}

func (m *module) relay(prefix string) events.Handler {
	kind := relayedKinds[prefix]
	return func(e events.Event) {
		if prefix == "user:" && e.Kind != "user.updated" && e.Kind != "user.deleted" {
			return
		}
		var source struct {
			Changed []string `json:"changed"`
		}
		json.Unmarshal(e.Payload, &source)
		payload := map[string]any{"id": strings.TrimPrefix(e.Topic, prefix), "kind": e.Kind, "changed": source.Changed}
		ctx := context.Background()
		err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
			return events.PublishAs(ctx, tx, e.Actor, "platform", kind, payload, events.Audience{PlatformAdmins: true})
		})
		if err != nil {
			slog.Error("platformadmin: relay failed", "kind", kind, "error", err)
		}
	}
}
