package main

import (
	"encoding/json"
	"maps"
	"net/http"
	"slices"
	"strings"
	"testing"
)

var guestWrites = map[string]string{
	"POST /auth/login":                       "signs a guest in",
	"POST /auth/register":                    "creates an account; always answers 202",
	"POST /auth/logout":                      "ending a missing session is a no-op",
	"POST /auth/password-reset/request":      "answers alike for every address",
	"POST /auth/verification/request":        "answers alike for every address",
	"POST /auth/oauth2/{provider}/start":     "starts a provider sign-in",
	"POST /auth/passkey/options":             "starts a passkey sign-in",
	"POST /client-errors":                    "browser error reports come from guests too",
	"POST /reports":                          "DSA notices are open to anyone",
	"POST /routes/{id}/ratings":              "guest reviews are anonymous and need a captcha (off without CAP_SECRET)",
	"PUT /realtime/{clientId}/subscriptions": "guests follow public topics",
	"POST /gyms/{gym}/tasks":                 "guests report defects behind a captcha (off without CAP_SECRET)",
}

var guestCredentialFlows = map[string]string{
	"POST /gym-onboardings/{token}/redeem":  "the link token is the credential",
	"POST /invites/{token}/accept":          "the invite token is the credential",
	"POST /auth/totp":                       "second factor of a pending login",
	"POST /auth/recovery":                   "second factor of a pending login",
	"POST /auth/passkey":                    "passkey sign-in",
	"POST /auth/oauth2/{provider}/callback": "provider redirect",
	"POST /auth/oauth2/finish":              "redeems the flow cookie",
	"POST /auth/password-reset/confirm":     "the mailed token is the credential",
	"POST /auth/verification/confirm":       "the mailed token is the credential",
	"POST /auth/email-change/confirm":       "the mailed token plus password are the credential",
}

func TestGuestsCannotWrite(t *testing.T) {
	w := newWorld(t)
	for _, route := range writeRoutes(w.app) {
		method, pattern, _ := strings.Cut(route, " ")
		t.Run(route, func(t *testing.T) {
			response := w.call("", method, w.path(pattern), w.validBody(route))
			if response.Code >= 500 {
				t.Fatalf("answered %d: %s", response.Code, response.Body)
			}
			if response.Code < 300 && guestWrites[route] == "" {
				t.Fatalf("a guest got %d: %s", response.Code, response.Body)
			}
			if guestWrites[route] == "" && guestCredentialFlows[route] == "" && response.Code != http.StatusUnauthorized {
				t.Fatalf("a guest got %d instead of 401: %s", response.Code, response.Body)
			}
		})
	}
}

func TestGuestWritesAreRegistered(t *testing.T) {
	w := newWorld(t)
	registered := map[string]bool{}
	for _, route := range w.app.Routes {
		registered[route] = true
	}
	for _, route := range slices.Concat(slices.Collect(maps.Keys(guestWrites)), slices.Collect(maps.Keys(guestCredentialFlows))) {
		if !registered[route] {
			t.Errorf("%s is allowlisted but not registered", route)
		}
	}
	if w.call("", http.MethodDelete, "/routes/"+w.records["route"], "").Code != http.StatusUnauthorized {
		t.Error("guest deletes must be refused as unauthenticated")
	}
}

var ownAccountWrite = []string{"/me", "/auth/", "/client-errors", "/realtime/", "/files/token"}

var climberWrites = map[string]string{
	"POST /blocks":                         "blocking is a climber action",
	"POST /follows":                        "following is a climber action",
	"POST /reports":                        "DSA notices are open to anyone",
	"POST /routes/{id}/ratings":            "any climber reviews routes of visible gyms",
	"POST /routes/{id}/betas":              "any climber posts betas on routes of visible gyms",
	"POST /competitions/{id}/entries":      "climbers register themselves for open competitions",
	"POST /gym-onboardings/{token}/redeem": "the onboarding link itself is the credential",
	"POST /invites/{token}/accept":         "the invite link itself is the credential",
	"POST /gyms/{gym}/tasks":               "any climber reports defects; staff kinds are checked in TestOtherGymAdminCannotFileStaffTasks",
}

func (w *world) validBody(route string) string {
	switch route {
	case "PUT /competitions/{id}/scores":
		return `{"scores":[{"entry":"` + w.records["entry"] + `","comp_route":"` + w.records["compRoute"] + `","attempts":1,"top_attempt":1}]}`
	case "POST /moderation/cases":
		return `{"content_type":"rating","content_id":"` + w.records["rating"] + `"}`
	}
	return `{}`
}

