package main

import (
	"cmp"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

type textField struct {
	user, method, path, field string
	extra                     map[string]any
}

func (w *world) textFields() map[string]textField {
	r := w.records
	return map[string]textField{
		"competition name":        {"adminA", "PATCH", "/competitions/" + r["competition"], "name", nil},
		"competition description": {"adminA", "PATCH", "/competitions/" + r["competition"], "description", nil},
		"category name":           {"adminA", "PATCH", "/competition-categories/" + r["category"], "name", nil},
		"entry display name":      {"adminA", "PATCH", "/competition-entries/" + r["entry"], "display_name", nil},
		"task title":              {"adminA", "PATCH", "/tasks/" + r["task"], "title", nil},
		"task description":        {"adminA", "PATCH", "/tasks/" + r["task"], "description", nil},
		"route name":              {"adminA", "PATCH", "/routes/" + r["route"], "name", nil},
		"route comment":           {"adminA", "PATCH", "/routes/" + r["route"], "comment", nil},
		"location name":           {"adminA", "PATCH", "/locations/" + r["location"], "name", nil},
		"wall name":               {"adminA", "PATCH", "/walls/" + r["wall"], "name", nil},
		"season name":             {"adminA", "PATCH", "/seasons/" + r["season"], "name", nil},
		"role name":               {"adminA", "PATCH", "/roles/" + r["role"], "name", nil},
		"role description":        {"adminA", "PATCH", "/roles/" + r["role"], "description", nil},
		"gym name":                {"adminA", "PATCH", "/gyms/" + w.gymA, "name", nil},
		"gym description":         {"adminA", "PATCH", "/gyms/" + w.gymA, "description", nil},
		"tick note":               {"climber", "PATCH", "/ticks/" + r["tick"], "note", nil},
		"review comment":          {"climber", "PATCH", "/ratings/" + r["rating"], "comment", nil},
		"profile first name":      {"climber", "PATCH", "/me", "firstname", nil},
		"invite first name":       {"adminA", "POST", "/gyms/" + w.gymA + "/members", "firstname", map[string]any{"email": "new@example.com", "role": r["role"]}},
		"invite last name":        {"adminA", "POST", "/gyms/" + w.gymA + "/members", "name", map[string]any{"email": "new@example.com", "role": r["role"]}},
		"report explanation": {"climber", "POST", "/reports", "explanation", map[string]any{"content_type": "rating", "content_id": r["rating"],
			"reason": "spam_fraud", "notifier_name": "N", "notifier_email": "n@example.com", "good_faith": true}},
		"report notifier name": {"climber", "POST", "/reports", "notifier_name", map[string]any{"content_type": "rating", "content_id": r["rating"],
			"reason": "spam_fraud", "explanation": "Spam", "notifier_email": "n@example.com", "good_faith": true}},
	}
}

func (w *world) send(f textField, value string) *responseSummary {
	w.t.Helper()
	body := map[string]any{f.field: value}
	for key, v := range f.extra {
		body[key] = v
	}
	raw, _ := json.Marshal(body)
	response := w.call(f.user, f.method, f.path, string(raw))
	var decoded struct {
		Data map[string]struct{ Code string }
	}
	json.Unmarshal(response.Body.Bytes(), &decoded)
	return &responseSummary{status: response.Code, code: decoded.Data[f.field].Code, body: response.Body.String()}
}

type responseSummary struct {
	status int
	code   string
	body   string
}

var requiredText = []string{"competition name", "category name", "entry display name", "task title", "route name", "location name",
	"wall name", "season name", "role name", "gym name", "report explanation", "report notifier name"}

var blankCodes = map[string]string{"gym name": "validation_invalid_name", "report explanation": "validation_invalid_value", "report notifier name": "validation_invalid_value"}

func TestBlankRequiredTextIsRejected(t *testing.T) {
	w := newWorld(t)
	fields := w.textFields()
	for _, name := range requiredText {
		for _, blank := range []string{"", "   ", "\u200b", " \u200b\u00a0\u200d ", "\ufeff\t"} {
			got := w.send(fields[name], blank)
			if got.status != http.StatusBadRequest || got.code != cmp.Or(blankCodes[name], "validation_required") {
				t.Errorf("%s = %q: %d %s", name, blank, got.status, got.body)
			}
		}
	}
	created := w.call("adminA", "POST", "/gyms/"+w.gymA+"/tasks", `{"kind":"other","title":"\u200b"}`)
	if created.Code != http.StatusBadRequest || !strings.Contains(created.Body.String(), "validation_required") {
		t.Errorf("task with a zero-width title: %d %s", created.Code, created.Body)
	}
	entry := w.call("climber", "POST", "/competitions/"+w.records["competition"]+"/entries",
		`{"category":"`+w.records["category"]+`","display_name":"   ","birth_year":1990}`)
	if entry.Code != http.StatusBadRequest {
		t.Errorf("entry with a blank name: %d %s", entry.Code, entry.Body)
	}
}

func TestTextLimitsCountCharacters(t *testing.T) {
	limits := map[string]int{
		"competition name": 200, "competition description": 5000, "category name": 100, "entry display name": 60,
		"task title": 200, "task description": 2000, "route name": 100, "route comment": 2000, "location name": 100,
		"wall name": 100, "season name": 60, "role name": 50, "role description": 200, "gym name": 100, "gym description": 2000,
		"tick note": 500, "review comment": 5000, "profile first name": 5000, "invite first name": 100, "invite last name": 100,
		"report explanation": 2000, "report notifier name": 100,
	}
	w := newWorld(t)
	fields := w.textFields()
	if len(limits) != len(fields) {
		t.Fatalf("%d limits for %d fields", len(limits), len(fields))
	}
	for name, limit := range limits {
		for _, char := range []string{"ü", "🧗"} {
			if got := w.send(fields[name], strings.Repeat(char, limit)); got.status >= 300 {
				t.Errorf("%s with %d × %s refused: %d %.200s", name, limit, char, got.status, got.body)
			}
			if got := w.send(fields[name], strings.Repeat(char, limit+1)); got.status != http.StatusBadRequest {
				t.Errorf("%s with %d × %s answered %d, want 400", name, limit+1, char, got.status)
			}
		}
	}
}
