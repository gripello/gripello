package routes

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseGymMap(t *testing.T) {
	cases := map[string]bool{
		`null`: true,
		`{"width":40,"height":30,"shapes":[{"kind":"floor","points":[[0,0],[40,0],[40,30]]}]}`: true,
		`{"width":40,"height":30,"shapes":[{"kind":"floor","points":[[0,0],[41,0],[40,30]]}]}`: false,
		`{"width":40,"height":30,"shapes":[{"kind":"lava","points":[[0,0],[1,0],[1,1]]}]}`:     false,
		`{"width":40,"height":30,"shapes":[{"kind":"mat","points":[[0,0],[1,0]]}]}`:            false,
		`{"width":1,"height":30,"shapes":[]}`:                                                  false,
		`"not a map"`:                                                                          false,
	}
	for raw, valid := range cases {
		_, err := parseGymMap(json.RawMessage(raw))
		if (err == nil) != valid {
			t.Errorf("parseGymMap(%s) error = %v, want valid %v", raw, err, valid)
		}
	}
}

func TestPathLength(t *testing.T) {
	if got := pathLength([]mapPoint{{0, 0}, {3, 4}, {3, 10}}); got != 11 {
		t.Fatalf("pathLength() = %v, want 11", got)
	}
	if got := pathLength([]mapPoint{{2, 2}, {2, 2}}); got != 0 {
		t.Fatalf("pathLength() = %v, want 0", got)
	}
}

func TestClampUnit(t *testing.T) {
	for value, want := range map[float64]float64{-1: 0, 0.4: 0.4, 3: 1} {
		if got := clampUnit(value); got != want {
			t.Errorf("clampUnit(%v) = %v, want %v", value, got, want)
		}
	}
}

func TestWallValidation(t *testing.T) {
	f := newFixture(t)
	post := func(location, shape string, status int) {
		t.Helper()
		f.call("admin", "POST", "/gyms/"+f.gymA+"/walls", `{"location":"`+location+`","name":"W"`+shape+`}`, status)
	}
	valid := `,"outline":[[1,1],[2,1],[2,2]],"edge":[[1,1],[2,1]]`
	post(f.hallB, valid, http.StatusBadRequest)
	post(f.otherGym, valid, http.StatusBadRequest)
	post(f.hall, `,"outline":[[1,1],[2,1]],"edge":[[1,1],[2,1]]`, http.StatusBadRequest)
	post(f.hall, `,"outline":[[1,1],[2,1],[2,2]],"edge":[[1,1]]`, http.StatusBadRequest)
	post(f.hall, `,"outline":[[1,1],[2,1],[2,2]],"edge":[[1,1],[1,1]]`, http.StatusBadRequest)
	post(f.hall, `,"outline":[[1,1],[2,1],[2,99]],"edge":[[1,1],[2,1]]`, http.StatusBadRequest)
	post(f.hall, valid+`,"label":[50,50]`, http.StatusBadRequest)
	f.call("climber", "POST", "/gyms/"+f.gymA+"/walls", `{"location":"`+f.hall+`","name":"W"`+valid+`}`, http.StatusForbidden)
	f.call("operator", "POST", "/gyms/"+f.gymA+"/walls", `{"location":"`+f.hall+`","name":"Operator"`+valid+`}`, http.StatusCreated)
	post(f.hall, valid+`,"label":[5,5]`, http.StatusCreated)
	post(f.hall, valid, http.StatusBadRequest)

	walls := items(f.call("", "GET", "/gyms/"+f.gymA+"/walls?location="+f.hall, "", http.StatusOK))
	if len(walls) != 2 {
		t.Fatalf("walls = %v", walls)
	}
	id := walls[0].(map[string]any)["id"].(string)
	f.call("admin", "PATCH", "/walls/"+id, `{"edge":[[1,1]]}`, http.StatusBadRequest)
	f.call("admin", "PATCH", "/walls/"+id, `{"location":"`+f.otherGym+`"}`, http.StatusBadRequest)
	f.call("admin", "PATCH", "/walls/"+id, `{"sort":3,"label":null}`, http.StatusOK)
}

func TestWallDeleteBlockedByActiveRoutes(t *testing.T) {
	f := newFixture(t)
	wall := f.wall(f.hall, "Slab")
	route := f.route(`,"wall":"` + wall + `"`)
	f.call("setter", "DELETE", "/walls/"+wall, "", http.StatusForbidden)
	f.call("admin", "DELETE", "/walls/"+wall, "", http.StatusBadRequest)
	f.call("setter", "POST", "/routes/"+route+"/archive", "", http.StatusOK)
	f.call("admin", "DELETE", "/walls/"+wall, "", http.StatusNoContent)
	if got := f.call("", "GET", "/routes/"+route, "", http.StatusOK)["wall"]; got != "" {
		t.Fatalf("archived route kept deleted wall %v", got)
	}
}

