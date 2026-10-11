package tasks

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"

	"gripello/internal/platform"
	"gripello/internal/platform/captcha"
	"gripello/internal/platform/events"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/jobs"
	"gripello/internal/platform/testapp"
)

func TestDefaultTaskPriority(t *testing.T) {
	cases := []struct {
		kind, category string
		want           int
	}{
		{"defect", "loose_bolt", urgentTaskPriority},
		{"defect", "spinning_hold", urgentTaskPriority},
		{"defect", "label_tag", normalTaskPriority},
		{"reset", "loose_bolt", normalTaskPriority},
	}
	for _, c := range cases {
		if got := defaultTaskPriority(c.kind, c.category); got != c.want {
			t.Errorf("defaultTaskPriority(%q, %q) = %d, want %d", c.kind, c.category, got, c.want)
		}
	}
}

func TestRestrictToClimberReport(t *testing.T) {
	due := time.Now()
	task := Task{Kind: "reset", Title: "Strip wall", Assignee: "someone", DueDate: &due, Priority: 1, Category: "broken_hold"}
	restrictToClimberReport(&task)
	if task.Kind != "defect" || task.Priority != urgentTaskPriority {
		t.Errorf("climber report not forced to defect: %+v", task)
	}
	if task.Title != "" || task.Assignee != "" || task.DueDate != nil {
		t.Errorf("climber set staff fields: %+v", task)
	}
}

func TestRestrictToClimberReportKeepsWishes(t *testing.T) {
	task := Task{Kind: "wish", Assignee: "someone"}
	restrictToClimberReport(&task)
	if task.Kind != "wish" || task.Assignee != "" || task.Priority != normalTaskPriority {
		t.Errorf("climber wish not kept as a plain wish: %+v", task)
	}
}

func TestValidateWish(t *testing.T) {
	wish := Task{Kind: "wish", RouteType: "Boulder"}
	if validateTask(wish) == nil {
		t.Error("wish without location accepted")
	}
	wish.Location = "l1"
	if validateTask(wish) != nil {
		t.Error("complete wish rejected")
	}
	wish.Route = "r1"
	if validateTask(wish) == nil {
		t.Error("wish pointing to a route accepted")
	}
	wish.Route, wish.RouteType = "", ""
	if validateTask(wish) == nil {
		t.Error("wish without route type accepted")
	}
}

func TestValidateTask(t *testing.T) {
	defect := Task{Kind: "defect", Category: "loose_hold"}
	if validateTask(defect) == nil {
		t.Error("defect without route accepted")
	}
	defect.Route = "r1"
	if validateTask(defect) != nil {
		t.Error("complete defect rejected")
	}
	chore := Task{Kind: "maintenance"}
	if validateTask(chore) == nil {
		t.Error("task without title accepted")
	}
	chore.Title = "Clean holds"
	if validateTask(chore) != nil {
		t.Error("titled task rejected")
	}
}

func TestValidateFields(t *testing.T) {
	valid := Task{Kind: "maintenance", Status: "open", Priority: 2, Title: "x"}
	if err := validateFields(valid); err != nil {
		t.Fatal(err)
	}
	for name, broken := range map[string]func(*Task){
		"kind":     func(t *Task) { t.Kind = "party" },
		"status":   func(t *Task) { t.Status = "later" },
		"category": func(t *Task) { t.Category = "dirty" },
		"priority": func(t *Task) { t.Priority = 5 },
		"title":    func(t *Task) { t.Title = strings.Repeat("x", 201) },
	} {
		task := valid
		broken(&task)
		if validateFields(task) == nil {
			t.Errorf("invalid %s accepted", name)
		}
	}
}

func TestStampTaskDone(t *testing.T) {
	now := time.Now()
	earlier := now.Add(-time.Hour)
	task := Task{Status: "done"}
	stampTaskDone(&task, "open", "setter", now)
	if task.DoneAt == nil || !task.DoneAt.Equal(now) || task.DoneBy != "setter" {
		t.Errorf("closing did not stamp: %+v", task)
	}
	task.Status, task.DoneAt = "dismissed", &earlier
	stampTaskDone(&task, "done", "other", now)
	if !task.DoneAt.Equal(earlier) || task.DoneBy != "setter" {
		t.Errorf("closed-to-closed restamped: %+v", task)
	}
	task.Status = "open"
	stampTaskDone(&task, "dismissed", "other", now)
	if task.DoneAt != nil || task.DoneBy != "" {
		t.Errorf("reopening kept stamp: %+v", task)
	}
}

