package hooks

import (
	"net/http"
	"testing"
)

func TestContributions(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id})
	route := saveRecord(t, f.app, "routes", map[string]any{"name": "Crimp", "grade": "6a", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id})
	saveRecord(t, f.app, "ratings", map[string]any{"user": f.climber.Id, "route_id": route.Id, "rating": 4, "comment": "Mine"})
	saveRecord(t, f.app, "ratings", map[string]any{"user": f.setterA.Id, "route_id": route.Id, "rating": 2, "comment": "Theirs"})
	saveRecord(t, f.app, "beta_videos", map[string]any{"user": f.climber.Id, "route": route.Id, "url": "https://youtube.com/shorts/123"})

	url := "/api/account/contributions"
	call(t, f.app, nil, http.MethodGet, url, "", http.StatusUnauthorized)
	call(t, f.app, f.climber, http.MethodGet, url, "", http.StatusOK, `"comment":"Mine"`, `"name":"Crimp"`, `"url":"https://youtube.com/shorts/123"`)
	call(t, f.app, f.setterA, http.MethodGet, url, "", http.StatusOK, `"comment":"Theirs"`, `"betas":[]`)
}
