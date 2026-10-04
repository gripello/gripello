package hooks

import (
	"encoding/json"
	"net/http"

	"github.com/pocketbase/pocketbase/core"
)

const pushChannel = "push"

type notificationTopic struct {
	Key        string   `json:"key"`
	Permission string   `json:"permission,omitempty"`
	Types      []string `json:"-"`
}

// New notification types join a topic here; the client lists topics from /api/notifications/settings.
var notificationTopics = []notificationTopic{
	{Key: "new_routes", Types: []string{"wall_new_routes"}},
	{Key: "defect_fixed", Types: []string{"task_defect_fixed"}},
	{Key: "competition_results", Types: []string{"competition_published"}},
	{Key: "tasks", Permission: "manage_tasks", Types: []string{"task_defect_filed", "task_assigned"}},
	{Key: "reports", Permission: "manage_reports", Types: []string{"report_filed", "report_decided_kept", "report_decided_removed"}},
}

func topicOf(notificationType string) string {
	for _, topic := range notificationTopics {
		for _, candidate := range topic.Types {
			if candidate == notificationType {
				return topic.Key
			}
		}
	}
	return ""
}

// notification_prefs is {"<channel>": {"<topic>": false}}; anything not set to false is on.
func wantsNotification(user *core.Record, channel, notificationType string) bool {
	var prefs map[string]map[string]bool
	if json.Unmarshal([]byte(user.GetString("notification_prefs")), &prefs) != nil {
		return true
	}
	enabled, set := prefs[channel][topicOf(notificationType)]
	return !set || enabled
}

func registerNotificationSettings(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.GET("/api/notifications/settings", func(e *core.RequestEvent) error {
			publicKey, _ := vapidKeys()
			return e.JSON(http.StatusOK, map[string]any{
				"pushKey": publicKey,
				"topics":  notificationTopics,
			})
		})
		return se.Next()
	})
}
