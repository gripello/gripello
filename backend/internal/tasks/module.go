package tasks

import (
	"context"
	"encoding/json"
	"log/slog"
	"slices"
	"time"

	"gripello/internal/platform"
	"gripello/internal/platform/climbers"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/tenancy"
)

type module struct {
	app      *platform.App
	perms    *tenancy.Permissions
	climbers *climbers.Lookup
}

func Register(app *platform.App) {
	m := &module{app: app, perms: tenancy.New(app.DB), climbers: climbers.New(app.DB)}
	for pattern, handler := range map[string]httpx.Handler{
		"GET /gyms/{gym}/tasks":           m.listTasks,
		"POST /gyms/{gym}/tasks":          m.postTask,
		"GET /gyms/{gym}/tasks/assignees": m.listAssignees,
		"GET /gyms/{gym}/defects/open":    m.listGymDefects,
		"GET /routes/{id}/defects":        m.listRouteDefects,
		"GET /tasks/{id}":                 m.getTask,
		"PATCH /tasks/{id}":               m.patchTask,
		"POST /tasks/{id}/assign":         m.assignTask,
		"POST /tasks/{id}/status":         m.setStatus,
		"DELETE /tasks/{id}":              m.deleteTaskHandler,
	} {
		app.Handle(pattern, handler)
	}
	app.Worker(urgentAlertJob, m.sendUrgentAlerts)
	if app.Bus != nil {
		app.Bus.SubscribeOnce("route.archived", "tasks.closeOnArchive", m.onRouteArchived)
		app.Bus.SubscribeOnce("gym:", "tasks.unassign", m.onPermissionsChanged)
	}
}

func handlerContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 30*time.Second)
}

func (m *module) onRouteArchived(e events.Event) {
	var payload struct {
		Route string `json:"route"`
	}
	if json.Unmarshal(e.Payload, &payload) != nil || payload.Route == "" {
		return
	}
	ctx, cancel := handlerContext()
	defer cancel()
	if err := m.closeRouteTasks(ctx, payload.Route); err != nil {
		slog.Error("tasks: closing tasks of archived route failed", "route", payload.Route, "error", err)
	}
}

func (m *module) onPermissionsChanged(e events.Event) {
	if e.Kind != "membership.changed" && e.Kind != "role.changed" {
		return
	}
	var payload struct {
		Gym     string   `json:"gym"`
		Users   []string `json:"users"`
		Removed []string `json:"removed"`
	}
	if json.Unmarshal(e.Payload, &payload) != nil || len(payload.Users) == 0 || !slices.Contains(payload.Removed, permManageTasks) {
		return
	}
	ctx, cancel := handlerContext()
	defer cancel()
	if err := m.unassignWithoutPermission(ctx, payload.Gym, payload.Users); err != nil {
		slog.Error("tasks: unassigning former managers failed", "gym", payload.Gym, "error", err)
	}
}
