package hooks

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

func TestOnlyPlatformAdminsChangeFeatureFlags(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	gym := recordURL("gyms", f.gymA.Id)

	call(t, f.app, f.adminA, http.MethodPatch, gym, `{"features":{"beta_videos":false}}`, http.StatusForbidden, "feature flags")
	call(t, f.app, f.adminA, http.MethodPatch, gym, `{"name":"Renamed","features":{"beta_videos":true}}`, http.StatusOK)
	operator := platformAdmin(t, f.app)
	call(t, f.app, operator, http.MethodPatch, gym, `{"features":{"beta_videos":false}}`, http.StatusOK, `"beta_videos":false`)
	call(t, f.app, f.adminA, http.MethodPatch, gym, `{"features":{"beta_videos":1}}`, http.StatusForbidden)
	call(t, f.app, f.adminA, http.MethodPatch, gym, `{"features":{}}`, http.StatusForbidden)
	call(t, f.app, operator, http.MethodPatch, gym, `{"features":{"beta_videos":1}}`, http.StatusBadRequest, "true/false")
}

func TestBetaVideosNeedTheGymFlag(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id})
	route := saveRecord(t, f.app, "routes", map[string]any{"name": "Crimp", "grade": "6a", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id})
	upload := func() error {
		collection, err := f.app.FindCollectionByNameOrId("beta_videos")
		if err != nil {
			t.Fatal(err)
		}
		video := core.NewRecord(collection)
		file, err := filesystem.NewFileFromBytes([]byte("\x00\x00\x00\x18ftypmp42"), "beta.mp4")
		if err != nil {
			t.Fatal(err)
		}
		video.Load(map[string]any{"user": f.climber.Id, "route": route.Id})
		video.Set("file", file)
		return f.app.Save(video)
	}
	videos := "/api/collections/beta_videos/records"
	link := `{"user":"` + f.climber.Id + `","route":"` + route.Id + `","url":"https://youtube.com/shorts/123"}`

	if err := upload(); err != nil {
		t.Fatalf("upload with the flag: %v", err)
	}
	call(t, f.app, f.climber, http.MethodPost, videos, link, http.StatusOK)

	f.gymA.Set("features", map[string]bool{})
	if err := f.app.Save(f.gymA); err != nil {
		t.Fatal(err)
	}
	if err := upload(); err == nil || !strings.Contains(err.Error(), "not enabled") {
		t.Fatalf("upload without the flag: err = %v, want it rejected", err)
	}
	call(t, f.app, f.climber, http.MethodPost, videos, link, http.StatusForbidden, "not enabled")
	call(t, f.app, nil, http.MethodGet, videos, "", http.StatusOK, `"totalItems":2`)
}
