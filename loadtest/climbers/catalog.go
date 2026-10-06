package main

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	mrand "math/rand/v2"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
)

type gym struct {
	id, slug    string
	routes      []map[string]any
	locations   []string
	competition string
	category    string
	compRoutes  []string
}

var (
	gyms        []*gym
	assetPaths  []string
	routeVideos sync.Map
)

// loadCatalog fetches ids out-of-band once, so sessions never send lookups a browser would not make.
func loadCatalog() {
	plain := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
	get := func(path string) []map[string]any {
		resp, err := plain.Get(*baseURL + path)
		if err != nil {
			fmt.Println("catalog:", err)
			os.Exit(1)
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			fmt.Println("catalog:", path, resp.Status)
			os.Exit(1)
		}
		var result items
		_ = json.NewDecoder(resp.Body).Decode(&result)
		return result.Items
	}
	for i := range *gymCount {
		slug := fmt.Sprintf("load-%d", i)
		found := get(list("gyms", url.Values{"perPage": {"1"}, "filter": {fmt.Sprintf(`slug = "%s"`, slug)}}))
		if len(found) == 0 {
			continue
		}
		g := &gym{id: found[0]["id"].(string), slug: slug}
		g.routes = get(list("averageRating", all(url.Values{
			"filter": {fmt.Sprintf(`gym = "%s" && archived = false`, g.id)}, "fields": {"id,grade,grade_system,grade_index,type,location"},
		})))
		for _, location := range get(list("locations", all(url.Values{"filter": {fmt.Sprintf(`gym = "%s"`, g.id)}, "sort": {"name"}}))) {
			g.locations = append(g.locations, location["id"].(string))
		}
		if comps := get(list("competitions", url.Values{"perPage": {"1"}, "filter": {fmt.Sprintf(`gym = "%s" && status = "open"`, g.id)}})); len(comps) > 0 {
			g.competition = comps[0]["id"].(string)
			if categories := get(list("competition_categories", url.Values{"perPage": {"1"}, "filter": {fmt.Sprintf(`competition = "%s"`, g.competition)}, "sort": {"sort"}})); len(categories) > 0 {
				g.category = categories[0]["id"].(string)
			}
			for _, route := range get(list("competition_routes", all(url.Values{"filter": {fmt.Sprintf(`competition = "%s"`, g.competition)}}))) {
				g.compRoutes = append(g.compRoutes, route["id"].(string))
			}
		}
		if len(g.routes) == 0 || len(g.locations) == 0 {
			fmt.Println("catalog: skipping", slug, "without routes or locations")
			continue
		}
		if len(g.compRoutes) == 0 {
			g.competition = ""
		}
		for _, video := range get(list("beta_videos", all(url.Values{"filter": {fmt.Sprintf(`gym = "%s" && file != ""`, g.id)}}))) {
			rememberVideo(video)
		}
		gyms = append(gyms, g)
	}
	if *assetsFile != "" {
		data, err := os.ReadFile(*assetsFile)
		if err != nil {
			fmt.Println("assets:", err)
			os.Exit(1)
		}
		for _, line := range strings.Split(string(data), "\n") {
			if line = strings.TrimSpace(line); line != "" {
				assetPaths = append(assetPaths, line)
			}
		}
	}
	if len(gyms) == 0 {
		fmt.Println("catalog: no usable gyms at", *baseURL)
		os.Exit(1)
	}
	fmt.Printf("catalog: %d gyms, %d cold-visit assets\n", len(gyms), len(assetPaths))
}

func rememberVideo(video map[string]any) {
	route, _ := video["route"].(string)
	file, _ := video["file"].(string)
	if route == "" || file == "" {
		return
	}
	path := fmt.Sprintf("/api/files/%s/%s/%s", video["collectionId"], video["id"], url.PathEscape(file))
	existing, _ := routeVideos.LoadOrStore(route, &sync.Map{})
	existing.(*sync.Map).Store(path, true)
}

func videosOf(route string) []string {
	found, ok := routeVideos.Load(route)
	if !ok {
		return nil
	}
	paths := []string{}
	found.(*sync.Map).Range(func(path, _ any) bool {
		paths = append(paths, path.(string))
		return true
	})
	return paths
}

func randomGym() *gym { return gyms[mrand.IntN(len(gyms))] }

// homeGym mirrors seed.ts, which spreads the seeded climbers evenly over the gyms.
func homeGym(n int) *gym { return gyms[n*len(gyms)/max(1, *seededUsers)%len(gyms)] }

func (g *gym) randomRoute() map[string]any {
	return g.routes[mrand.IntN(len(g.routes))]
}
