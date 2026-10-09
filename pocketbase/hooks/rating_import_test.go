package hooks

import (
	"net/http"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tools/types"
)

func TestImportedRatingDate(t *testing.T) {
	now := types.NowDateTime()
	past, _ := types.ParseDateTime(now.Add(-48 * time.Hour).String())
	day, _ := types.ParseDateTime("2024-05-06")
	iso, _ := types.ParseDateTime("2024-05-06 09:30:00.000Z")
	for _, tc := range []struct {
		name  string
		value any
		want  types.DateTime
	}{
		{"past", past.String(), past},
		{"date only", "2024-05-06", day},
		{"browser ISO", "2024-05-06T09:30:00.000Z", iso},
		{"future", now.Add(time.Hour).String(), types.DateTime{}},
		{"garbage", "yesterday", types.DateTime{}},
		{"missing", nil, types.DateTime{}},
	} {
		if got := importedRatingDate(tc.value, now); !got.Equal(tc.want) {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestRatingImportKeepsDateAndDropsAuthor(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()

	hallA := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id})
	hallB := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymB.Id})
	route := map[string]any{"name": "Crimp", "grade": "6a", "grade_system": "font", "type": "Boulder", "creator": []string{"S"}}
	routeA := saveRecord(t, f.app, "routes", withField(route, "location", hallA.Id))
	routeB := saveRecord(t, f.app, "routes", withField(route, "location", hallB.Id))
	token, err := f.setterA.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}

	status, body := send(t, f.app, http.MethodPost, "/api/import/ratings", token, map[string]any{
		"gym": f.gymA.Id,
		"ratings": []map[string]any{
			{"route_id": routeA.Id, "rating": 4, "comment": "old", "created": "2021-03-04 10:00:00.000Z", "user": f.climber.Id},
			{"route_id": routeA.Id, "rating": 5, "comment": "future", "created": "2999-01-01 00:00:00.000Z"},
			{"route_id": routeB.Id, "rating": 3, "comment": "foreign"},
		},
	})
	if status != http.StatusOK || body["failed"] != float64(1) {
		t.Fatalf("status %d, body %v", status, body)
	}

	old, err := f.app.FindFirstRecordByData("ratings", "comment", "old")
	if err != nil {
		t.Fatal(err)
	}
	if got := old.GetDateTime("created").String(); got != "2021-03-04 10:00:00.000Z" {
		t.Errorf("created = %s", got)
	}
	if old.GetString("user") != "" {
		t.Errorf("user = %q, want none", old.GetString("user"))
	}
	future, err := f.app.FindFirstRecordByData("ratings", "comment", "future")
	if err != nil {
		t.Fatal(err)
	}
	if future.GetDateTime("created").After(types.NowDateTime()) {
		t.Errorf("future date kept: %s", future.GetDateTime("created"))
	}
}

func withField(data map[string]any, key string, value any) map[string]any {
	copied := map[string]any{key: value}
	for k, v := range data {
		copied[k] = v
	}
	return copied
}

func TestRatingImportRejectsOversizedBatches(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()

	token, err := f.setterA.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	ratings := make([]map[string]any, maxImportedRatings+1)
	for index := range ratings {
		ratings[index] = map[string]any{"rating": 3}
	}
	status, _ := send(t, f.app, http.MethodPost, "/api/import/ratings", token, map[string]any{"gym": f.gymA.Id, "ratings": ratings})
	if status != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", status)
	}
}