func TestOtherGymAdminCannotWriteGymA(t *testing.T) {
	w := newWorld(t)
	for _, route := range writeRoutes(w.app) {
		method, pattern, _ := strings.Cut(route, " ")
		if climberWrites[route] != "" || slices.ContainsFunc(ownAccountWrite, func(prefix string) bool { return strings.HasPrefix(pattern, prefix) }) {
			continue
		}
		t.Run(route, func(t *testing.T) {
			response := w.call("adminB", method, w.path(pattern), w.validBody(route))
			if response.Code != http.StatusForbidden && response.Code != http.StatusNotFound {
				t.Fatalf("admin of gym B got %d: %s", response.Code, response.Body)
			}
		})
	}
}

func TestOtherGymAdminCannotFileStaffTasks(t *testing.T) {
	w := newWorld(t)
	response := w.call("adminB", http.MethodPost, "/gyms/"+w.gymA+"/tasks", `{"kind":"other","title":"Paint","priority":1}`)
	var task struct{ Kind string }
	json.Unmarshal(response.Body.Bytes(), &task)
	if response.Code < 300 && task.Kind != "defect" {
		t.Fatalf("admin of gym B filed a %q task: %s", task.Kind, response.Body)
	}
}

func TestExpiredTrialLeavesStaffReadOnly(t *testing.T) {
	w := newWorld(t)
	w.exec(`UPDATE gyms SET trial_ends_at = now() - interval '1 day' WHERE id = $1`, w.gymA)
	for _, route := range writeRoutes(w.app) {
		method, pattern, _ := strings.Cut(route, " ")
		if climberWrites[route] != "" || strings.HasPrefix(pattern, "/platform/") || pattern == "/gyms" ||
			slices.ContainsFunc(ownAccountWrite, func(prefix string) bool { return strings.HasPrefix(pattern, prefix) }) {
			continue
		}
		t.Run(route, func(t *testing.T) {
			response := w.call("adminA", method, w.path(pattern), w.validBody(route))
			if response.Code < 300 || response.Code >= 500 {
				t.Fatalf("admin of an expired trial got %d: %s", response.Code, response.Body)
			}
		})
	}
	staffWrites := []struct{ method, path, body string }{
		{"POST", "/gyms/" + w.gymA + "/routes", `{"name":"New","grade":"6a","location":"` + w.records["location"] + `"}`},
		{"PATCH", "/routes/" + w.records["route"], `{"name":"Renamed"}`},
		{"PATCH", "/locations/" + w.records["location"], `{"name":"Loft"}`},
		{"PATCH", "/seasons/" + w.records["season"], `{"name":"Summer"}`},
		{"PATCH", "/tasks/" + w.records["task"], `{"title":"Paint"}`},
		{"PATCH", "/competitions/" + w.records["competition"], `{"name":"Cup"}`},
		{"POST", "/gyms/" + w.gymA + "/members", `{"email":"x@example.com","role":"` + w.records["role"] + `"}`},
		{"POST", "/gyms/" + w.gymA + "/seasons", `{"name":"Fall","starts_at":"2026-09-01T00:00:00Z","ends_at":"2026-12-01T00:00:00Z"}`},
		{"PATCH", "/gyms/" + w.gymA, `{"tv_settings":null}`},
	}
	for _, write := range staffWrites {
		if response := w.call("adminA", write.method, write.path, write.body); response.Code != http.StatusForbidden {
			t.Errorf("%s %s = %d, want 403: %s", write.method, write.path, response.Code, response.Body)
		}
	}
	if response := w.call("adminA", "POST", "/moderation/"+w.records["moderation"], `{"action":"approve"}`); response.Code != http.StatusNotFound {
		t.Errorf("moderation decision = %d, want 404 as for any non-staff: %s", response.Code, response.Body)
	}
	if response := w.call("adminA", "POST", "/gyms/"+w.gymA+"/tasks", `{"kind":"other","title":"Paint"}`); response.Code < 300 {
		t.Errorf("staff task filed in an expired trial: %s", response.Body)
	}
	climberWritesStillWork := []struct{ method, path, body string }{
		{"POST", "/me/ticks", `{"route":"` + w.records["route"] + `","type":"top","attempts":1,"date":"2026-01-02"}`},
		{"POST", "/routes/" + w.records["route"] + "/ratings", `{"rating":4,"comment":"Fun"}`},
		{"POST", "/reports", `{"content_type":"rating","content_id":"` + w.records["rating"] + `","reason":"spam_fraud","explanation":"x","notifier_name":"N","notifier_email":"n@example.com","good_faith":true}`},
	}
	for _, write := range climberWritesStillWork {
		if response := w.call("adminA", write.method, write.path, write.body); response.Code >= 300 {
			t.Errorf("%s %s = %d: %s", write.method, write.path, response.Code, response.Body)
		}
	}
	if response := w.call("adminA", "GET", "/gyms/"+w.gymA+"/analytics", ""); response.Code != http.StatusOK {
		t.Errorf("analytics = %d: %s", response.Code, response.Body)
	}
}
