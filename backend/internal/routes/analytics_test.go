package routes

import (
	"encoding/json"
	"net/http"
	"os"
	"reflect"
	"testing"
	"time"

	"gripello/internal/platform/ids"
)

func TestAnalyticsMatchesFixture(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/analytics.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Now   time.Time `json:"now"`
		Cases []struct {
			Name     string            `json:"name"`
			Query    analyticsQuery    `json:"query"`
			Routes   []analyticsRoute  `json:"routes"`
			Ratings  []analyticsRating `json:"ratings"`
			Expected map[string]any    `json:"expected"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, c := range fixture.Cases {
		t.Run(c.Name, func(t *testing.T) {
			response := buildAnalytics(c.Routes, c.Ratings, resolveAnalyticsFilters(c.Query, fixture.Now), fixture.Now)
			for discipline, grades := range response.Grades {
				grades.GradeDistribution = inExpectedGradeOrder(grades.GradeDistribution, c.Expected, discipline)
				response.Grades[discipline] = grades
			}
			encoded, _ := json.Marshal(response)
			var got map[string]any
			json.Unmarshal(encoded, &got)
			for key, want := range c.Expected {
				if !reflect.DeepEqual(got[key], want) {
					gotJSON, _ := json.Marshal(got[key])
					wantJSON, _ := json.Marshal(want)
					t.Errorf("%s:\n got %s\nwant %s", key, gotJSON, wantJSON)
				}
			}
			if len(got) != len(c.Expected) {
				t.Errorf("keys = %d, want %d", len(got), len(c.Expected))
			}
		})
	}
}

// The client sorts grade buckets by difficulty, so only their contents must match.
func inExpectedGradeOrder(rows []gradeDatum, expected map[string]any, discipline string) []gradeDatum {
	byGrade := map[string]gradeDatum{}
	for _, row := range rows {
		byGrade[row.Grade] = row
	}
	wantRows := expected["grades"].(map[string]any)[discipline].(map[string]any)["gradeDistribution"].([]any)
	ordered := []gradeDatum{}
	for _, want := range wantRows {
		grade := want.(map[string]any)["grade"].(string)
		if row, ok := byGrade[grade]; ok {
			ordered = append(ordered, row)
			delete(byGrade, grade)
		}
	}
	for _, row := range rows {
		if _, left := byGrade[row.Grade]; left {
			ordered = append(ordered, row)
		}
	}
	return ordered
}

func TestRoundMatchesToFixed(t *testing.T) {
	for _, c := range []struct{ value, want float64 }{
		{4.125, 4.13}, {-4.125, -4.13}, {2.675, 2.67}, {1.005, 1}, {13.4, 13.4}, {-0.001, 0}, {0.25, 0.25},
	} {
		if got := round(c.value, 2); got != c.want {
			t.Errorf("round(%v) = %v, want %v", c.value, got, c.want)
		}
	}
	if got := round(0.25, 1); got != 0.3 {
		t.Errorf("round(0.25, 1) = %v", got)
	}
}

func TestAnalyticsNeedsViewAnalytics(t *testing.T) {
	f := newFixture(t)
	f.user("analyst", f.gymA, "view_analytics")
	f.user("member", f.gymA, "manage_tasks")
	f.user("analystB", f.gymB, "view_analytics")
	path := "/gyms/" + f.gymA + "/analytics"
	f.call("", "GET", path, "", http.StatusUnauthorized)
	f.call("member", "GET", path, "", http.StatusForbidden)
	f.call("setter", "GET", path, "", http.StatusForbidden)
	f.call("analystB", "GET", path, "", http.StatusForbidden)
	f.call("operator", "GET", path, "", http.StatusForbidden)
	f.call("analyst", "GET", "/gyms/alpha/analytics", "", http.StatusOK)
}

func TestAnalyticsFilters(t *testing.T) {
	f := newFixture(t)
	f.user("analyst", f.gymA, "view_analytics")
	boulder := f.route(`,"grade_system":"french","grade_index":12`)
	f.route(`,"type":"Route","location":"` + f.hallB + `"`)
	f.route(`,"archived":true`)
	f.call("setterB", "POST", "/gyms/"+f.gymB+"/routes", `{"name":"Other","grade":"6a","location":"`+f.otherGym+`"}`, http.StatusCreated)
	for _, stars := range []int{5, 4, 3} {
		f.exec(`INSERT INTO ratings (id, gym, route_id, rating, comment, grade_index) VALUES ($1, $2, $3, $4, 'ok', 14) RETURNING id`,
			ids.New(), f.gymA, boulder, stars)
	}

	summary := func(query string) map[string]any {
		return f.call("analyst", "GET", "/gyms/"+f.gymA+"/analytics?"+query, "", http.StatusOK)["summary"].(map[string]any)
	}
	if got := summary("range=all")["activeRoutes"]; got != float64(2) {
		t.Errorf("all routes = %v", got)
	}
	if got := summary("range=all&type=Boulder")["activeRoutes"]; got != float64(1) {
		t.Errorf("boulders = %v", got)
	}
	if got := summary("range=all&location=" + f.hallB)["ratings"].(map[string]any)["value"]; got != float64(0) {
		t.Errorf("ratings in the annex = %v", got)
	}
	if got := summary("range=all&archived=true")["routesSet"].(map[string]any)["value"]; got != float64(3) {
		t.Errorf("with archived = %v", got)
	}

	body := f.call("analyst", "GET", "/gyms/"+f.gymA+"/analytics?range=30d", "", http.StatusOK)
	if body["bucket"] != "day" || body["summary"].(map[string]any)["averageRating"].(map[string]any)["value"] != float64(4) {
		t.Errorf("30 days = %v %v", body["bucket"], body["summary"])
	}
	feedback := body["grades"].(map[string]any)["Boulder"].(map[string]any)["gradeFeedback"].([]any)
	if len(feedback) != 1 || feedback[0].(map[string]any)["gradeSystem"] != "french" || feedback[0].(map[string]any)["deviation"] != float64(2) {
		t.Errorf("feedback = %v", feedback)
	}
	if latest := body["latestComments"].([]any); len(latest) != 3 || latest[0].(map[string]any)["routeName"] != "Crimp" {
		t.Errorf("latest comments = %v", latest)
	}
}
