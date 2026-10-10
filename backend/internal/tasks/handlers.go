package tasks

import (
	"context"
	"errors"
	"mime/multipart"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/captcha"
	"gripello/internal/platform/httpx"
)

const (
	defaultPageSize = 50
	maxPageSize     = 500
)

var taskSorts = map[string]string{
	"priority": "priority", "due_date": "due_date", "created": "created", "updated": "updated",
	"done_at": "done_at", "status": "status", "kind": "kind",
}

func taskOrder(sort string) (string, error) {
	if sort == "" {
		sort = "-priority,due_date,-created"
	}
	var parts []string
	for _, key := range strings.Split(sort, ",") {
		direction := "ASC"
		if strings.HasPrefix(key, "-") {
			direction, key = "DESC", key[1:]
		}
		column, ok := taskSorts[key]
		if !ok {
			return "", invalid("sort", "Unknown sort key "+key+".")
		}
		parts = append(parts, column+" "+direction+" NULLS LAST")
	}
	return " ORDER BY " + strings.Join(parts, ", ") + ", id", nil
}

func taskFilter(gym string, query map[string][]string) (*conditions, error) {
	get := func(key string) string {
		if values := query[key]; len(values) > 0 {
			return values[0]
		}
		return ""
	}
	where := &conditions{}
	where.add("gym = ?", gym)
	if statuses := slices.Concat(query["status"], query["status[]"]); len(statuses) > 0 {
		for _, status := range statuses {
			if !slices.Contains(taskStatuses, status) {
				return nil, invalid("status", "Invalid value "+status+".")
			}
		}
		where.add("status = ANY (?)", statuses)
	}
	if kind := get("kind"); kind != "" {
		where.add("kind = ?", kind)
	}
	switch assignee := get("assignee"); assignee {
	case "":
	case "none":
		where.clauses = append(where.clauses, "assignee IS NULL")
	default:
		where.add("assignee = ?", assignee)
	}
	for _, key := range []string{"route", "location", "wall"} {
		if value := get(key); value != "" {
			where.add(key+" = ?", value)
		}
	}
	if q := strings.TrimSpace(get("q")); q != "" {
		pattern := "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(q) + "%"
		where.add(`(title ILIKE ? OR description ILIKE ? OR EXISTS (SELECT 1 FROM routes WHERE routes.id = tasks.route AND routes.name ILIKE ?)
			OR EXISTS (SELECT 1 FROM walls WHERE walls.id = tasks.wall AND walls.name ILIKE ?))`, pattern)
	}
	if get("urgent") == "true" {
		where.add("priority = ?", urgentTaskPriority)
	}
	if get("overdue") == "true" {
		where.clauses = append(where.clauses, "due_date < current_date AND status IN ('open', 'in_progress', 'waiting')")
	}
	return where, nil
}

func atoi(value string, fallback int) int {
	if n, err := strconv.Atoi(value); err == nil {
		return n
	}
	return fallback
}

func (m *module) listTasks(w http.ResponseWriter, r *http.Request) error {
	gym, err := resolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	if err := m.requireManager(r.Context(), gym); err != nil {
		return err
	}
	query := r.URL.Query()
	where, err := taskFilter(gym, query)
	if err != nil {
		return err
	}
	order, err := taskOrder(query.Get("sort"))
	if err != nil {
		return err
	}
	page := min(1_000_000, max(1, atoi(query.Get("page"), 1)))
	limit := min(maxPageSize, max(1, atoi(query.Get("limit"), defaultPageSize)))
	items, err := queryTasks(r.Context(), m.app.DB, where, order+" LIMIT "+strconv.Itoa(limit)+" OFFSET "+strconv.Itoa((page-1)*limit))
	if err != nil {
		return err
	}
	total, err := countTasks(r.Context(), m.app.DB, where)
	if err != nil {
		return err
	}
	if err := m.expand(r.Context(), items); err != nil {
		return err
	}
	if items == nil {
		items = []Task{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items, "page": page, "limit": limit, "total": total})
	return nil
}

// expand fills `expand` like PocketBase did, so `task.expand.route.name` keeps working.
func (m *module) expand(ctx context.Context, items []Task) error {
	var routeIDs, wallIDs, userIDs []string
	for _, t := range items {
		routeIDs = append(routeIDs, t.Route)
		wallIDs = append(wallIDs, t.Wall)
		userIDs = append(userIDs, t.Reporter, t.Assignee, t.DoneBy)
	}
	routes, err := routeSummaries(ctx, m.app.DB, routeIDs)
	if err != nil {
		return err
	}
	walls, err := wallRefs(ctx, m.app.DB, wallIDs)
	if err != nil {
		return err
	}
	people, err := m.climbers.Get(ctx, userIDs)
	if err != nil {
		return err
	}
	for i := range items {
		t := &items[i]
		t.Expand = map[string]any{}
		if route, ok := routes[t.Route]; ok {
			t.Expand["route"] = route
		}
		if wall, ok := walls[t.Wall]; ok {
			t.Expand["wall"] = wall
		}
		for key, id := range map[string]string{"reporter": t.Reporter, "assignee": t.Assignee, "done_by": t.DoneBy} {
			if climber, ok := people[id]; ok {
				t.Expand[key] = climber
			}
		}
	}
	return nil
}

