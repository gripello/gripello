package routes

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"gripello/internal/platform/testapp"
)

func TestRouteChangesReachGymChanges(t *testing.T) {
	f := newFixture(t)
	id := f.route("")
	f.call("setter", "POST", "/routes/"+id+"/archive", "", http.StatusOK)

	type row struct {
		topic, kind, actor string
		payload            json.RawMessage
		audience           json.RawMessage
	}
	var rows []row
	testapp.WaitFor(t, func() bool {
		result, err := f.app.DB.Query(context.Background(), `SELECT topic, kind, actor, payload, audience FROM events WHERE kind LIKE 'route.%' ORDER BY id`)
		if err != nil {
			t.Fatal(err)
		}
		rows = rows[:0]
		for result.Next() {
			var r row
			result.Scan(&r.topic, &r.kind, &r.actor, &r.payload, &r.audience)
			rows = append(rows, r)
		}
		return len(rows) == 3
	})
	created := rows[0]
	setter := f.exec(`SELECT id FROM users WHERE username = 'setter'`)
	if created.actor != setter {
		t.Fatalf("created event actor = %q, want %q", created.actor, setter)
	}
	var change GymChange
	json.Unmarshal(created.payload, &change)
	record, _ := change.Record.(map[string]any)
	if created.topic != "gym_changes:"+f.gymA || created.kind != "route.created" || change.Collection != "routes" ||
		change.Action != "create" || record["id"] != id || string(created.audience) != `{"public": true}` {
		t.Fatalf("created event = %s %s %s %s", created.topic, created.kind, created.payload, created.audience)
	}
	var update GymChange
	json.Unmarshal(rows[1].payload, &update)
	if strings.Join(update.Changed, ",") != "archived,archived_at" {
		t.Fatalf("archive changed = %v", update.Changed)
	}
	if rows[1].kind != "route.updated" || rows[2].topic != TopicRouteArchived || rows[2].kind != TopicRouteArchived {
		t.Fatalf("archive events = %+v", rows[1:])
	}
	var archived RouteArchived
	json.Unmarshal(rows[2].payload, &archived)
	if archived.Route != id || archived.Gym != f.gymA {
		t.Fatalf("route.archived payload = %s", rows[2].payload)
	}
}

func TestUpdateEventsNameChangedFields(t *testing.T) {
	f := newFixture(t)
	latest := func(kind string) []string {
		t.Helper()
		var payload []byte
		if err := f.app.DB.QueryRow(context.Background(), `SELECT payload FROM events WHERE kind = $1 ORDER BY id DESC LIMIT 1`, kind).Scan(&payload); err != nil {
			t.Fatal(err)
		}
		var change GymChange
		json.Unmarshal(payload, &change)
		return change.Changed
	}
	expect := func(kind string, want ...string) {
		t.Helper()
		if got := latest(kind); strings.Join(got, ",") != strings.Join(want, ",") {
			t.Errorf("%s changed = %v, want %v", kind, got, want)
		}
	}
	wall := f.wall(f.hall, "Slab")
	id := f.route("")
	f.call("setter", "PATCH", "/routes/"+id, `{"name":"Renamed","grade":"6a","comment":"new"}`, http.StatusOK)
	expect("route.updated", "comment", "name")
	f.call("setter", "POST", "/routes/"+id+"/archive", "", http.StatusOK)
	expect("route.updated", "archived", "archived_at")
	f.call("setter", "POST", "/gyms/"+f.gymA+"/routes/archive", `{"ids":["`+id+`"],"archived":false}`, http.StatusOK)
	expect("route.updated", "archived", "archived_at")
	f.call("setter", "PUT", "/gyms/"+f.gymA+"/map/placements", `{"placements":[{"route":"`+id+`","wall":"`+wall+`","wall_position":0.5}]}`, http.StatusOK)
	expect("route.updated", "wall", "wall_position")
	f.call("admin", "PATCH", "/walls/"+wall, `{"sort":4,"name":"Slab"}`, http.StatusOK)
	expect("wall.updated", "sort")
	f.call("admin", "PATCH", "/locations/"+f.hall, `{"name":"Main"}`, http.StatusOK)
	expect("location.updated", "name")
}
