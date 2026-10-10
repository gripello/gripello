package tasks

import (
	"context"
	"slices"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/events"
)

const (
	TopicTasks        = "tasks"
	TopicNotify       = "notify"
	KindNotify        = "notify"
	KindDefectsChange = "defects.changed"
)

type Notify struct {
	Type   string         `json:"type"`
	Users  []string       `json:"users"`
	Gym    string         `json:"gym"`
	Params map[string]any `json:"params"`
	URL    string         `json:"url"`
}

type OpenDefectsChange struct {
	Gym     string       `json:"gym"`
	Routes  []string     `json:"routes"`
	Defects []OpenDefect `json:"defects"`
}

func publishNotify(ctx context.Context, tx pgx.Tx, n Notify) error {
	if len(n.Users) == 0 {
		return nil
	}
	return events.PublishAs(ctx, tx, actorOf(ctx), TopicNotify, KindNotify, n, events.Audience{})
}

func defectRoutes(tasks ...Task) []string {
	routes := []string{}
	for _, t := range tasks {
		if t.Kind == "defect" && t.Route != "" && !slices.Contains(routes, t.Route) {
			routes = append(routes, t.Route)
		}
	}
	return routes
}

// publishOpenDefects reloads the view for the touched routes so clients replace, not patch, their per-route defects.
func publishOpenDefects(ctx context.Context, tx pgx.Tx, gym string, routes []string) error {
	if len(routes) == 0 {
		return nil
	}
	defects, err := openDefects(ctx, tx, gym, routes)
	if err != nil {
		return err
	}
	if defects == nil {
		defects = []OpenDefect{}
	}
	return events.PublishAs(ctx, tx, actorOf(ctx), "open_route_defects:"+gym, KindDefectsChange,
		OpenDefectsChange{Gym: gym, Routes: routes, Defects: defects}, events.Audience{Public: true})
}

type TaskChange struct {
	Action string `json:"action"`
	Record Task   `json:"record"`
}

var taskChangeKinds = map[string]string{"create": "task.created", "update": "task.updated", "delete": "task.deleted"}

// publishTaskChange feeds both the staff task board (live) and the audit log (prefix "tasks:").
func publishTaskChange(ctx context.Context, tx pgx.Tx, action string, t Task) error {
	t.Expand = nil
	return events.PublishAs(ctx, tx, actorOf(ctx), TopicTasks+":"+t.Gym, taskChangeKinds[action], TaskChange{Action: action, Record: t},
		events.Audience{GymPerm: t.Gym + ":" + permManageTasks})
}
