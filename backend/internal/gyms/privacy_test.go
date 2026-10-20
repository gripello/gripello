package gyms

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestIsValidPrivacyDoc(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/privacyDoc.json")
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
	for _, doc := range fixtures.Valid {
		if !isValidPrivacyDoc(doc) {
			t.Errorf("isValidPrivacyDoc(%.200s) rejected", doc)
		}
	}
	for _, doc := range fixtures.Invalid {
		if isValidPrivacyDoc(doc) {
			t.Errorf("isValidPrivacyDoc(%.200s) accepted", doc)
		}
	}
}

func TestPrivacyDocIsSavedByGymAdminsAndOperators(t *testing.T) {
	f := newFixture(t)
	gym := f.createGym("gym-a", "Gym A", true)
	admin := f.user("admin-a")
	f.member(admin, gym, "admin")
	climber := f.user("climber")
	block := func(key string) string {
		return `{"type":"paragraph","content":[{"type":"mention","attrs":{"id":"` + key + `"}}]}`
	}
	doc := `{"type":"doc","content":[` + block("controller") +
		`,{"type":"paragraph","content":[{"type":"text","text":"We film the entrance."}]},` + block("rights") + `]}`

	f.call(climber, "PATCH", "/gyms/"+gym, `{"privacy_doc":`+doc+`}`, http.StatusForbidden)
	f.call(admin, "PATCH", "/gyms/"+gym, `{"privacy_doc":{"type":"doc","content":[`+block("controller")+`]}}`,
		http.StatusBadRequest, `"privacy_doc"`)
	f.call(admin, "PATCH", "/gyms/"+gym, `{"privacy_doc":`+doc+`}`, http.StatusOK, `"text":"We film the entrance."`)
	f.call("", "GET", "/gyms/gym-a", "", http.StatusOK, `"text":"We film the entrance."`)
	if strings.Contains(f.call("", "GET", "/gyms", "", http.StatusOK).Body, "privacy_doc") {
		t.Fatal("gym list carries the privacy page")
	}
	f.call(admin, "PATCH", "/gyms/"+gym, `{"privacy_doc":null}`, http.StatusOK, `"privacy_doc":null`)

	f.call(admin, "PATCH", "/settings", `{"privacy_doc":`+doc+`}`, http.StatusForbidden)
	f.call(f.operator, "PATCH", "/settings", `{"privacy_doc":`+doc+`}`, http.StatusOK, `"text":"We film the entrance."`)
	f.call("", "GET", "/settings", "", http.StatusOK, `"text":"We film the entrance."`)
	var announced int
	f.scalar(`SELECT count(*) FROM events WHERE topic = 'settings' AND kind = 'settings.updated' AND audience->'public' = 'true'
		AND payload::text LIKE '%We film the entrance.%'`, &announced)
	if announced != 1 {
		t.Errorf("settings change announced %d times", announced)
	}
}

func TestPrivacyMigrationMovesTheExtraTextIntoTheDocument(t *testing.T) {
	f := newFixture(t)
	raw, err := os.ReadFile("../platform/db/migrations/0019_privacy_doc.sql")
	if err != nil {
		t.Fatal(err)
	}
	up, down, _ := strings.Cut(strings.TrimPrefix(string(raw), "-- +goose Up"), "-- +goose Down")
	german := f.createGym("gym-de", "Halle", true)
	plain := f.createGym("gym-en", "Gym", true)
	f.exec(`UPDATE gyms SET language = 'de' WHERE id = $1`, german)

	f.exec(down)
	f.exec(`UPDATE gyms SET privacy_extra = E'Videoüberwachung\n\n  im Eingang.' WHERE id = $1`, german)
	f.exec(up)

	var doc json.RawMessage
	f.scalar(`SELECT privacy_doc FROM gyms WHERE id = $1`, &doc, german)
	var parsed struct {
		Content []json.RawMessage `json:"content"`
	}
	json.Unmarshal(doc, &parsed)
	if !isValidPrivacyDoc(doc) || len(parsed.Content) != 28 ||
		!strings.Contains(string(parsed.Content[0]), `"controller"`) ||
		!strings.Contains(string(parsed.Content[1]), `"Weitere Hinweise der Halle"`) ||
		!strings.Contains(string(parsed.Content[2]), `"Videoüberwachung"`) ||
		!strings.Contains(string(parsed.Content[3]), `"im Eingang."`) ||
		!strings.Contains(string(parsed.Content[27]), `"rights"`) {
		t.Errorf("migrated document = %s", doc)
	}

	f.exec(down)
	var extra string
	f.scalar(`SELECT privacy_extra FROM gyms WHERE id = $1`, &extra, german)
	if extra != "Videoüberwachung\nim Eingang." {
		t.Errorf("rolled back extra text = %q", extra)
	}
	f.exec(up)

	var untouched *string
	f.scalar(`SELECT privacy_doc::text FROM gyms WHERE id = $1`, &untouched, plain)
	if untouched != nil {
		t.Errorf("gym without extra text got a document %s", *untouched)
	}
}

func TestSettingsLegalNameIsSavedByOperators(t *testing.T) {
	f := newFixture(t)
	f.call(f.user("climber"), "PATCH", "/settings", `{"legal_name":"Gripello GmbH"}`, http.StatusForbidden)
	f.call(f.operator, "PATCH", "/settings", `{"legal_name":"`+strings.Repeat("x", 301)+`"}`, http.StatusBadRequest, `"legal_name"`)
	f.call(f.operator, "PATCH", "/settings", `{"legal_name":"Gripello GmbH"}`, http.StatusOK, `"legal_name":"Gripello GmbH"`)
	f.call("", "GET", "/settings", "", http.StatusOK, `"legal_name":"Gripello GmbH"`)
}
