package tasks

import (
	"context"
	"errors"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/jobs"
	"gripello/internal/platform/mail"
)

const (
	normalTaskPriority = 2
	urgentTaskPriority = 4
	maxPhotoBytes      = 5 << 20
	permManageTasks    = "manage_tasks"
	urgentAlertJob     = "tasks.urgentAlert"
	urgentAlertWindow  = time.Minute
)

var (
	urgentDefectCategories = []string{"loose_bolt", "loose_hold", "spinning_hold", "broken_hold"}
	closedTaskStatuses     = []string{"done", "dismissed"}
	taskKinds              = []string{"defect", "reset", "maintenance", "other", "wish"}
	climberTaskKinds       = []string{"defect", "wish"}
	taskStatuses           = []string{"open", "in_progress", "done", "dismissed", "waiting"}
	taskCategories         = []string{"", "loose_bolt", "loose_hold", "spinning_hold", "broken_hold", "damaged_volume", "sharp_edge", "missing_hold", "label_tag", "other"}
	taskRouteTypes         = []string{"", "Route", "Boulder"}
	photoTypes             = []string{"image/jpeg", "image/png", "image/webp"}
)

func badRequest(message string) *httpx.Error { return httpx.NewError(http.StatusBadRequest, message) }

func invalid(field, message string) *httpx.Error {
	return badRequest("Failed to save record.").Field(field, "validation_invalid_value", message)
}

func defaultTaskPriority(kind, category string) int {
	if kind == "defect" && slices.Contains(urgentDefectCategories, category) {
		return urgentTaskPriority
	}
	return normalTaskPriority
}

func restrictToClimberReport(t *Task) {
	if !slices.Contains(climberTaskKinds, t.Kind) {
		t.Kind = "defect"
	}
	t.Title = ""
	t.Assignee = ""
	t.DueDate = nil
	t.Priority = defaultTaskPriority("defect", t.Category)
}

func validateFields(t Task) error {
	for _, check := range []struct {
		field, value string
		allowed      []string
	}{
		{"kind", t.Kind, taskKinds}, {"status", t.Status, taskStatuses},
		{"category", t.Category, taskCategories}, {"route_type", t.RouteType, taskRouteTypes},
	} {
		if !slices.Contains(check.allowed, check.value) {
			return invalid(check.field, "Invalid value "+check.value+".")
		}
	}
	if t.Priority < 1 || t.Priority > urgentTaskPriority {
		return invalid("priority", "Priority must be between 1 and 4.")
	}
	for _, check := range []struct {
		field, value string
		max          int
	}{{"title", t.Title, 200}, {"description", t.Description, 2000}, {"resolution_note", t.ResolutionNote, 1000}, {"grade", t.Grade, 10}} {
		if utf8.RuneCountInString(check.value) > check.max {
			return invalid(check.field, "Must be no more than "+strconv.Itoa(check.max)+" characters.")
		}
	}
	return nil
}

func validateTask(t Task) error {
	switch t.Kind {
	case "wish":
		if t.Route != "" {
			return badRequest("A wish cannot point to an existing route.")
		}
		if t.Location == "" || t.RouteType == "" {
			return badRequest("A wish needs a location and a route type.")
		}
	case "defect":
		if t.Route == "" || t.Category == "" {
			return badRequest("A defect needs a route and a category.")
		}
	default:
		if t.Title == "" {
			return badRequest("A task needs a title.")
		}
	}
	return nil
}

func stampTaskDone(t *Task, previousStatus, actorID string, now time.Time) {
	if !slices.Contains(closedTaskStatuses, t.Status) {
		t.DoneAt, t.DoneBy = nil, ""
		return
	}
	if !slices.Contains(closedTaskStatuses, previousStatus) {
		t.DoneAt, t.DoneBy = &now, actorID
	}
}

func isUrgentDefect(t Task) bool {
	return t.Kind == "defect" && t.Priority == urgentTaskPriority
}

func withoutUser(users []string, userID string) []string {
	return slices.DeleteFunc(slices.Clone(users), func(id string) bool { return id == userID })
}

func defectFiledParams(routeName, gymName string) map[string]any {
	return map[string]any{"route": routeName, "gym": gymName}
}

