package hooks

import (
	"net/http"
	"testing"
)

func TestIsBetaVideoLink(t *testing.T) {
	for link, want := range map[string]bool{
		"https://www.youtube.com/watch?v=abc":   false,
		"https://youtu.be/abc":                  false,
		"https://youtube.com/shorts/123":        true,
		"https://m.youtube.com/shorts/abc":      true,
		"https://vimeo.com/123":                 false,
		"https://www.instagram.com/reel/abc/":   true,
		"https://vm.tiktok.com/abc":             true,
		"http://www.youtube.com/watch?v=abc":    false,
		"https://youtube.com.evil.example/abc":  false,
		"https://example.com/video.mp4":         false,
		"javascript:alert(1)//www.youtube.com/": false,
	} {
		if got := isBetaVideoLink(link); got != want {
			t.Errorf("isBetaVideoLink(%q) = %v, want %v", link, got, want)
		}
	}
}

func TestBetaVideos(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id})
	route := saveRecord(t, f.app, "routes", map[string]any{"name": "Crimp", "grade": "6a", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id})
	archived := saveRecord(t, f.app, "routes", map[string]any{"name": "Old", "grade": "6a", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id, "archived": true})
	videos := "/api/collections/beta_videos/records"
	body := func(user, route, link string) string {
		return `{"user":"` + user + `","route":"` + route + `","url":"` + link + `"}`
	}

	call(t, f.app, nil, http.MethodPost, videos, body("", route.Id, "https://youtube.com/shorts/123"), http.StatusBadRequest)
	call(t, f.app, f.climber, http.MethodPost, videos, body(f.setterA.Id, route.Id, "https://youtube.com/shorts/123"), http.StatusBadRequest)
	call(t, f.app, f.climber, http.MethodPost, videos, body(f.climber.Id, route.Id, ""), http.StatusBadRequest, "either a link")
	call(t, f.app, f.climber, http.MethodPost, videos, body(f.climber.Id, route.Id, "https://example.com/x"), http.StatusBadRequest, "links are allowed")
	call(t, f.app, f.climber, http.MethodPost, videos, body(f.climber.Id, archived.Id, "https://youtube.com/shorts/123"), http.StatusBadRequest, "Archived")
	call(t, f.app, f.climber, http.MethodPost, videos, `{"user":"`+f.climber.Id+`","route":"`+route.Id+`","url":"https://youtube.com/shorts/123","gym":"`+f.gymB.Id+`"}`, http.StatusBadRequest, "another gym")

	own := saveRecord(t, f.app, "beta_videos", map[string]any{"user": f.climber.Id, "route": route.Id, "url": "https://youtube.com/shorts/123"})
	if own.GetString("gym") != f.gymA.Id {
		t.Errorf("beta video gym = %q, want the route's gym", own.GetString("gym"))
	}
	call(t, f.app, nil, http.MethodGet, videos, "", http.StatusOK, `"totalItems":1`)
	call(t, f.app, f.setterB, http.MethodGet, videos, "", http.StatusOK, `"author":{"id":"`+f.climber.Id+`"`)
	call(t, f.app, f.climber, http.MethodPatch, recordURL("beta_videos", own.Id), `{"url":"https://youtube.com/shorts/1"}`, http.StatusForbidden)
	call(t, f.app, f.setterB, http.MethodDelete, recordURL("beta_videos", own.Id), "", http.StatusNotFound)
	call(t, f.app, f.setterA, http.MethodDelete, recordURL("beta_videos", own.Id), "", http.StatusNoContent)

	reported := saveRecord(t, f.app, "beta_videos", map[string]any{"user": f.climber.Id, "route": route.Id, "url": "https://youtube.com/shorts/1"})
	report := saveRecord(t, f.app, "reports", map[string]any{
		"content_type": "beta_video", "content_id": reported.Id, "content_url": "/", "reason": "spam_fraud",
		"explanation": "Spam", "notifier_name": "N", "notifier_email": "n@example.com", "good_faith": true, "status": "open",
	})
	if report.GetString("gym") != f.gymA.Id {
		t.Errorf("report gym = %q, want the video's gym", report.GetString("gym"))
	}
	if got := reportedContentSnapshot(f.app, report); got != "https://youtube.com/shorts/1" {
		t.Errorf("snapshot = %q", got)
	}
	if got := reportedContentURL(f.app, report); got != "/route?id="+route.Id+"#beta-"+reported.Id {
		t.Errorf("content url = %q", got)
	}
	call(t, f.app, f.climber, http.MethodDelete, recordURL("beta_videos", reported.Id), "", http.StatusNoContent)
	if reportedContentExists(f.app, report) {
		t.Error("deleted beta video still counts as existing")
	}
}
