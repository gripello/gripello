package routes

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestRouteNameKeepsMarkupAndTimestampsVerbatim(t *testing.T) {
	f := newFixture(t)
	for _, name := range []string{`<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, "2024-01-01T10:00:00Z"} {
		encoded, _ := json.Marshal(name)
		id := f.route(`,"name":` + string(encoded))
		if got := f.call("", "GET", "/routes/"+id, "", http.StatusOK)["name"]; got != name {
			t.Errorf("name = %q, want %q", got, name)
		}
		if stored := f.exec(`SELECT name FROM routes WHERE id = $1`, id); stored != name {
			t.Errorf("stored %q", stored)
		}
	}
}
