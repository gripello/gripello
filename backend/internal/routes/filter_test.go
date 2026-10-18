package routes

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"slices"
	"testing"
)

// The fixture is shared with routeMatchesQuery (app/utils/routeSearch.ts), which patches live lists the same way.
func TestRouteFilterMatchesTheClientFixture(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/routeFilter.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Routes []map[string]any `json:"routes"`
		Cases  []struct {
			Query map[string]any `json:"query"`
			Names []string       `json:"names"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	f := newFixture(t)
	places := map[string]string{"hall": f.hall, "annex": f.hallB, "north": f.wall(f.hall, "North")}
	for _, route := range fixture.Routes {
		route["location"] = places[route["location"].(string)]
		if wall, ok := route["wall"].(string); ok {
			route["wall"] = places[wall]
		}
		archived := route["archived"] == true
		delete(route, "archived")
		body, _ := json.Marshal(route)
		id := f.call("setter", "POST", "/gyms/"+f.gymA+"/routes", string(body), http.StatusCreated)["id"].(string)
		if archived {
			f.call("setter", "POST", "/routes/"+id+"/archive", "", http.StatusOK)
		}
	}
	for _, c := range fixture.Cases {
		query := url.Values{}
		for key, value := range c.Query {
			switch v := value.(type) {
			case []any:
				for _, item := range v {
					query.Add(key, item.(string))
				}
			case string:
				if place, ok := places[v]; ok && (key == "location" || key == "wall") {
					v = place
				}
				query.Set(key, v)
			}
		}
		names := []string{}
		for _, item := range items(f.call("climber", "GET", "/gyms/"+f.gymA+"/routes?"+query.Encode(), "", http.StatusOK)) {
			names = append(names, item.(map[string]any)["name"].(string))
		}
		slices.Sort(names)
		if !slices.Equal(names, c.Names) {
			t.Errorf("%v = %v, want %v", c.Query, names, c.Names)
		}
	}
}