func (m *module) respondTask(ctx context.Context, w http.ResponseWriter, status int, t Task) error {
	items := []Task{t}
	if err := m.expand(ctx, items); err != nil {
		return err
	}
	httpx.JSON(w, status, items[0])
	return nil
}

func (m *module) getTask(w http.ResponseWriter, r *http.Request) error {
	t, err := findTask(r.Context(), m.app.DB, r.PathValue("id"))
	if err != nil {
		return err
	}
	if err := m.requireManager(r.Context(), t.Gym); err != nil {
		return err
	}
	return m.respondTask(r.Context(), w, http.StatusOK, t)
}

func (m *module) postTask(w http.ResponseWriter, r *http.Request) error {
	gym, err := resolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	if _, signedIn := auth.From(r.Context()); !signedIn {
		if err := captcha.Request(r.Context(), m.app.DB, r, "task"); err != nil {
			return err
		}
	}
	in, photo, err := readInput(w, r)
	if err != nil {
		return err
	}
	t, err := m.createTask(r.Context(), gym, in, photo)
	if err != nil {
		return err
	}
	if !m.isManager(r.Context(), gym) {
		httpx.JSON(w, http.StatusCreated, map[string]string{"id": t.ID})
		return nil
	}
	return m.respondTask(r.Context(), w, http.StatusCreated, t)
}

func (m *module) patchTask(w http.ResponseWriter, r *http.Request) error {
	in, photo, err := readInput(w, r)
	if err != nil {
		return err
	}
	return m.update(w, r, in, photo)
}

func (m *module) update(w http.ResponseWriter, r *http.Request, in map[string]string, photo *multipart.FileHeader) error {
	t, err := m.updateTask(r.Context(), r.PathValue("id"), in, photo)
	if err != nil {
		return err
	}
	return m.respondTask(r.Context(), w, http.StatusOK, t)
}

func (m *module) assignTask(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Assignee *string `json:"assignee"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	assignee := ""
	if body.Assignee != nil {
		assignee = *body.Assignee
	}
	return m.update(w, r, map[string]string{"assignee": assignee}, nil)
}

func (m *module) setStatus(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Status         string  `json:"status"`
		ResolutionNote *string `json:"resolution_note"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	in := map[string]string{"status": body.Status}
	if body.ResolutionNote != nil {
		in["resolution_note"] = *body.ResolutionNote
	}
	return m.update(w, r, in, nil)
}

func (m *module) deleteTaskHandler(w http.ResponseWriter, r *http.Request) error {
	if err := m.deleteTask(r.Context(), r.PathValue("id")); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (m *module) listAssignees(w http.ResponseWriter, r *http.Request) error {
	gym, err := resolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	if err := m.requireManager(r.Context(), gym); err != nil {
		return err
	}
	items, err := listAssignees(r.Context(), m.app.DB, gym)
	if err != nil {
		return err
	}
	if items == nil {
		items = []Assignee{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	return nil
}

func (m *module) listGymDefects(w http.ResponseWriter, r *http.Request) error {
	gym, err := resolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	var routes []string
	if route := r.URL.Query().Get("route"); route != "" {
		routes = []string{route}
	}
	return m.respondDefects(r.Context(), w, gym, routes)
}

func (m *module) listRouteDefects(w http.ResponseWriter, r *http.Request) error {
	var gym string
	if err := m.app.DB.QueryRow(r.Context(), `SELECT gym FROM routes WHERE id = $1`, r.PathValue("id")).Scan(&gym); err != nil {
		return httpx.ErrNotFound
	}
	return m.respondDefects(r.Context(), w, gym, []string{r.PathValue("id")})
}

func (m *module) respondDefects(ctx context.Context, w http.ResponseWriter, gym string, routes []string) error {
	items, err := openDefects(ctx, m.app.DB, gym, routes)
	if err != nil {
		return err
	}
	if items == nil {
		items = []OpenDefect{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	return nil
}

// readInput accepts multipart (with an optional `photo`) or JSON; JSON null clears a field.
func readInput(w http.ResponseWriter, r *http.Request) (map[string]string, *multipart.FileHeader, error) {
	in := map[string]string{}
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		r.Body = http.MaxBytesReader(w, r.Body, maxPhotoBytes+1<<20)
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				return nil, nil, httpx.NewError(http.StatusRequestEntityTooLarge, "The file is too large.")
			}
			return nil, nil, badRequest("Invalid form body.")
		}
		for key, values := range r.MultipartForm.Value {
			if len(values) > 0 {
				in[key] = values[len(values)-1]
			}
		}
		var photo *multipart.FileHeader
		if files := r.MultipartForm.File["photo"]; len(files) > 0 {
			photo = files[0]
		}
		return in, photo, nil
	}
	var raw map[string]any
	if err := httpx.Decode(r, &raw); err != nil {
		return nil, nil, err
	}
	for key, value := range raw {
		switch v := value.(type) {
		case nil:
			in[key] = ""
		case string:
			in[key] = v
		case float64:
			in[key] = strconv.FormatFloat(v, 'f', -1, 64)
		default:
			return nil, nil, invalid(key, "Invalid value.")
		}
	}
	return in, nil, nil
}
