package hooks

import (
	"encoding/json"
	"net/http"
	"os"
	"testing"
)

func TestIsValidOpeningHours(t *testing.T) {
	raw, err := os.ReadFile("../testdata/openingHours.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		Valid   []json.RawMessage `json:"valid"`
		Invalid []json.RawMessage `json:"invalid"`
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, hours := range fixtures.Valid {
		if !isValidOpeningHours(hours) {
			t.Errorf("isValidOpeningHours(%s) rejected", hours)
		}
	}
	for _, hours := range fixtures.Invalid {
		if isValidOpeningHours(hours) {
			t.Errorf("isValidOpeningHours(%s) accepted", hours)
		}
	}
}

func TestGymAdminsSaveGymInfo(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	gym := recordURL("gyms", f.gymA.Id)

	call(t, f.app, f.adminA, http.MethodPatch, gym, `{"opening_hours":{"mon":[["07:00","23:00"]]},"amenities":["showers","toilets"],"latitude":52.5}`, http.StatusOK, `"showers"`)
	call(t, f.app, f.adminA, http.MethodPatch, gym, `{"opening_hours":{"mon":[["7","23"]]}}`, http.StatusBadRequest, "HH:MM")
	call(t, f.app, f.adminA, http.MethodPatch, gym, `{"amenities":["jacuzzi"]}`, http.StatusBadRequest)
	call(t, f.app, f.adminA, http.MethodPatch, gym, `{"latitude":91}`, http.StatusBadRequest)
}