// attachTarget derives location (and the default wall) from the route or wall; none of them may sit in another gym.
func attachTarget(ctx context.Context, q querier, t *Task, creating bool) error {
	sameGym := func(gym string) error {
		if gym != t.Gym {
			return badRequest("The task cannot belong to another gym.")
		}
		return nil
	}
	if t.Route != "" {
		route, err := findRouteTarget(ctx, q, t.Route)
		if errors.Is(err, pgx.ErrNoRows) {
			return invalid("route", "Route not found.")
		} else if err != nil {
			return err
		}
		if creating && route.Archived {
			return badRequest("This route has been removed.")
		}
		t.Location = route.Location
		if t.Wall == "" {
			t.Wall = route.Wall
		} else if _, wallLocation, err := findWallTarget(ctx, q, t.Wall); err != nil || wallLocation != route.Location {
			return invalid("wall", "The wall is not in the route's location.")
		}
		return sameGym(route.Gym)
	}
	if t.Wall != "" {
		gym, location, err := findWallTarget(ctx, q, t.Wall)
		if err != nil {
			return invalid("wall", "Wall not found.")
		}
		t.Location = location
		return sameGym(gym)
	}
	if t.Location != "" {
		gym, err := findLocationGym(ctx, q, t.Location)
		if err != nil {
			return invalid("location", "Location not found.")
		}
		return sameGym(gym)
	}
	return nil
}

func validateAssignee(ctx context.Context, q querier, t Task) error {
	if t.Assignee == "" {
		return nil
	}
	ok, err := holdsManageTasks(ctx, q, t.Assignee, t.Gym)
	if err != nil {
		return err
	}
	if !ok {
		return invalid("assignee", "The assignee cannot manage tasks in this gym.")
	}
	return nil
}

// applyInput copies client fields; kind is only settable on create, server-owned fields never.
func applyInput(t *Task, in map[string]string, creating bool) error {
	text := map[string]*string{
		"title": &t.Title, "category": &t.Category, "status": &t.Status, "route": &t.Route, "wall": &t.Wall,
		"location": &t.Location, "description": &t.Description, "assignee": &t.Assignee,
		"resolution_note": &t.ResolutionNote, "route_type": &t.RouteType, "grade": &t.Grade,
	}
	if creating {
		text["kind"] = &t.Kind
	}
	for key, target := range text {
		if value, ok := in[key]; ok {
			*target = value
		}
	}
	if value, ok := in["priority"]; ok {
		if value == "" {
			t.Priority = 0
		} else if n, err := strconv.Atoi(value); err == nil {
			t.Priority = n
		} else {
			return invalid("priority", "Priority must be a number.")
		}
	}
	if value, ok := in["due_date"]; ok {
		at, valid := parseTime(value)
		if !valid {
			return invalid("due_date", "Invalid date.")
		}
		t.DueDate = at
	}
	return nil
}

func parseTime(value string) (*time.Time, bool) {
	if value == "" {
		return nil, true
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05.000Z07:00", "2006-01-02 15:04:05Z07:00", "2006-01-02 15:04:05.000Z", "2006-01-02 15:04:05Z", "2006-01-02"} {
		if t, err := time.Parse(layout, value); err == nil {
			return &t, true
		}
	}
	return nil, false
}

func actorOf(ctx context.Context) string {
	p, _ := auth.From(ctx)
	return p.UserID
}

func (m *module) isManager(ctx context.Context, gym string) bool {
	p, ok := auth.From(ctx)
	return ok && m.perms.Can(ctx, p.UserID, gym, permManageTasks)
}

func (m *module) requireManager(ctx context.Context, gym string) error {
	if _, err := auth.Require(ctx); err != nil {
		return err
	}
	if !m.isManager(ctx, gym) {
		return httpx.ErrForbidden
	}
	return nil
}

func (m *module) gymPath(ctx context.Context, q querier, gym, path string) string {
	g, _ := findGym(ctx, q, gym)
	return "/" + g.Slug + path
}