func TestWithoutUser(t *testing.T) {
	if got := withoutUser([]string{"a", "b"}, "a"); len(got) != 1 || got[0] != "b" {
		t.Errorf("withoutUser() = %v", got)
	}
}

func TestIsUrgentDefectTask(t *testing.T) {
	if !isUrgentDefect(Task{Kind: "defect", Priority: urgentTaskPriority}) {
		t.Error("urgent defect not detected")
	}
	if isUrgentDefect(Task{Kind: "defect", Priority: normalTaskPriority}) {
		t.Error("normal defect treated as urgent")
	}
	if isUrgentDefect(Task{Kind: "maintenance", Priority: urgentTaskPriority}) {
		t.Error("urgent staff task triggered a defect alert")
	}
}

func TestDefectFiledParamsNameTheGym(t *testing.T) {
	params := defectFiledParams("Crimp line", "Boulderhalle Nord")
	if params["route"] != "Crimp line" || params["gym"] != "Boulderhalle Nord" {
		t.Fatalf("params = %v", params)
	}
}

type fixture struct {
	t       *testing.T
	app     *platform.App
	handler http.Handler
	gymA    string
	gymB    string
	hall    string
	hallB   string
	wallA   string
	wallB   string
	route   string
	users   map[string]string
	tokens  map[string]string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	app := testapp.App(t)
	Register(app)
	f := &fixture{t: t, app: app, handler: testapp.Handler(app), users: map[string]string{}, tokens: map[string]string{}}
	f.gymA = f.exec(`INSERT INTO gyms (id, slug, name, active) VALUES ($1, 'alpha', 'Alpha', true) RETURNING id`, ids.New())
	f.gymB = f.exec(`INSERT INTO gyms (id, slug, name, active) VALUES ($1, 'beta', 'Beta', true) RETURNING id`, ids.New())
	f.user("setter", f.gymA, "manage_tasks")
	f.user("setter2", f.gymA, "manage_tasks", "manage_routes")
	f.user("member", f.gymA, "manage_routes")
	f.user("setterB", f.gymB, "manage_tasks")
	f.user("climber", "")
	f.hall = f.exec(`INSERT INTO locations (id, gym, name) VALUES ($1, $2, 'Hall') RETURNING id`, ids.New(), f.gymA)
	f.hallB = f.exec(`INSERT INTO locations (id, gym, name) VALUES ($1, $2, 'Hall') RETURNING id`, ids.New(), f.gymB)
	f.wallA = f.wall(f.gymA, f.hall)
	f.wallB = f.wall(f.gymB, f.hallB)
	f.route = f.newRoute(false)
	return f
}

func (f *fixture) exec(sql string, args ...any) string {
	f.t.Helper()
	var id string
	if err := f.app.DB.QueryRow(context.Background(), sql, args...).Scan(&id); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return id
}

func (f *fixture) user(name, gym string, permissions ...string) {
	f.t.Helper()
	id := f.exec(`INSERT INTO users (id, username, firstname, email, token_key) VALUES ($1, $2, $2, $3, $4) RETURNING id`,
		ids.New(), name, name+"@example.com", "key-"+name)
	if gym != "" {
		role := f.exec(`INSERT INTO roles (id, gym, name, permissions) VALUES ($1, $2, $3, $4) RETURNING id`, ids.New(), gym, name, permissions)
		f.exec(`INSERT INTO memberships (id, "user", gym, role) VALUES ($1, $2, $3, $4) RETURNING id`, ids.New(), id, gym, role)
	}
	token, err := f.app.Tokens.Sign(id, "key-"+name, "")
	if err != nil {
		f.t.Fatal(err)
	}
	f.users[name], f.tokens[name] = id, token
}

func (f *fixture) wall(gym, location string) string {
	return f.exec(`INSERT INTO walls (id, gym, location, name, outline, edge) VALUES ($1, $2, $3, 'North', '[]', '[]') RETURNING id`,
		ids.New(), gym, location)
}

func (f *fixture) newRoute(archived bool) string {
	return f.exec(`INSERT INTO routes (id, gym, name, grade, location, wall, archived) VALUES ($1, $2, 'Crimp', '6a', $3, $4, $5) RETURNING id`,
		ids.New(), f.gymA, f.hall, f.wallA, archived)
}

