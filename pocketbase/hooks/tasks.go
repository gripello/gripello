package hooks

import (
	"fmt"
	"html"
	"slices"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

var urgentDefectCategories = []string{"loose_bolt", "loose_hold", "spinning_hold", "broken_hold"}

const (
	normalTaskPriority = 2
	urgentTaskPriority = 4
)

var defectCategoryLabels = map[string]string{
	"loose_bolt":     "Loose bolt / screw",
	"loose_hold":     "Loose hold",
	"spinning_hold":  "Spinning hold",
	"broken_hold":    "Broken hold",
	"damaged_volume": "Damaged volume",
	"sharp_edge":     "Sharp edge",
	"missing_hold":   "Missing hold",
	"label_tag":      "Label / tag",
	"other":          "Other",
}

var closedTaskStatuses = []string{"done", "dismissed"}

var serverOwnedTaskFields = []string{"kind", "reporter", "done_at", "done_by"}

func registerTasks(app core.App) {
	app.OnRecordCreateRequest("tasks").BindFunc(func(e *core.RecordRequestEvent) error {
		actorID := requestUserID(e)
		if err := attachTaskTarget(e.App, e.Record, true); err != nil {
			return err
		}
		if !isTaskManager(e) {
			restrictToDefectReport(e.Record)
		}
		e.Record.Set("reporter", actorID)
		e.Record.Set("status", "open")
		e.Record.Set("done_at", "")
		e.Record.Set("done_by", "")
		e.Record.Set("resolution_note", "")
		if e.Record.GetInt("priority") == 0 {
			e.Record.Set("priority", defaultTaskPriority(e.Record.GetString("kind"), e.Record.GetString("category")))
		}
		if err := validateTask(e.Record); err != nil {
			return err
		}
		if err := validateAssignee(e.App, e.Record); err != nil {
			return err
		}
		if err := e.Next(); err != nil {
			return err
		}

		if e.Record.GetString("kind") == "defect" {
			pushNotification(e.App, notification{
				Users:  withoutUser(usersByPermission(e.App, e.Record.GetString("gym"), "manage_tasks"), actorID),
				Type:   "task_defect_filed",
				Params: defectFiledParams(taskRouteName(e.App, e.Record), gymName(e.App, e.Record.GetString("gym"))),
				URL:    gymPath(e.App, e.Record.GetString("gym"), "/manage/tasks"),
			})
			if err := sendUrgentDefectAlert(e.App, e.Record, actorID); err != nil {
				e.App.Logger().Error("tasks: urgent defect mail failed", "task", e.Record.Id, "error", err)
			}
		}
		notifyTaskAssignee(e.App, e.Record, actorID)
		return nil
	})

	app.OnRecordUpdateRequest("tasks").BindFunc(func(e *core.RecordRequestEvent) error {
		actorID := requestUserID(e)
		original := e.Record.Original()
		previousStatus := original.GetString("status")
		previousAssignee := original.GetString("assignee")
		for _, field := range serverOwnedTaskFields {
			e.Record.Set(field, original.Get(field))
		}
		stampTaskDone(e.Record, previousStatus, actorID, types.NowDateTime())
		if err := validateTask(e.Record); err != nil {
			return err
		}
		if err := attachTaskTarget(e.App, e.Record, false); err != nil {
			return err
		}
		if e.Record.GetString("assignee") != previousAssignee {
			if err := validateAssignee(e.App, e.Record); err != nil {
				return err
			}
		}
		if err := e.Next(); err != nil {
			return err
		}

		if e.Record.GetString("assignee") != previousAssignee {
			notifyTaskAssignee(e.App, e.Record, actorID)
		}
		reporterID := e.Record.GetString("reporter")
		if e.Record.GetString("kind") == "defect" && e.Record.GetString("status") == "done" &&
			previousStatus != "done" && reporterID != "" && reporterID != actorID {
			if reporter, err := e.App.FindRecordById("users", reporterID); err == nil {
				pushNotification(e.App, notification{
					Users:  []*core.Record{reporter},
					Type:   "task_defect_fixed",
					Params: map[string]any{"route": taskRouteName(e.App, e.Record)},
					URL:    "/route?id=" + e.Record.GetString("route"),
				})
			}
		}
		return nil
	})

	unassignFormerManager := func(e *core.RecordEvent) error {
		unassignTasksWithoutPermission(e.App, e.Record.GetString("user"), e.Record.GetString("gym"))
		return e.Next()
	}
	app.OnRecordAfterUpdateSuccess("memberships").BindFunc(unassignFormerManager)
	app.OnRecordAfterDeleteSuccess("memberships").BindFunc(unassignFormerManager)
	app.OnRecordAfterUpdateSuccess("roles").BindFunc(func(e *core.RecordEvent) error {
		memberships, err := e.App.FindAllRecords("memberships", dbx.HashExp{"role": e.Record.Id})
		if err != nil {
			return err
		}
		for _, membership := range memberships {
			unassignTasksWithoutPermission(e.App, membership.GetString("user"), membership.GetString("gym"))
		}
		return e.Next()
	})

	app.OnRecordUpdate("routes").BindFunc(func(e *core.RecordEvent) error {
		wasArchived := e.Record.Original().GetBool("archived")
		if err := e.Next(); err != nil {
			return err
		}
		if !wasArchived && e.Record.GetBool("archived") {
			closeOpenRouteTasks(e.App, e.Record.Id)
		}
		return nil
	})
}

func isTaskManager(e *core.RecordRequestEvent) bool {
	return e.HasSuperuserAuth() || (e.Auth != nil && hasPermission(e.App, e.Auth.Id, e.Record.GetString("gym"), "manage_tasks"))
}

func requestUserID(e *core.RecordRequestEvent) string {
	if e.Auth == nil || e.Auth.Collection().Name != "users" {
		return ""
	}
	return e.Auth.Id
}

func restrictToDefectReport(task *core.Record) {
	task.Set("kind", "defect")
	task.Set("title", "")
	task.Set("assignee", "")
	task.Set("due_date", "")
	task.Set("priority", defaultTaskPriority("defect", task.GetString("category")))
}

func defaultTaskPriority(kind, category string) int {
	if kind == "defect" && slices.Contains(urgentDefectCategories, category) {
		return urgentTaskPriority
	}
	return normalTaskPriority
}

func validateTask(task *core.Record) error {
	if task.GetString("kind") == "defect" {
		if task.GetString("route") == "" || task.GetString("category") == "" {
			return apis.NewBadRequestError("A defect needs a route and a category.", nil)
		}
		return nil
	}
	if task.GetString("title") == "" {
		return apis.NewBadRequestError("A task needs a title.", nil)
	}
	return nil
}

func stampTaskDone(task *core.Record, previousStatus, actorID string, now types.DateTime) {
	closed := slices.Contains(closedTaskStatuses, task.GetString("status"))
	if !closed {
		task.Set("done_at", "")
		task.Set("done_by", "")
		return
	}
	if !slices.Contains(closedTaskStatuses, previousStatus) {
		task.Set("done_at", now)
		task.Set("done_by", actorID)
	}
}

func attachTaskTarget(app core.App, task *core.Record, creating bool) error {
	if routeID := task.GetString("route"); routeID != "" {
		route, err := app.FindRecordById("routes", routeID)
		if err != nil {
			return apis.NewBadRequestError("Route not found.", nil)
		}
		if creating && route.GetBool("archived") {
			return apis.NewBadRequestError("This route has been removed.", nil)
		}
		task.Set("location", route.GetString("location"))
		task.Set("gym", route.GetString("gym"))
		if wallID := task.GetString("wall"); wallID == "" {
			task.Set("wall", route.GetString("wall"))
		} else if wall, err := app.FindRecordById("walls", wallID); err != nil || wall.GetString("location") != route.GetString("location") {
			return apis.NewBadRequestError("The wall is not in the route's location.", nil)
		}
		return rejectGymMove(task)
	}
	if wallID := task.GetString("wall"); wallID != "" {
		wall, err := app.FindRecordById("walls", wallID)
		if err != nil {
			return apis.NewBadRequestError("Wall not found.", nil)
		}
		task.Set("location", wall.GetString("location"))
		task.Set("gym", wall.GetString("gym"))
		return rejectGymMove(task)
	}
	if locationID := task.GetString("location"); locationID != "" {
		return copyGymFrom(app, task, "locations", "location")
	}
	return rejectGymMove(task)
}

func validateAssignee(app core.App, task *core.Record) error {
	assigneeID := task.GetString("assignee")
	if assigneeID != "" && !hasPermission(app, assigneeID, task.GetString("gym"), "manage_tasks") {
		return apis.NewBadRequestError("The assignee cannot manage tasks in this gym.", nil)
	}
	return nil
}

func unassignTasksWithoutPermission(app core.App, userID, gymID string) {
	if hasPermission(app, userID, gymID, "manage_tasks") {
		return
	}
	tasks, err := app.FindRecordsByFilter(
		"tasks",
		"gym = {:gym} && assignee = {:user} && status != 'done' && status != 'dismissed'",
		"",
		0,
		0,
		dbx.Params{"gym": gymID, "user": userID},
	)
	if err != nil {
		app.Logger().Error("tasks: failed to load tasks of a former manager", "user", userID, "gym", gymID, "error", err)
		return
	}
	for _, task := range tasks {
		task.Set("assignee", "")
		if err := app.Save(task); err != nil {
			app.Logger().Error("tasks: failed to unassign task", "task", task.Id, "error", err)
		}
	}
}

func notifyTaskAssignee(app core.App, task *core.Record, actorID string) {
	assigneeID := task.GetString("assignee")
	if assigneeID == "" || assigneeID == actorID {
		return
	}
	assignee, err := app.FindRecordById("users", assigneeID)
	if err != nil {
		return
	}
	pushNotification(app, notification{
		Users:  []*core.Record{assignee},
		Type:   "task_assigned",
		Params: map[string]any{"title": taskLabel(app, task)},
		URL:    gymPath(app, task.GetString("gym"), "/manage/tasks"),
	})
}

func taskLabel(app core.App, task *core.Record) string {
	if title := task.GetString("title"); title != "" {
		return title
	}
	return taskRouteName(app, task)
}

func taskRouteName(app core.App, task *core.Record) string {
	route, err := app.FindRecordById("routes", task.GetString("route"))
	if err != nil {
		return ""
	}
	return route.GetString("name")
}

func withoutUser(users []*core.Record, userID string) []*core.Record {
	return slices.DeleteFunc(users, func(user *core.Record) bool { return user.Id == userID })
}

func closeOpenRouteTasks(app core.App, routeID string) {
	tasks, err := app.FindRecordsByFilter(
		"tasks",
		"route = {:route} && (status = 'open' || status = 'in_progress' || status = 'waiting')",
		"",
		0,
		0,
		dbx.Params{"route": routeID},
	)
	if err != nil {
		app.Logger().Error("tasks: failed to load tasks of archived route", "route", routeID, "error", err)
		return
	}
	for _, task := range tasks {
		task.Set("status", "done")
		task.Set("done_at", types.NowDateTime())
		if err := app.Save(task); err != nil {
			app.Logger().Error("tasks: failed to close task of archived route", "task", task.Id, "error", err)
		}
	}
}

func isUrgentDefectTask(task *core.Record) bool {
	return task.GetString("kind") == "defect" && task.GetInt("priority") == urgentTaskPriority
}

func sendUrgentDefectAlert(app core.App, task *core.Record, reporterID string) error {
	if !isUrgentDefectTask(task) || !app.Settings().SMTP.Enabled {
		return nil
	}
	recipients := []string{}
	for _, user := range withoutUser(usersByPermission(app, task.GetString("gym"), "manage_tasks"), reporterID) {
		if address := user.GetString("email"); address != "" && !slices.Contains(recipients, address) {
			recipients = append(recipients, address)
		}
	}
	category := defectCategoryLabel(task.GetString("category"))
	routeName := taskRouteName(app, task)
	_, err := sendMail(
		app,
		recipients,
		gymMailSubject(app, task.GetString("gym"), fmt.Sprintf("Urgent: %s on %s", category, routeName)),
		urgentDefectAlertHTML(appURL(app), gymPath(app, task.GetString("gym"), "/manage/tasks"), routeName, task),
	)
	return err
}

func defectFiledParams(routeName, gymName string) map[string]any {
	return map[string]any{"route": routeName, "gym": gymName}
}

func defectCategoryLabel(category string) string {
	if label, ok := defectCategoryLabels[category]; ok {
		return label
	}
	return category
}

func urgentDefectAlertHTML(baseURL, boardPath, routeName string, task *core.Record) string {
	description := ""
	if text := task.GetString("description"); text != "" {
		description = fmt.Sprintf("<p><strong>Details:</strong><br>%s</p>", html.EscapeString(text))
	}
	photo := ""
	if task.GetString("photo") != "" {
		photo = "<p>A photo is attached to the task.</p>"
	}
	return fmt.Sprintf(`<p>A climber reported a safety-relevant problem. Please check the route before it is climbed again.</p>
             <p><strong>Problem:</strong> %s</p>
             <p><strong>Route:</strong> <a href="%s/route?id=%s">%s</a></p>
             %s%s
             <p><a href="%s%s">Open the task board</a></p>`,
		html.EscapeString(defectCategoryLabel(task.GetString("category"))),
		html.EscapeString(baseURL),
		html.EscapeString(task.GetString("route")),
		html.EscapeString(routeName),
		description,
		photo,
		html.EscapeString(baseURL),
		html.EscapeString(boardPath),
	)
}