func (m *module) createTask(ctx context.Context, gym string, in map[string]string, photo *multipart.FileHeader) (Task, error) {
	actor := actorOf(ctx)
	t := Task{ID: ids.New(), Gym: gym}
	if err := applyInput(&t, in, true); err != nil {
		return Task{}, err
	}
	if err := attachTarget(ctx, m.app.DB, &t, true); err != nil {
		return Task{}, err
	}
	if !m.isManager(ctx, gym) {
		restrictToClimberReport(&t)
	}
	t.Reporter, t.Status, t.DoneAt, t.DoneBy, t.ResolutionNote = actor, "open", nil, "", ""
	if t.Priority == 0 {
		t.Priority = defaultTaskPriority(t.Kind, t.Category)
	}
	if err := validateFields(t); err != nil {
		return Task{}, err
	}
	if err := validateTask(t); err != nil {
		return Task{}, err
	}
	if err := validateAssignee(ctx, m.app.DB, t); err != nil {
		return Task{}, err
	}
	if err := m.storePhoto(ctx, &t, photo); err != nil {
		return Task{}, err
	}
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if err := insertTask(ctx, tx, t); err != nil {
			return err
		}
		var err error
		if t, err = findTask(ctx, tx, t.ID); err != nil {
			return err
		}
		if err := publishTaskChange(ctx, tx, "create", t); err != nil {
			return err
		}
		if err := publishOpenDefects(ctx, tx, gym, defectRoutes(t)); err != nil {
			return err
		}
		return m.notifyCreated(ctx, tx, t, actor)
	})
	if err != nil {
		m.dropPhoto(ctx, t.ID, t.Photo)
		return Task{}, err
	}
	m.warmPhoto(t, photo)
	if isUrgentDefect(t) {
		if err := m.queueUrgentAlert(ctx, gym); err != nil {
			slog.Error("tasks: queueing urgent defect mail failed", "task", t.ID, "error", err)
		}
	}
	return t, nil
}

func (m *module) notifyCreated(ctx context.Context, tx pgx.Tx, t Task, actor string) error {
	managers, err := taskManagers(ctx, tx, t.Gym)
	if err != nil {
		return err
	}
	board := m.gymPath(ctx, tx, t.Gym, "/manage/tasks")
	switch t.Kind {
	case "defect":
		g, _ := findGym(ctx, tx, t.Gym)
		err = publishNotify(ctx, tx, Notify{Type: "task_defect_filed", Users: withoutUser(managers, actor), Gym: t.Gym,
			Params: defectFiledParams(routeName(ctx, tx, t.Route), g.Name), URL: board})
	case "wish":
		err = publishNotify(ctx, tx, Notify{Type: "task_wish_filed", Users: withoutUser(managers, actor), Gym: t.Gym,
			Params: wishParams(ctx, tx, t), URL: board})
	}
	if err != nil {
		return err
	}
	return m.notifyAssignee(ctx, tx, t, actor)
}

func (m *module) notifyAssignee(ctx context.Context, tx pgx.Tx, t Task, actor string) error {
	if t.Assignee == "" || t.Assignee == actor {
		return nil
	}
	label := t.Title
	if label == "" {
		label = routeName(ctx, tx, t.Route)
	}
	return publishNotify(ctx, tx, Notify{Type: "task_assigned", Users: []string{t.Assignee}, Gym: t.Gym,
		Params: map[string]any{"title": label}, URL: m.gymPath(ctx, tx, t.Gym, "/manage/tasks")})
}

func wishParams(ctx context.Context, q querier, t Task) map[string]any {
	return map[string]any{"location": locationName(ctx, q, t.Location)}
}

func (m *module) updateTask(ctx context.Context, id string, in map[string]string, photo *multipart.FileHeader) (Task, error) {
	before, err := findTask(ctx, m.app.DB, id)
	if err != nil {
		return Task{}, err
	}
	if err := m.requireManager(ctx, before.Gym); err != nil {
		return Task{}, err
	}
	actor := actorOf(ctx)
	t := before
	if err := applyInput(&t, in, false); err != nil {
		return Task{}, err
	}
	stampTaskDone(&t, before.Status, actor, time.Now())
	if err := validateFields(t); err != nil {
		return Task{}, err
	}
	if err := validateTask(t); err != nil {
		return Task{}, err
	}
	if err := attachTarget(ctx, m.app.DB, &t, false); err != nil {
		return Task{}, err
	}
	if t.Assignee != before.Assignee {
		if err := validateAssignee(ctx, m.app.DB, t); err != nil {
			return Task{}, err
		}
	}
	if photo != nil || t.Description != before.Description {
		if err := refuseWhileHidden(ctx, m.app.DB, id); err != nil {
			return Task{}, err
		}
	}
	if err := m.storePhoto(ctx, &t, photo); err != nil {
		return Task{}, err
	}
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if err := saveTask(ctx, tx, t); err != nil {
			return err
		}
		var err error
		if t, err = findTask(ctx, tx, id); err != nil {
			return err
		}
		if err := publishTaskChange(ctx, tx, "update", t); err != nil {
			return err
		}
		if err := publishOpenDefects(ctx, tx, t.Gym, defectRoutes(t, before)); err != nil {
			return err
		}
		if t.Assignee != before.Assignee {
			if err := m.notifyAssignee(ctx, tx, t, actor); err != nil {
				return err
			}
		}
		if t.Status == "done" && before.Status != "done" && t.Reporter != "" && t.Reporter != actor {
			return m.notifyReporterOfDone(ctx, tx, t)
		}
		return nil
	})
	if err != nil {
		if t.Photo != before.Photo {
			m.dropPhoto(ctx, id, t.Photo)
		}
		return Task{}, err
	}
	m.warmPhoto(t, photo)
	if t.Photo != before.Photo {
		m.dropPhoto(ctx, id, before.Photo)
	}
	return t, nil
}

