package ratings

import (
	"net/http"
	"testing"

	"gripello/internal/platform/testapp"
)

func TestRatingWithAStaleTokenIsRefusedNotPostedAsGuest(t *testing.T) {
	f := newFixture(t)
	f.tokens["signedOut"] = testapp.Token(t, f.app, f.users["climber"], "rotated-key")
	f.call("signedOut", "POST", "/routes/"+f.route+"/ratings", `{"rating":5,"comment":"after the sign-out"}`, http.StatusUnauthorized)
	if count := f.exec(`SELECT count(*)::text FROM ratings WHERE comment = 'after the sign-out'`); count != "0" {
		t.Errorf("stale-token rating stored %s times", count)
	}
	f.rate("", `{"rating":3,"comment":"real guest"}`)
}

func TestEmptyGuestReviewsAreRefused(t *testing.T) {
	f := newFixture(t)
	path := "/routes/" + f.route + "/ratings"
	for _, body := range []string{`{}`, `{"rating":0,"comment":"  ","grade":""}`, `{"comment":"​"}`} {
		f.call("", "POST", path, body, http.StatusBadRequest)
	}
	if count := f.exec(`SELECT count(*)::text FROM ratings`); count != "0" {
		t.Errorf("empty guest reviews stored: %s", count)
	}
	f.rate("", `{"rating":2}`)
	f.rate("", `{"comment":"good holds"}`)
	f.rate("", `{"grade":"6a"}`)
}
