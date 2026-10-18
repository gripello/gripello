package climbers

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/events"
)

type deletedRow struct {
	topic, kind string
	payload     any
	audience    events.Audience
}

// AnnounceDeletion reads what deleting the user removes through ON DELETE CASCADE, so call it in the deleting
// transaction before the DELETE; the returned publish runs after it and tells other clients what disappeared,
// in the shapes the owning modules publish themselves.
func AnnounceDeletion(ctx context.Context, tx pgx.Tx, actor, userID string) (publish func() error, err error) {
	var rows []deletedRow
	collect := func(sql string, scan func(pgx.CollectableRow) (deletedRow, error)) error {
		result, err := tx.Query(ctx, sql, userID)
		if err != nil {
			return err
		}
		found, err := pgx.CollectRows(result, scan)
		rows = append(rows, found...)
		return err
	}
	err = collect(`SELECT id, gym, route FROM beta_videos WHERE "user" = $1`, func(r pgx.CollectableRow) (deletedRow, error) {
		var id, gym, route string
		err := r.Scan(&id, &gym, &route)
		return deletedRow{"gym_changes:" + gym, "beta.deleted", map[string]any{"collection": "beta_videos", "action": "delete",
			"record": map[string]string{"id": id, "gym": gym, "route": route}}, events.Audience{Public: true}}, err
	})
	if err == nil {
		err = collect(`SELECT id, follower, followee, status FROM follows WHERE follower = $1 OR followee = $1`, func(r pgx.CollectableRow) (deletedRow, error) {
			var id, follower, followee, status string
			err := r.Scan(&id, &follower, &followee, &status)
			other := follower
			if other == userID {
				other = followee
			}
			return deletedRow{"follow_changes", "follow.deleted", map[string]any{"action": "delete",
				"record": map[string]string{"id": id, "follower": follower, "followee": followee, "status": status}},
				events.Audience{Users: []string{other}}}, err
		})
	}
	if err == nil {
		err = collect(`SELECT id, gym, role FROM memberships WHERE "user" = $1`, func(r pgx.CollectableRow) (deletedRow, error) {
			var id, gym, role string
			err := r.Scan(&id, &gym, &role)
			return deletedRow{"gym:" + gym, "membership.changed", map[string]any{"action": "delete", "id": id, "gym": gym,
				"users": []string{userID}, "role": role}, events.Audience{GymPerm: gym + ":manage_users"}}, err
		})
	}
	if err == nil {
		err = collect(`SELECT DISTINCT c.id, c.gym, c.status FROM competition_entries e JOIN competitions c ON c.id = e.competition
			WHERE e."user" = $1`, func(r pgx.CollectableRow) (deletedRow, error) {
			var id, gym, status string
			err := r.Scan(&id, &gym, &status)
			audience := events.Audience{Public: true, Gym: gym}
			if status == "draft" {
				audience = events.Audience{GymPerm: gym + ":manage_competitions", Gym: gym}
			}
			return deletedRow{"competition_changes:" + id, "competition.changed", map[string]any{"competition": id, "gym": gym,
				"kind": "entries", "at": time.Now().UnixMilli()}, audience}, err
		})
	}
	if err != nil {
		return nil, err
	}
	return func() error {
		for _, row := range rows {
			if err := events.PublishAs(ctx, tx, actor, row.topic, row.kind, row.payload, row.audience); err != nil {
				return err
			}
		}
		return nil
	}, nil
}
