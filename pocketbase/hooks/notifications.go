package hooks

import (
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const (
	readNotificationRetentionDays = 30
	maxNotificationRetentionDays  = 90
	wallDigestWindow              = 15 * time.Minute
)

type notification struct {
	Users  []*core.Record
	Gym    string
	Type   string
	Params map[string]any
	URL    string
}

func registerNotifications(app core.App) {
	registerPush(app)
	registerNotificationSettings(app)
	app.Cron().MustAdd("wallNewRoutes", "*/15 * * * *", func() {
		notifyWallNewRoutes(app, time.Now())
	})
	app.Cron().MustAdd("notificationRetention", "23 3 * * *", func() {
		removed, err := pruneRows(
			app,
			"DELETE FROM notifications WHERE (`read` = TRUE AND created < {:readCutoff}) OR created < {:maxCutoff}",
			dbx.Params{
				"readCutoff": cutoff(days(readNotificationRetentionDays)),
				"maxCutoff":  cutoff(days(maxNotificationRetentionDays)),
			},
		)
		if err != nil {
			app.Logger().Error("notifications: prune failed", "error", err)
			return
		}
		app.Logger().Info("notifications: pruned expired entries", "rows", removed)
	})
}

// ponytail: a restart between ticks drops that window's digest; persist the last run if it matters
func notifyWallNewRoutes(app core.App, now time.Time) {
	end := now.UTC().Truncate(wallDigestWindow)
	start, _ := types.ParseDateTime(end.Add(-wallDigestWindow))
	until, _ := types.ParseDateTime(end)

	var walls []struct {
		Wall  string `db:"wall"`
		Gym   string `db:"gym"`
		Count int    `db:"count"`
	}
	err := app.DB().NewQuery(
		"SELECT wall, gym, COUNT(*) AS count FROM routes WHERE wall != '' AND archived = FALSE AND created >= {:start} AND created < {:end} GROUP BY wall, gym",
	).Bind(dbx.Params{"start": start.String(), "end": until.String()}).All(&walls)
	if err != nil {
		app.Logger().Error("notifications: wall digest query failed", "error", err)
		return
	}

	for _, entry := range walls {
		wall, err := app.FindRecordById("walls", entry.Wall)
		if err != nil {
			continue
		}
		followers, err := app.FindRecordsByFilter("users", "followed_walls.id ?= {:wall}", "", 0, 0, dbx.Params{"wall": entry.Wall})
		if err != nil {
			continue
		}
		pushNotification(app, notification{
			Users:  followers,
			Gym:    entry.Gym,
			Type:   "wall_new_routes",
			Params: map[string]any{"wall": wall.GetString("name"), "count": entry.Count},
			URL:    gymPath(app, entry.Gym, "/map?wall="+entry.Wall),
		})
	}
}

func pushNotification(app core.App, message notification) int {
	if len(message.Users) == 0 {
		return 0
	}

	collection, err := app.FindCollectionByNameOrId("notifications")
	if err != nil {
		app.Logger().Error("notifications: collection missing", "error", err)
		return 0
	}

	params := message.Params
	if params == nil {
		params = map[string]any{}
	}

	recipients := make([]*core.Record, 0, len(message.Users))
	for _, user := range message.Users {
		record := core.NewRecord(collection)
		record.Set("user", user.Id)
		record.Set("type", message.Type)
		record.Set("params", params)
		record.Set("url", message.URL)
		record.Set("read", false)
		if err := app.Save(record); err != nil {
			app.Logger().Error("notifications: failed to queue", "type", message.Type, "user", user.Id, "error", err)
			continue
		}
		recipients = append(recipients, user)
	}
	sendPush(app, recipients, message)
	return len(recipients)
}
