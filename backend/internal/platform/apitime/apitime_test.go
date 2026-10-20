package apitime

import (
	"encoding/json"
	"testing"
	"time"
)

func TestParseAcceptsOnlyRFC3339(t *testing.T) {
	for _, s := range []string{"2026-10-20T10:36:12.123Z", "2026-10-20T10:36:12Z", "2026-10-20T12:36:12.123456+02:00"} {
		if _, err := Parse(s); err != nil {
			t.Errorf("Parse(%q) = %v", s, err)
		}
	}
	for _, s := range []string{"2026-10-20 10:36:12.123Z", "2026-10-20", "2026-10-20T10:36", "yesterday", ""} {
		if _, err := Parse(s); err == nil {
			t.Errorf("Parse(%q) accepted the old or a partial format", s)
		}
	}
}

func TestFormatIsUTCWithMilliseconds(t *testing.T) {
	at := time.Date(2026, 10, 20, 12, 36, 12, 0, time.FixedZone("CEST", 2*3600))
	if got := Format(at); got != "2026-10-20T10:36:12.000Z" {
		t.Errorf("Format = %s", got)
	}
}

func TestCanonicalRewritesEveryTimestamp(t *testing.T) {
	goJSON, _ := json.Marshal(map[string]any{"created": time.Date(2026, 10, 20, 10, 36, 12, 123456000, time.UTC), "deleted_at": time.Time{}})
	if got := string(Canonical(goJSON)); got != `{"created":"2026-10-20T10:36:12.123Z","deleted_at":"0001-01-01T00:00:00.000Z"}` {
		t.Errorf("Go encoding = %s", got)
	}
	postgres := `{"created": "2026-10-20T10:36:12.5+00:00", "day": "2026-10-20", "note": "said \"2026-10-20T10:36:12+00:00\" twice", "expires_at" : "2026-10-20T10:36:12+02:00"}`
	want := `{"created": "2026-10-20T10:36:12.500Z", "day": "2026-10-20", "note": "said \"2026-10-20T10:36:12+00:00\" twice", "expires_at" : "2026-10-20T08:36:12.000Z"}`
	if got := string(Canonical([]byte(postgres))); got != want {
		t.Errorf("Postgres encoding = %s", got)
	}
}

func TestCanonicalLeavesUserTextAlone(t *testing.T) {
	body := `{"name":"2024-01-01T10:00:00Z","items":["2024-01-01T10:00:00Z"],"record":{"comment":"2024-01-01T10:00:00+02:00","updated":"2024-01-01T10:00:00Z"}}`
	want := `{"name":"2024-01-01T10:00:00Z","items":["2024-01-01T10:00:00Z"],"record":{"comment":"2024-01-01T10:00:00+02:00","updated":"2024-01-01T10:00:00.000Z"}}`
	if got := string(Canonical([]byte(body))); got != want {
		t.Errorf("Canonical = %s", got)
	}
}

func TestDates(t *testing.T) {
	var d Date
	if err := json.Unmarshal([]byte(`"2026-02-30"`), &d); err == nil {
		t.Error("accepted an impossible day")
	}
	if err := json.Unmarshal([]byte(`"2026-10-20 12:00:00.000Z"`), &d); err == nil {
		t.Error("accepted a timestamp as a day")
	}
	if err := json.Unmarshal([]byte(`"2026-10-20"`), &d); err != nil || d != "2026-10-20" || !d.Time().Equal(time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("day = %q %v", d, err)
	}
	if got := DateOf(time.Date(2026, 10, 20, 23, 30, 0, 0, time.FixedZone("x", -3600))); got != "2026-10-21" {
		t.Errorf("DateOf = %s", got)
	}
}