func TestLocationLifecycle(t *testing.T) {
	f := newFixture(t)
	f.call("setter", "POST", "/gyms/"+f.gymA+"/locations", `{"name":"Loft"}`, http.StatusForbidden)
	f.call("admin", "POST", "/gyms/"+f.gymA+"/locations", `{"name":"hall"}`, http.StatusBadRequest)
	f.call("admin", "POST", "/gyms/"+f.gymA+"/locations", `{"name":"Loft","map":{"width":1}}`, http.StatusBadRequest)
	loft := f.call("operator", "POST", "/gyms/"+f.gymA+"/locations", `{"name":"Loft"}`, http.StatusCreated)["id"].(string)
	if list := items(f.call("", "GET", "/gyms/"+f.gymA+"/locations", "", http.StatusOK)); len(list) != 3 {
		t.Fatalf("locations = %v", list)
	}

	f.call("setter", "POST", "/gyms/"+f.gymA+"/routes", `{"name":"x","grade":"6a","location":"`+loft+`","archived":true}`, http.StatusCreated)
	f.call("admin", "DELETE", "/locations/"+loft, "", http.StatusBadRequest)
	f.wall(f.hall, "Slab")
	f.call("admin", "DELETE", "/locations/"+f.hall, "", http.StatusBadRequest)
	f.call("admin", "DELETE", "/locations/"+f.hallB, "", http.StatusNoContent)
}

func TestFloorPlanSave(t *testing.T) {
	f := newFixture(t)
	old := f.wall(f.hall, "Old")
	kept := f.wall(f.hall, "Kept")
	shape := `"outline":[[1,1],[2,1],[2,2]],"edge":[[1,1],[2,1]]`
	body := `{"map":{"width":30,"height":30,"shapes":[]},"removed":["` + old + `"],"walls":[{"name":"Old",` + shape + `},{"id":"` + kept + `","name":"Kept",` + shape + `,"sort":2}]}`
	f.call("setter", "PUT", "/locations/"+f.hall+"/floor-plan", body, http.StatusForbidden)
	result := f.call("admin", "PUT", "/locations/"+f.hall+"/floor-plan", body, http.StatusOK)
	walls := result["walls"].([]any)
	if len(walls) != 2 || walls[0].(map[string]any)["id"] == old || walls[1].(map[string]any)["sort"] != 2.0 {
		t.Fatalf("walls = %v", walls)
	}
	if result["location"].(map[string]any)["map"].(map[string]any)["width"] != 30.0 {
		t.Fatalf("map not saved: %v", result["location"])
	}
	broken := `{"map":{"width":30,"height":30,"shapes":[]},"removed":["` + kept + `"],"walls":[{"name":"Bad","outline":[],"edge":[]}]}`
	f.call("admin", "PUT", "/locations/"+f.hall+"/floor-plan", broken, http.StatusBadRequest)
	if len(items(f.call("", "GET", "/gyms/"+f.gymA+"/walls", "", http.StatusOK))) != 2 {
		t.Fatal("failed floor plan save was not rolled back")
	}
}

func TestMapTraceUpload(t *testing.T) {
	f := newFixture(t)
	upload := func(user, filename string, content []byte, status int) map[string]any {
		t.Helper()
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		part, _ := form.CreateFormFile("map_trace", filename)
		part.Write(content)
		form.Close()
		request := httptest.NewRequest("PUT", "/api/locations/"+f.hall+"/map-trace", &body)
		request.Header.Set("Content-Type", form.FormDataContentType())
		request.Header.Set("Authorization", f.tokens[user])
		recorder := httptest.NewRecorder()
		f.handler.ServeHTTP(recorder, request)
		if recorder.Code != status {
			t.Fatalf("upload %s = %d, want %d: %s", filename, recorder.Code, status, recorder.Body.String())
		}
		out := map[string]any{}
		json.Unmarshal(recorder.Body.Bytes(), &out)
		return out
	}
	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
	upload("setter", "plan.png", png, http.StatusForbidden)
	upload("admin", "plan.png", []byte("<html>"), http.StatusBadRequest)
	upload("admin", "plan.exe", png, http.StatusBadRequest)
	location := upload("admin", "Floor Plan.png", png, http.StatusOK)
	if trace, _ := location["map_trace"].(string); !strings.HasPrefix(trace, "floor_plan_") || !strings.HasSuffix(trace, ".png") {
		t.Fatalf("map_trace = %v", location["map_trace"])
	}
	if trace := f.call("admin", "DELETE", "/locations/"+f.hall+"/map-trace", "", http.StatusOK)["map_trace"]; trace != "" {
		t.Fatalf("map_trace = %v after delete", trace)
	}
}
