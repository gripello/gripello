package hooks

import (
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

func newTaskRecord() *core.Record {
	collection := core.NewBaseCollection("tasks")
	collection.Fields.Add(&core.NumberField{Name: "priority"})
	for _, name := range []string{"kind", "title", "category", "status", "route", "assignee", "due_date", "done_by", "description", "photo"} {
		collection.Fields.Add(&core.TextField{Name: name})
	}
	collection.Fields.Add(&core.DateField{Name: "done_at"})
	return core.NewRecord(collection)
}

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

func TestRestrictToDefectReport(t *testing.T) {
	task := newTaskRecord()
	task.Set("kind", "reset")
	task.Set("title", "Strip wall")
	task.Set("assignee", "someone")
	task.Set("due_date", "2026-10-10")
	task.Set("priority", 1)
	task.Set("category", "broken_hold")

	restrictToDefectReport(task)

	if task.GetString("kind") != "defect" || task.GetInt("priority") != urgentTaskPriority {
		t.Errorf("climber report not forced to defect: %v", task.PublicExport())
	}
	for _, field := range []string{"title", "assignee", "due_date"} {
		if task.GetString(field) != "" {
			t.Errorf("climber set staff field %q", field)
		}
	}
}

func TestValidateTask(t *testing.T) {
	defect := newTaskRecord()
	defect.Set("kind", "defect")
	defect.Set("category", "loose_hold")
	if validateTask(defect) == nil {
		t.Error("defect without route accepted")
	}
	defect.Set("route", "r1")
	if validateTask(defect) != nil {
		t.Error("complete defect rejected")
	}

	chore := newTaskRecord()
	chore.Set("kind", "maintenance")
	if validateTask(chore) == nil {
		t.Error("task without title accepted")
	}
	chore.Set("title", "Clean holds")
	if validateTask(chore) != nil {
		t.Error("titled task rejected")
	}
}

func TestStampTaskDone(t *testing.T) {
	now := types.NowDateTime()
	earlier := now.Add(-time.Hour)

	task := newTaskRecord()
	task.Set("status", "done")
	stampTaskDone(task, "open", "setter", now)
	if task.GetDateTime("done_at") != now || task.GetString("done_by") != "setter" {
		t.Errorf("closing did not stamp: %v", task.PublicExport())
	}

	task.Set("status", "dismissed")
	task.Set("done_at", earlier)
	stampTaskDone(task, "done", "other", now)
	if task.GetDateTime("done_at") != earlier || task.GetString("done_by") != "setter" {
		t.Errorf("closed-to-closed restamped: %v", task.PublicExport())
	}

	task.Set("status", "open")
	stampTaskDone(task, "dismissed", "other", now)
	if !task.GetDateTime("done_at").IsZero() || task.GetString("done_by") != "" {
		t.Errorf("reopening kept stamp: %v", task.PublicExport())
	}
}

func TestWithoutUser(t *testing.T) {
	collection := core.NewBaseCollection("users")
	a, b := core.NewRecord(collection), core.NewRecord(collection)
	a.Id, b.Id = "a", "b"
	if got := withoutUser([]*core.Record{a, b}, "a"); len(got) != 1 || got[0].Id != "b" {
		t.Errorf("withoutUser() = %v", got)
	}
}

func TestIsUrgentDefectTask(t *testing.T) {
	task := newTaskRecord()
	task.Set("kind", "defect")
	task.Set("priority", urgentTaskPriority)
	if !isUrgentDefectTask(task) {
		t.Error("urgent defect not detected")
	}
	task.Set("priority", normalTaskPriority)
	if isUrgentDefectTask(task) {
		t.Error("normal defect treated as urgent")
	}
	task.Set("kind", "maintenance")
	task.Set("priority", urgentTaskPriority)
	if isUrgentDefectTask(task) {
		t.Error("urgent staff task triggered a defect alert")
	}
}

func TestUrgentDefectAlertEscapesClimberText(t *testing.T) {
	task := newTaskRecord()
	task.Set("category", "loose_bolt")
	task.Set("route", "r1")
	task.Set("description", "<script>alert(1)</script>")

	body := urgentDefectAlertHTML("https://gym.example", "/demo/manage/tasks", "<b>Arete</b>", task)

	if strings.Contains(body, "<script>") || strings.Contains(body, "<b>Arete</b>") {
		t.Errorf("unescaped climber text in mail: %s", body)
	}
	for _, want := range []string{"Loose bolt / screw", "https://gym.example/route?id=r1", "https://gym.example/demo/manage/tasks"} {
		if !strings.Contains(body, want) {
			t.Errorf("mail lacks %q: %s", want, body)
		}
	}
}

func TestDefectFiledParamsNameTheGym(t *testing.T) {
	params := defectFiledParams("Crimp line", "Boulderhalle Nord")
	if params["route"] != "Crimp line" || params["gym"] != "Boulderhalle Nord" {
		t.Fatalf("params = %v", params)
	}
}
