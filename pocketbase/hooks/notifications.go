package hooks

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	readNotificationRetentionDays = 30
	maxNotificationRetentionDays  = 90
)

type notification struct {
	Users  []*core.Record
	Type   string
	Params map[string]any
	URL    string
}

func registerNotifications(app core.App) {
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

	written := 0
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
		written++
	}
	return written
}
