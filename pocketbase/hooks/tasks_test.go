package hooks

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

func newTaskRecord() *core.Record {
	collection := core.NewBaseCollection("tasks")
	collection.Fields.Add(&core.NumberField{Name: "priority"})
	for _, name := range []string{"kind", "title", "category", "status", "route", "assignee", "due_date", "done_by", "description", "photo", "location", "route_type", "grade"} {
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

func TestRestrictToClimberReport(t *testing.T) {
	task := newTaskRecord()
	task.Set("kind", "reset")
	task.Set("title", "Strip wall")
	task.Set("assignee", "someone")
	task.Set("due_date", "2026-10-10")
	task.Set("priority", 1)
	task.Set("category", "broken_hold")

	restrictToClimberReport(task)

	if task.GetString("kind") != "defect" || task.GetInt("priority") != urgentTaskPriority {
		t.Errorf("climber report not forced to defect: %v", task.PublicExport())
	}
	for _, field := range []string{"title", "assignee", "due_date"} {
		if task.GetString(field) != "" {
			t.Errorf("climber set staff field %q", field)
		}
	}
}

func TestRestrictToClimberReportKeepsWishes(t *testing.T) {
	task := newTaskRecord()
	task.Set("kind", "wish")
	task.Set("assignee", "someone")

	restrictToClimberReport(task)

	if task.GetString("kind") != "wish" || task.GetString("assignee") != "" || task.GetInt("priority") != normalTaskPriority {
		t.Errorf("climber wish not kept as a plain wish: %v", task.PublicExport())
	}
}

func TestValidateWish(t *testing.T) {
	wish := newTaskRecord()
	wish.Set("kind", "wish")
	wish.Set("route_type", "Boulder")
	if validateTask(wish) == nil {
		t.Error("wish without location accepted")
	}
	wish.Set("location", "l1")
	if validateTask(wish) != nil {
		t.Error("complete wish rejected")
	}
	wish.Set("route", "r1")
	if validateTask(wish) == nil {
		t.Error("wish pointing to a route accepted")
	}
	wish.Set("route", "")
	wish.Set("route_type", "")
	if validateTask(wish) == nil {
		t.Error("wish without route type accepted")
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

func TestDefectFiledParamsNameTheGym(t *testing.T) {
	params := defectFiledParams("Crimp line", "Boulderhalle Nord")
	if params["route"] != "Crimp line" || params["gym"] != "Boulderhalle Nord" {
		t.Fatalf("params = %v", params)
	}
}

func TestTaskWallMustMatchTheRoute(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()

	wallIn := func(locationID string) *core.Record {
		return saveRecord(t, f.app, "walls", map[string]any{
			"location": locationID, "name": "North",
			"outline": [][]float64{{2, 2}, {38, 2}, {38, 5}, {2, 5}}, "edge": [][]float64{{2, 5}, {38, 5}},
		})
	}
	floorPlan := map[string]any{"width": 40, "height": 30, "shapes": []any{
		map[string]any{"kind": "floor", "points": [][]float64{{0, 0}, {40, 0}, {40, 30}, {0, 30}}},
	}}
	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id, "map": floorPlan})
	otherHall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymB.Id, "map": floorPlan})
	ownWall, foreignWall := wallIn(hall.Id), wallIn(otherHall.Id)
	route := saveRecord(t, f.app, "routes", map[string]any{"name": "Crimp", "grade": "6a", "creator": []string{"S"}, "location": hall.Id, "wall": ownWall.Id})

	tasks, err := f.app.FindCollectionByNameOrId("tasks")
	if err != nil {
		t.Fatal(err)
	}
	task := core.NewRecord(tasks)
	task.Set("route", route.Id)
	if err := attachTaskTarget(f.app, task, true); err != nil || task.GetString("wall") != ownWall.Id {
		t.Errorf("wall from route = %q (%v)", task.GetString("wall"), err)
	}
	task.Set("wall", foreignWall.Id)
	if attachTaskTarget(f.app, task, true) == nil {
		t.Error("wall of another gym accepted")
	}
}
