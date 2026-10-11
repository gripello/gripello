package notifications

const pushChannel = "push"

// Not a role permission: the client grants it to platform admins when listing topics.
const platformAdminTopicPermission = "platform_admin"

type topic struct {
	Key        string   `json:"key"`
	Permission string   `json:"permission,omitempty"`
	Types      []string `json:"-"`
}

// New notification types join a topic here; the client lists topics from /notifications/settings.
var topics = []topic{
	{Key: "new_routes", Types: []string{"wall_new_routes"}},
	{Key: "defect_fixed", Types: []string{"task_defect_fixed"}},
	{Key: "wish_done", Types: []string{"task_wish_done"}},
	{Key: "competition_results", Types: []string{"competition_published", "competition_entry_added"}},
	{Key: "social", Types: []string{"follow_requested", "follow_accepted", "new_follower"}},
	{Key: "achievements", Types: []string{"achievement_earned"}},
	{Key: "tasks", Permission: "manage_tasks", Types: []string{"task_defect_filed", "task_wish_filed", "task_assigned"}},
	{Key: "reports", Permission: "manage_reports", Types: []string{"report_filed", "report_decided_kept", "report_decided_removed"}},
	{Key: "content", Types: []string{"content_hidden", "beta_approved", "beta_rejected"}},
	{Key: "moderation", Permission: "manage_comments", Types: []string{"moderation_pending"}},
	{Key: "platform_reports", Permission: platformAdminTopicPermission, Types: []string{"report_filed_platform"}},
}

func topicOf(notificationType string) string {
	for _, t := range topics {
		for _, candidate := range t.Types {
			if candidate == notificationType {
				return t.Key
			}
		}
	}
	return ""
}

type prefs map[string]map[string]bool

// Anything not set to false is on.
func (p prefs) wants(channel, notificationType string) bool {
	enabled, set := p[channel][topicOf(notificationType)]
	return !set || enabled
}