func (f *fixture) send(user string, request *http.Request, status int) map[string]any {
	f.t.Helper()
	if user != "" {
		request.Header.Set("Authorization", f.tokens[user])
	}
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, request)
	if recorder.Code != status {
		f.t.Fatalf("%s %s as %q = %d, want %d: %s", request.Method, request.URL, user, recorder.Code, status, recorder.Body.String())
	}
	out := map[string]any{}
	json.Unmarshal(recorder.Body.Bytes(), &out)
	return out
}

func (f *fixture) call(user, method, path, body string, status int) map[string]any {
	f.t.Helper()
	request := httptest.NewRequest(method, "/api"+path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	return f.send(user, request, status)
}

func (f *fixture) defect(user, category string) string {
	f.t.Helper()
	body := f.call(user, "POST", "/gyms/"+f.gymA+"/tasks", `{"kind":"defect","route":"`+f.route+`","category":"`+category+`"}`, http.StatusCreated)
	return body["id"].(string)
}

func (f *fixture) runUrgentAlerts() {
	f.t.Helper()
	if err := f.app.Workers[urgentAlertJob](context.Background(), jobs.Job{Key: f.gymA}); err != nil {
		f.t.Fatal(err)
	}
}

func (f *fixture) task(id string) Task {
	f.t.Helper()
	task, err := findTask(context.Background(), f.app.DB, id)
	if err != nil {
		f.t.Fatal(err)
	}
	return task
}

type eventRow struct {
	Topic, Kind string
	Payload     json.RawMessage
	Audience    json.RawMessage
}

func (f *fixture) events(kind string) []eventRow {
	f.t.Helper()
	rows, err := f.app.DB.Query(context.Background(), `SELECT topic, kind, payload, audience FROM events WHERE kind = $1 ORDER BY id`, kind)
	if err != nil {
		f.t.Fatal(err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (eventRow, error) {
		var e eventRow
		return e, row.Scan(&e.Topic, &e.Kind, &e.Payload, &e.Audience)
	})
	if err != nil {
		f.t.Fatal(err)
	}
	return out
}

func (f *fixture) notifications() []Notify {
	var out []Notify
	for _, e := range f.events(KindNotify) {
		var n Notify
		json.Unmarshal(e.Payload, &n)
		out = append(out, n)
	}
	return out
}

func items(body map[string]any) []any {
	list, _ := body["items"].([]any)
	return list
}

func TestTaskWallMustMatchTheRoute(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	task := Task{Gym: f.gymA, Route: f.route}
	if err := attachTarget(ctx, f.app.DB, &task, true); err != nil || task.Wall != f.wallA || task.Location != f.hall {
		t.Errorf("target from route = %+v (%v)", task, err)
	}
	task.Wall = f.wallB
	if attachTarget(ctx, f.app.DB, &task, true) == nil {
		t.Error("wall of another gym accepted")
	}
	foreign := Task{Gym: f.gymB, Route: f.route}
	if attachTarget(ctx, f.app.DB, &foreign, true) == nil {
		t.Error("route of another gym accepted")
	}
}

func TestClimberReportIsForcedToADefect(t *testing.T) {
	f := newFixture(t)
	body := `{"kind":"reset","title":"Strip","priority":1,"status":"done","assignee":"` + f.users["setter"] + `",
		"route":"` + f.route + `","category":"loose_bolt","resolution_note":"x","due_date":"2026-10-10"}`
	created := f.call("climber", "POST", "/gyms/"+f.gymA+"/tasks", body, http.StatusCreated)
	if _, leaked := created["kind"]; leaked {
		t.Errorf("climber sees the stored task: %v", created)
	}
	task := f.task(created["id"].(string))
	if task.Kind != "defect" || task.Title != "" || task.Assignee != "" || task.DueDate != nil || task.Status != "open" ||
		task.ResolutionNote != "" || task.Priority != urgentTaskPriority || task.Reporter != f.users["climber"] ||
		task.Location != f.hall || task.Wall != f.wallA {
		t.Errorf("climber report = %+v", task)
	}
}

func TestGuestsMayReportDefects(t *testing.T) {
	f := newFixture(t)
	id := f.defect("", "label_tag")
	if task := f.task(id); task.Reporter != "" || task.Priority != normalTaskPriority {
		t.Errorf("guest report = %+v", task)
	}
}

func TestDefectsAreRejectedWhenIncompleteOrArchived(t *testing.T) {
	f := newFixture(t)
	f.call("climber", "POST", "/gyms/"+f.gymA+"/tasks", `{"kind":"defect","route":"`+f.route+`"}`, http.StatusBadRequest)
	archived := f.newRoute(true)
	f.call("climber", "POST", "/gyms/"+f.gymA+"/tasks", `{"kind":"defect","category":"other","route":"`+archived+`"}`, http.StatusBadRequest)
	f.call("climber", "POST", "/gyms/"+f.gymB+"/tasks", `{"kind":"defect","category":"other","route":"`+f.route+`"}`, http.StatusBadRequest)
	f.call("climber", "POST", "/gyms/"+f.gymA+"/tasks", `{"kind":"defect","category":"dirty","route":"`+f.route+`"}`, http.StatusBadRequest)
}

func TestClimberWish(t *testing.T) {
	f := newFixture(t)
	f.call("climber", "POST", "/gyms/"+f.gymA+"/tasks", `{"kind":"wish","location":"`+f.hall+`"}`, http.StatusBadRequest)
	f.call("climber", "POST", "/gyms/"+f.gymA+"/tasks", `{"kind":"wish","location":"`+f.hallB+`","route_type":"Boulder"}`, http.StatusBadRequest)
	id := f.call("climber", "POST", "/gyms/"+f.gymA+"/tasks", `{"kind":"wish","location":"`+f.hall+`","route_type":"Boulder","grade":"6a"}`, http.StatusCreated)["id"].(string)
	if task := f.task(id); task.Kind != "wish" || task.Grade != "6a" || task.Priority != normalTaskPriority {
		t.Errorf("wish = %+v", task)
	}
	testapp.WaitFor(t, func() bool { return len(f.notifications()) == 1 })
	n := f.notifications()[0]
	if n.Type != "task_wish_filed" || n.Params["location"] != "Hall" || n.URL != "/alpha/manage/tasks" || len(n.Users) != 2 {
		t.Errorf("wish notification = %+v", n)
	}
}

func TestUrgentDefectNotifiesAndMailsManagers(t *testing.T) {
	f := newFixture(t)
	f.defect("setter", "loose_bolt")
	f.runUrgentAlerts()
	notes := f.notifications()
	if len(notes) != 1 || notes[0].Type != "task_defect_filed" || len(notes[0].Users) != 1 || notes[0].Users[0] != f.users["setter2"] ||
		notes[0].Params["route"] != "Crimp" || notes[0].Params["gym"] != "Alpha" {
		t.Fatalf("defect notifications = %+v", notes)
	}
	mails := testapp.Mails(f.app)
	if len(mails) != 1 || len(mails[0].To) != 1 || mails[0].To[0] != "setter2@example.com" {
		t.Fatalf("urgent mails = %+v", mails)
	}
	if !strings.Contains(mails[0].Text, "/route?id="+f.route) || !strings.Contains(mails[0].Text, "/alpha/manage/tasks") {
		t.Errorf("urgent mail text = %s", mails[0].Text)
	}
	f.defect("climber", "label_tag")
	f.runUrgentAlerts()
	if len(testapp.Mails(f.app)) != 1 {
		t.Error("normal defect sent an urgent mail")
	}
}

func TestStaffTasksAndAssignees(t *testing.T) {
	f := newFixture(t)
	gym := "/gyms/" + f.gymA + "/tasks"
	f.call("setter", "POST", gym, `{"kind":"maintenance"}`, http.StatusBadRequest)
	f.call("setter", "POST", gym, `{"kind":"maintenance","title":"Clean","assignee":"`+f.users["member"]+`"}`, http.StatusBadRequest)
	f.call("setter", "POST", gym, `{"kind":"maintenance","title":"Clean","assignee":"`+f.users["setterB"]+`"}`, http.StatusBadRequest)
	created := f.call("setter", "POST", gym, `{"kind":"maintenance","title":"Clean","priority":1,"wall":"`+f.wallA+`","assignee":"`+f.users["setter2"]+`"}`, http.StatusCreated)
	if created["priority"].(float64) != 1 || created["location"] != f.hall || created["reporter"] != f.users["setter"] {
		t.Errorf("staff task = %v", created)
	}
	if assignee := created["expand"].(map[string]any)["assignee"].(map[string]any); assignee["id"] != f.users["setter2"] {
		t.Errorf("expand.assignee = %v", assignee)
	}
	var actor string
	f.app.DB.QueryRow(context.Background(), `SELECT actor FROM events WHERE kind = 'task.created'`).Scan(&actor)
	changes := f.events("task.created")
	var change TaskChange
	if len(changes) == 1 {
		json.Unmarshal(changes[0].Payload, &change)
	}
	if len(changes) != 1 || actor != f.users["setter"] || change.Action != "create" || change.Record.ID != created["id"] ||
		change.Record.Title != "Clean" || changes[0].Topic != "tasks:"+f.gymA || string(changes[0].Audience) != `{"gym_perm": "`+f.gymA+`:manage_tasks"}` {
		t.Errorf("task.created = %+v actor %q", change, actor)
	}
	notes := f.notifications()
	if len(notes) != 1 || notes[0].Type != "task_assigned" || notes[0].Users[0] != f.users["setter2"] || notes[0].Params["title"] != "Clean" {
		t.Errorf("assign notifications = %+v", notes)
	}
	list := items(f.call("setter", "GET", "/gyms/alpha/tasks/assignees", "", http.StatusOK))
	if len(list) != 2 {
		t.Errorf("assignees = %v", list)
	}
	f.call("climber", "GET", "/gyms/alpha/tasks/assignees", "", http.StatusForbidden)
}

func TestTaskReadsNeedManageTasks(t *testing.T) {
	f := newFixture(t)
	id := f.defect("climber", "other")
	f.call("", "GET", "/gyms/"+f.gymA+"/tasks", "", http.StatusUnauthorized)
	f.call("climber", "GET", "/gyms/"+f.gymA+"/tasks", "", http.StatusForbidden)
	f.call("setterB", "GET", "/gyms/"+f.gymA+"/tasks", "", http.StatusForbidden)
	f.call("member", "GET", "/tasks/"+id, "", http.StatusForbidden)
	f.call("climber", "PATCH", "/tasks/"+id, `{"status":"done"}`, http.StatusForbidden)
	f.call("climber", "DELETE", "/tasks/"+id, "", http.StatusForbidden)
	got := f.call("setter", "GET", "/tasks/"+id, "", http.StatusOK)
	expand := got["expand"].(map[string]any)
	if expand["route"].(map[string]any)["name"] != "Crimp" || expand["reporter"].(map[string]any)["id"] != f.users["climber"] {
		t.Errorf("expand = %v", expand)
	}
}

func TestListFilters(t *testing.T) {
	f := newFixture(t)
	defect := f.defect("climber", "other")
	f.call("setter", "POST", "/gyms/"+f.gymA+"/tasks", `{"kind":"reset","title":"Strip the north wall"}`, http.StatusCreated)
	f.call("setter", "POST", "/tasks/"+defect+"/status", `{"status":"done"}`, http.StatusOK)
	list := func(query string) []any {
		return items(f.call("setter", "GET", "/gyms/alpha/tasks?"+query, "", http.StatusOK))
	}
	if got := list(""); len(got) != 2 {
		t.Errorf("all = %d", len(got))
	}
	if got := list("status=open&status=waiting"); len(got) != 1 || got[0].(map[string]any)["kind"] != "reset" {
		t.Errorf("open = %v", got)
	}
	if got := list("kind=defect&route=" + f.route); len(got) != 1 {
		t.Errorf("defects of route = %v", got)
	}
	if got := list("q=strip"); len(got) != 1 {
		t.Errorf("search = %v", got)
	}
	if got := list("q=crimp"); len(got) != 1 || got[0].(map[string]any)["id"] != defect {
		t.Errorf("search by route name = %v", got)
	}
	if got := list("assignee=none&sort=-done_at"); len(got) != 2 {
		t.Errorf("unassigned = %v", got)
	}
	if got := list("q=nort"); len(got) != 2 {
		t.Errorf("search by wall name = %v", got)
	}
	if got := list("urgent=true"); len(got) != 0 {
		t.Errorf("urgent = %v", got)
	}
	urgent := f.defect("climber", "loose_bolt")
	if got := list("urgent=true"); len(got) != 1 || got[0].(map[string]any)["id"] != urgent {
		t.Errorf("urgent = %v", got)
	}
	gym := "/gyms/" + f.gymA + "/tasks"
	overdue := f.call("setter", "POST", gym, `{"kind":"reset","title":"late","due_date":"2020-01-01"}`, http.StatusCreated)["id"].(string)
	closedLate := f.call("setter", "POST", gym, `{"kind":"reset","title":"late done","due_date":"2020-01-01"}`, http.StatusCreated)["id"].(string)
	f.call("setter", "POST", "/tasks/"+closedLate+"/status", `{"status":"done"}`, http.StatusOK)
	f.call("setter", "POST", gym, `{"kind":"reset","title":"later","due_date":"2999-01-01"}`, http.StatusCreated)
	if got := list("overdue=true"); len(got) != 1 || got[0].(map[string]any)["id"] != overdue {
		t.Errorf("overdue = %v", got)
	}
	f.call("setter", "GET", "/gyms/alpha/tasks?status=later", "", http.StatusBadRequest)
	f.call("setter", "GET", "/gyms/alpha/tasks?sort=title", "", http.StatusBadRequest)
}

func TestUpdateLocksServerFieldsAndStampsDone(t *testing.T) {
	f := newFixture(t)
	id := f.defect("climber", "other")
	body := `{"kind":"reset","reporter":"` + f.users["setter"] + `","done_by":"` + f.users["setter"] + `","status":"done","resolution_note":"Fixed"}`
	updated := f.call("setter", "PATCH", "/tasks/"+id, body, http.StatusOK)
	if updated["kind"] != "defect" || updated["reporter"] != f.users["climber"] || updated["done_by"] != f.users["setter"] ||
		updated["done_at"] == nil || updated["resolution_note"] != "Fixed" {
		t.Errorf("updated = %v", updated)
	}
	var fixed *Notify
	for _, n := range f.notifications() {
		if n.Type == "task_defect_fixed" {
			fixed = &n
		}
	}
	if fixed == nil || fixed.Users[0] != f.users["climber"] || fixed.URL != "/route?id="+f.route {
		t.Errorf("reporter notification = %+v", f.notifications())
	}
	reopened := f.call("setter", "POST", "/tasks/"+id+"/status", `{"status":"waiting"}`, http.StatusOK)
	if reopened["done_at"] != nil || reopened["done_by"] != "" {
		t.Errorf("reopened = %v", reopened)
	}
	f.call("setter", "POST", "/tasks/"+id+"/assign", `{"assignee":"`+f.users["member"]+`"}`, http.StatusBadRequest)
	if assigned := f.call("setter", "POST", "/tasks/"+id+"/assign", `{"assignee":"`+f.users["setter2"]+`"}`, http.StatusOK); assigned["assignee"] != f.users["setter2"] {
		t.Errorf("assigned = %v", assigned)
	}
	if cleared := f.call("setter", "POST", "/tasks/"+id+"/assign", `{"assignee":null}`, http.StatusOK); cleared["assignee"] != "" {
		t.Errorf("unassigned = %v", cleared)
	}
	f.call("setter", "PATCH", "/tasks/"+id, `{"wall":"`+f.wallB+`"}`, http.StatusBadRequest)
}

func TestDefectChangesReachOpenRouteDefects(t *testing.T) {
	f := newFixture(t)
	id := f.defect("climber", "loose_hold")
	open := items(f.call("", "GET", "/gyms/alpha/defects/open", "", http.StatusOK))
	if len(open) != 1 || open[0].(map[string]any)["category"] != "loose_hold" {
		t.Errorf("open defects = %v", open)
	}
	if got := items(f.call("", "GET", "/routes/"+f.route+"/defects", "", http.StatusOK)); len(got) != 1 {
		t.Errorf("route defects = %v", got)
	}
	if got := items(f.call("", "GET", "/gyms/alpha/defects/open?route=other", "", http.StatusOK)); len(got) != 0 {
		t.Errorf("other route defects = %v", got)
	}
	f.call("setter", "DELETE", "/tasks/"+id, "", http.StatusNoContent)
	var deletion TaskChange
	if deletes := f.events("task.deleted"); len(deletes) == 1 {
		json.Unmarshal(deletes[0].Payload, &deletion)
	}
	if deletion.Action != "delete" || deletion.Record.ID != id {
		t.Errorf("task.deleted = %+v", deletion)
	}
	changes := f.events(KindDefectsChange)
	if len(changes) != 2 || changes[0].Topic != "open_route_defects:"+f.gymA || string(changes[0].Audience) != `{"public": true}` {
		t.Fatalf("defect events = %+v", changes)
	}
	var created, deleted OpenDefectsChange
	json.Unmarshal(changes[0].Payload, &created)
	json.Unmarshal(changes[1].Payload, &deleted)
	if created.Gym != f.gymA || len(created.Routes) != 1 || len(created.Defects) != 1 || created.Defects[0].ID != id ||
		len(deleted.Defects) != 0 || deleted.Routes[0] != f.route {
		t.Errorf("payloads = %+v / %+v", created, deleted)
	}
	f.call("setter", "POST", "/gyms/"+f.gymA+"/tasks", `{"kind":"reset","title":"x"}`, http.StatusCreated)
	if len(f.events(KindDefectsChange)) != 2 {
		t.Error("staff task without a route published a defect change")
	}
}

func TestDefectPhotoUpload(t *testing.T) {
	f := newFixture(t)
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	form.WriteField("kind", "defect")
	form.WriteField("route", f.route)
	form.WriteField("category", "broken_hold")
	part, _ := form.CreateFormFile("photo", "Broken Hold.png")
	part.Write([]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"))
	form.Close()
	request := httptest.NewRequest("POST", "/api/gyms/alpha/tasks", &body)
	request.Header.Set("Content-Type", form.FormDataContentType())
	id := f.send("climber", request, http.StatusCreated)["id"].(string)
	f.runUrgentAlerts()
	task := f.task(id)
	if !strings.HasPrefix(task.Photo, "broken_hold_") {
		t.Fatalf("photo = %q", task.Photo)
	}
	if file, err := f.app.Blob.Open(context.Background(), "tasks/"+id+"/"+task.Photo); err != nil {
		t.Errorf("stored photo: %v", err)
	} else {
		file.Close()
	}
	if mails := testapp.Mails(f.app); len(mails) != 1 || !strings.Contains(mails[0].Text, "photo") {
		t.Errorf("urgent mail misses the photo line: %+v", mails)
	}
}

func publish(t *testing.T, app *platform.App, topic, kind string, payload any) {
	t.Helper()
	err := pgx.BeginFunc(context.Background(), app.DB, func(tx pgx.Tx) error {
		return events.Publish(context.Background(), tx, topic, kind, payload, events.Audience{})
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestArchivedRouteClosesOpenTasks(t *testing.T) {
	f := newFixture(t)
	open := f.defect("climber", "other")
	waiting := f.defect("climber", "label_tag")
	f.call("setter", "POST", "/tasks/"+waiting+"/status", `{"status":"waiting"}`, http.StatusOK)
	dismissed := f.defect("climber", "other")
	f.call("setter", "POST", "/tasks/"+dismissed+"/status", `{"status":"dismissed"}`, http.StatusOK)
	publish(t, f.app, "route.archived", "route.archived", map[string]string{"route": f.route, "gym": f.gymA})
	testapp.WaitFor(t, func() bool { return f.task(open).Status == "done" && f.task(waiting).Status == "done" })
	if task := f.task(open); task.DoneAt == nil {
		t.Errorf("closed task without done_at: %+v", task)
	}
	if f.task(dismissed).Status != "dismissed" {
		t.Error("dismissed task reopened as done")
	}
	testapp.WaitFor(t, func() bool {
		changes := f.events(KindDefectsChange)
		var last OpenDefectsChange
		json.Unmarshal(changes[len(changes)-1].Payload, &last)
		return len(last.Defects) == 0 && len(last.Routes) == 1
	})
}

func TestLosingManageTasksUnassignsOpenTasks(t *testing.T) {
	f := newFixture(t)
	gym := "/gyms/" + f.gymA + "/tasks"
	open := f.call("setter", "POST", gym, `{"kind":"reset","title":"a","assignee":"`+f.users["setter2"]+`"}`, http.StatusCreated)["id"].(string)
	done := f.call("setter", "POST", gym, `{"kind":"reset","title":"b","assignee":"`+f.users["setter2"]+`"}`, http.StatusCreated)["id"].(string)
	f.call("setter", "POST", "/tasks/"+done+"/status", `{"status":"done"}`, http.StatusOK)
	kept := f.call("setter", "POST", gym, `{"kind":"reset","title":"c","assignee":"`+f.users["setter"]+`"}`, http.StatusCreated)["id"].(string)

	f.exec(`UPDATE roles SET permissions = '{manage_routes}' WHERE name = 'setter2' RETURNING id`)
	publish(t, f.app, "gym:"+f.gymA, "role.changed", map[string]any{
		"action": "updated", "gym": f.gymA, "users": []string{f.users["setter2"], f.users["setter"]}, "removed": []string{"manage_tasks"},
	})
	testapp.WaitFor(t, func() bool { return f.task(open).Assignee == "" })
	if f.task(done).Assignee != f.users["setter2"] || f.task(kept).Assignee != f.users["setter"] {
		t.Error("done task or remaining manager unassigned")
	}

	other := f.call("setter", "POST", gym, `{"kind":"reset","title":"d","assignee":"`+f.users["setter"]+`"}`, http.StatusCreated)["id"].(string)
	f.exec(`DELETE FROM memberships WHERE "user" = $1 RETURNING id`, f.users["setter"])
	publish(t, f.app, "gym:"+f.gymA, "membership.changed", map[string]any{
		"action": "deleted", "gym": f.gymA, "users": []string{f.users["setter"]}, "removed": []string{"manage_tasks"},
	})
	testapp.WaitFor(t, func() bool { return f.task(other).Assignee == "" && f.task(kept).Assignee == "" })
}

func TestGuestReportsNeedTheCaptcha(t *testing.T) {
	t.Setenv("CAP_SECRET", "cap-secret")
	f := newFixture(t)
	body := `{"kind":"defect","route":"` + f.route + `","category":"other"}`
	post := func(user, token string, status int) {
		request := httptest.NewRequest("POST", "/api/gyms/alpha/tasks", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		if token != "" {
			request.Header.Set(captcha.Header, token)
		}
		f.send(user, request, status)
	}
	signed := func(scope, jti string) string {
		token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"scope": scope, "jti": jti, "exp": time.Now().Add(time.Minute).Unix()}).
			SignedString([]byte("cap-secret"))
		return token
	}
	post("", "", http.StatusBadRequest)
	post("", signed("login", "a"), http.StatusBadRequest)
	post("", signed("task", "b"), http.StatusCreated)
	post("", signed("task", "b"), http.StatusBadRequest)
	post("climber", "", http.StatusCreated)
}

func TestUrgentDefectMailsAreCoalescedPerGym(t *testing.T) {
	f := newFixture(t)
	runAfter := func() time.Duration {
		var at time.Time
		if err := f.app.DB.QueryRow(context.Background(), `SELECT run_after FROM jobs WHERE kind = $1 AND key = $2`, urgentAlertJob, f.gymA).Scan(&at); err != nil {
			t.Fatal(err)
		}
		return time.Until(at)
	}
	f.defect("climber", "loose_bolt")
	if wait := runAfter(); wait > time.Second {
		t.Errorf("first alert waits %s", wait)
	}
	f.runUrgentAlerts()
	f.exec(`DELETE FROM jobs RETURNING id`)
	f.defect("climber", "loose_hold")
	f.defect("climber", "broken_hold")
	if wait := runAfter(); wait < urgentAlertWindow-5*time.Second {
		t.Errorf("follow-up alert waits only %s", wait)
	}
	f.runUrgentAlerts()
	mails := testapp.Mails(f.app)
	if len(mails) != 2 || len(mails[0].To) != 2 || strings.Count(mails[1].Text, "/route?id=") != 2 {
		t.Fatalf("urgent mails = %+v", mails)
	}
	f.runUrgentAlerts()
	if len(testapp.Mails(f.app)) != 2 {
		t.Error("alerted defects mailed again")
	}
}

func TestBulkTaskChangesReachTheBoard(t *testing.T) {
	f := newFixture(t)
	f.defect("climber", "other")
	before := len(f.events("task.updated"))
	publish(t, f.app, "route.archived", "route.archived", map[string]string{"route": f.route, "gym": f.gymA})
	testapp.WaitFor(t, func() bool { return len(f.events("task.updated")) == before+1 })
	assigned := f.call("setter", "POST", "/gyms/"+f.gymA+"/tasks", `{"kind":"reset","title":"a","assignee":"`+f.users["setter2"]+`"}`, http.StatusCreated)["id"].(string)
	f.exec(`UPDATE roles SET permissions = '{manage_routes}' WHERE name = 'setter2' RETURNING id`)
	publish(t, f.app, "gym:"+f.gymA, "role.changed", map[string]any{
		"action": "updated", "gym": f.gymA, "users": []string{f.users["setter2"]}, "removed": []string{"manage_tasks"},
	})
	testapp.WaitFor(t, func() bool {
		updates := f.events("task.updated")
		var last TaskChange
		json.Unmarshal(updates[len(updates)-1].Payload, &last)
		return last.Record.ID == assigned && last.Record.Assignee == ""
	})
}

func TestHiddenReportStaysHidden(t *testing.T) {
	f := newFixture(t)
	id := f.defect("climber", "other")
	f.exec(`INSERT INTO moderation_items (id, gym, content_type, content_id, snapshot, files, state) VALUES ($1, $2, 'task', $3, '{}', '{}', 'hidden') RETURNING id`,
		ids.New(), f.gymA, id)
	f.call("setter", "PATCH", "/tasks/"+id, `{"description":"back"}`, http.StatusForbidden)
	f.call("setter", "POST", "/tasks/"+id+"/status", `{"status":"done"}`, http.StatusOK)
}