func (m *module) notifyReporterOfDone(ctx context.Context, tx pgx.Tx, t Task) error {
	switch t.Kind {
	case "defect":
		return publishNotify(ctx, tx, Notify{Type: "task_defect_fixed", Users: []string{t.Reporter}, Gym: t.Gym,
			Params: map[string]any{"route": routeName(ctx, tx, t.Route)}, URL: "/route?id=" + t.Route})
	case "wish":
		return publishNotify(ctx, tx, Notify{Type: "task_wish_done", Users: []string{t.Reporter}, Gym: t.Gym,
			Params: wishParams(ctx, tx, t), URL: m.gymPath(ctx, tx, t.Gym, "/routes")})
	}
	return nil
}

func (m *module) deleteTask(ctx context.Context, id string) error {
	t, err := findTask(ctx, m.app.DB, id)
	if err != nil {
		return err
	}
	if err := m.requireManager(ctx, t.Gym); err != nil {
		return err
	}
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM tasks WHERE id = $1`, id); err != nil {
			return err
		}
		if err := publishTaskChange(ctx, tx, "delete", t); err != nil {
			return err
		}
		return publishOpenDefects(ctx, tx, t.Gym, defectRoutes(t))
	})
	if err == nil && m.app.Blob != nil {
		m.app.Blob.Delete(ctx, "tasks/"+id)
	}
	return err
}

func (m *module) storePhoto(ctx context.Context, t *Task, photo *multipart.FileHeader) error {
	if photo == nil || m.app.Blob == nil {
		return nil
	}
	if photo.Size > maxPhotoBytes {
		return httpx.NewError(http.StatusRequestEntityTooLarge, "The file is too large.")
	}
	file, err := photo.Open()
	if err != nil {
		return err
	}
	defer file.Close()
	name, err := m.app.Blob.Upload(ctx, "tasks/"+t.ID+"/"+photo.Filename, file, photoTypes, maxPhotoBytes)
	if err != nil {
		return err
	}
	t.Photo = name
	return nil
}

func (m *module) warmPhoto(t Task, photo *multipart.FileHeader) {
	if photo != nil && m.app.Blob != nil {
		m.app.Blob.WarmThumbs("tasks/"+t.ID+"/"+t.Photo, "400x0")
	}
}

func (m *module) dropPhoto(ctx context.Context, id, name string) {
	if name != "" && m.app.Blob != nil {
		m.app.Blob.Delete(ctx, "tasks/"+id+"/"+name)
	}
}

// queueUrgentAlert mails a gym's managers right away, then at most once per urgentAlertWindow with everything filed since.
func (m *module) queueUrgentAlert(ctx context.Context, gym string) error {
	var last *time.Time
	if err := m.app.DB.QueryRow(ctx, `SELECT max(urgent_alerted_at) FROM tasks WHERE gym = $1`, gym).Scan(&last); err != nil {
		return err
	}
	var delay time.Duration
	if last != nil {
		delay = max(0, time.Until(last.Add(urgentAlertWindow)))
	}
	return jobs.Enqueue(ctx, m.app.DB, urgentAlertJob, gym, nil, delay)
}

func (m *module) sendUrgentAlerts(ctx context.Context, job jobs.Job) error {
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `UPDATE tasks SET urgent_alerted_at = now() WHERE gym = $1 AND kind = 'defect' AND priority = $2
			AND urgent_alerted_at IS NULL AND status IN ('open', 'in_progress', 'waiting') RETURNING `+taskColumns, job.Key, urgentTaskPriority)
		if err != nil {
			return err
		}
		defects, err := pgx.CollectRows(rows, pgx.RowToStructByName[Task])
		if err != nil || len(defects) == 0 {
			return err
		}
		slices.SortFunc(defects, func(a, b Task) int { return a.Created.Compare(b.Created) })
		// Mailing before the commit: a failed commit sends twice, which beats losing a safety alert.
		return m.sendUrgentDefectAlert(ctx, tx, job.Key, defects)
	})
}

func (m *module) sendUrgentDefectAlert(ctx context.Context, q querier, gym string, defects []Task) error {
	recipients, err := managerMailRecipients(ctx, q, gym)
	if err != nil {
		return err
	}
	var to []mail.Recipient
	for _, r := range recipients {
		if slices.ContainsFunc(defects, func(t Task) bool { return t.Reporter != r.ID }) {
			to = append(to, mail.Recipient{Address: r.Email, Language: r.Language})
		}
	}
	if len(to) == 0 || m.app.MailTemplates == nil {
		return nil
	}
	g, err := findGym(ctx, q, gym)
	if err != nil {
		return err
	}
	base := m.app.MailTemplates.AppURL
	brand := mail.Brand{
		Name: g.Name, Subject: g.Name, Language: g.Language,
		ReplyTo:    firstNonEmpty(g.ContactEmail, platformContactEmail(ctx, m.app.DB)),
		ImprintURL: base + "/" + g.Slug + "/imprint", PrivacyURL: base + "/" + g.Slug + "/privacy",
	}
	names := make([]string, len(defects))
	for i, t := range defects {
		names[i] = routeName(ctx, q, t.Route)
	}
	_, err = m.app.MailTemplates.Send(ctx, m.app.Mail, brand, urgentDefectMail(base, "/"+g.Slug, defects, names), to)
	return err
}

func urgentDefectMail(appURL, gymPrefix string, defects []Task, routeNames []string) mail.Content {
	var details []mail.Detail
	var lines []string
	for i, t := range defects {
		details = append(details,
			mail.Detail{Label: "problem", ValueKey: "tasks.categories." + t.Category, Value: t.Category},
			mail.Detail{Label: "route", Value: routeNames[i], Link: appURL + "/route?id=" + url.QueryEscape(t.Route)})
		if t.Description != "" {
			details = append(details, mail.Detail{Label: "details", Value: t.Description})
		}
		if t.Photo != "" && len(lines) == 0 {
			lines = append(lines, "mails.urgentDefect.photo")
		}
	}
	return mail.Content{
		Key:       "urgentDefect",
		Params:    map[string]any{"route": strings.Join(slices.Compact(slices.Clone(routeNames)), ", ")},
		ParamKeys: map[string]string{"problem": "tasks.categories." + defects[0].Category},
		Lines:     lines,
		Details:   details,
		Action:    gymPrefix + "/manage/tasks",
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func (m *module) closeRouteTasks(ctx context.Context, route string) error {
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		closed, err := updateTasks(ctx, tx, `UPDATE tasks SET status = 'done', done_at = now(), updated = now()
			WHERE route = $1 AND status IN ('open', 'in_progress', 'waiting')`, route)
		if err != nil || len(closed) == 0 {
			return err
		}
		return publishOpenDefects(ctx, tx, closed[0].Gym, defectRoutes(closed...))
	})
}

func (m *module) unassignWithoutPermission(ctx context.Context, gym string, users []string) error {
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		_, err := updateTasks(ctx, tx, `UPDATE tasks SET assignee = NULL, updated = now()
			WHERE gym = $1 AND assignee = ANY ($2) AND status NOT IN ('done', 'dismissed')
			AND assignee NOT IN (`+managersSQL+`)`, gym, users)
		return err
	})
}

// updateTasks runs a bulk UPDATE and tells the task board about every changed task.
func updateTasks(ctx context.Context, tx pgx.Tx, sql string, args ...any) ([]Task, error) {
	rows, err := tx.Query(ctx, sql+` RETURNING `+taskColumns, args...)
	if err != nil {
		return nil, err
	}
	changed, err := pgx.CollectRows(rows, pgx.RowToStructByName[Task])
	if err != nil {
		return nil, err
	}
	for _, t := range changed {
		if err := publishTaskChange(ctx, tx, "update", t); err != nil {
			return nil, err
		}
	}
	return changed, nil
}
