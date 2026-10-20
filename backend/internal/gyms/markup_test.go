package gyms

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestGymDescriptionKeepsMarkupVerbatim(t *testing.T) {
	f := newFixture(t)
	gym := f.createGym("gym-a", "Gym A", true)
	admin := f.user("admin-a")
	f.member(admin, gym, "admin")
	description := `<script>alert(1)</script> <img src=x onerror=alert(1)>`
	body, _ := json.Marshal(map[string]string{"description": description})
	f.call(admin, "PATCH", "/gyms/"+gym, string(body), http.StatusOK)

	if got := f.call("", "GET", "/gyms/"+gym, "", http.StatusOK).json(t)["description"]; got != description {
		t.Fatalf("description = %q", got)
	}
	var stored string
	f.scalar(`SELECT description FROM gyms WHERE id = $1`, &stored, gym)
	if stored != description {
		t.Fatalf("stored %q", stored)
	}
}
