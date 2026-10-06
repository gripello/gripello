package main

import (
	"fmt"
	mrand "math/rand/v2"
	"net/url"
	"strings"
	"sync"
	"time"
)

var keepalivePages = map[string]bool{"overview": true, "routes": true, "map": true, "logbook": true}

func (c *client) path(page, arg string) string {
	switch page {
	case "overview":
		return "/" + c.gym.slug
	case "route":
		return "/" + c.gym.slug + "/route?id=" + arg
	case "qr":
		return "/route?id=" + arg
	case "logbook", "friends", "account":
		return "/" + page
	case "profile":
		return "/climber?id=" + arg
	case "competition":
		return "/" + c.gym.slug + "/competitions/" + c.gym.competition
	case "tv":
		return "/" + c.gym.slug + "/competitions/" + c.gym.competition + "/tv"
	case "manage-routes", "manage-tasks", "manage-analytics":
		return "/" + c.gym.slug + "/manage/" + strings.TrimPrefix(page, "manage-")
	case "judge":
		return "/" + c.gym.slug + "/manage/competitions/" + c.gym.competition + "/judge"
	}
	return "/" + c.gym.slug + "/" + page
}

func fetchAssets(c *client, paths []string) {
	var wg sync.WaitGroup
	queue := make(chan string)
	for range 16 {
		wg.Go(func() {
			for path := range queue {
				c.do("static", "GET", path, nil, nil)
			}
		})
	}
	for _, path := range paths {
		queue <- path
	}
	close(queue)
	wg.Wait()
}

// fullLoad is a document navigation: SSR, the hydration bundle every page sends, and a fresh SSE connection.
func (c *client) fullLoad(page, arg string, cold bool) {
	c.do("ssr:"+page, "GET", c.path(page, arg), nil, nil)
	warm := []string{"/app-icon.svg"}
	for _, path := range assetPaths {
		if strings.HasPrefix(path, "/_i18n/") || strings.HasPrefix(path, "/sw.js") {
			warm = append(warm, path)
		}
	}
	c.warm.Store(!cold)
	if cold && len(assetPaths) > 0 {
		fetchAssets(c, assetPaths)
	} else {
		fetchAssets(c, warm)
	}
	c.warm.Store(true)
	c.do("api:version", "GET", "/api/version", nil, nil)
	c.do("api:health", "GET", "/api/health", nil, nil)
	c.do("api:online", "GET", "/api/online", nil, nil)
	if c.signedIn() {
		var notifications items
		c.do("api:notifications", "GET", list("notifications", all(url.Values{"sort": {"-created"}})), nil, &notifications)
		for _, item := range notifications.Items {
			if read, _ := item["read"].(bool); !read {
				c.unread = item["id"].(string)
				break
			}
		}
	}
	c.loaded = map[string]bool{page: true, "tick_sends": c.signedIn()}
	if page == "routes" || page == "map" || page == "route" {
		c.loaded["locations"], c.loaded["defects"] = true, true
	}
	switch page {
	case "logbook":
		c.loaded = map[string]bool{}
		c.navigate("logbook", "")
	case "route", "qr":
		c.previewVideos(arg)
	case "manage-routes":
		c.unplacedRoutes()
	}
	c.openRealtime()
}

// navigate is a client-side navigation: keepalive pages fetch only on their first visit.
func (c *client) navigate(page, arg string) {
	if keepalivePages[page] && c.loaded[page] {
		return
	}
	c.loaded[page] = true
	c.fetchPage(page, arg)
}

func (c *client) tickSends() {
	if c.signedIn() && !c.loaded["tick_sends"] {
		c.loaded["tick_sends"] = true
		c.do("api:tick-sends", "GET", list("tick_sends", all(url.Values{"fields": {"route"}})), nil, nil)
	}
}

func (c *client) locationsAndDefects() {
	if !c.loaded["locations"] {
		c.loaded["locations"] = true
		c.do("api:locations", "GET", list("locations", all(url.Values{"filter": {c.gymFilter("")}, "sort": {"name"}})), nil, nil)
	}
	if !c.loaded["defects"] {
		c.loaded["defects"] = true
		c.do("api:open-defects", "GET", list("open_route_defects", all(url.Values{"filter": {c.gymFilter("")}, "fields": {"route,category"}})), nil, nil)
	}
}

func (c *client) fetchPage(page, arg string) {
	switch page {
	case "overview":
		c.tickSends()
		c.do("api:overview-routes", "GET", list("averageRating", all(url.Values{
			"filter": {c.gymFilter("archived = false")},
			"fields": {"id,name,color,grade,grade_system,grade_index,anchor_point,type,location,wall,screw_date,average_rating,ratings_count"},
		})), nil, nil)
		c.do("api:overview-walls", "GET", list("walls", all(url.Values{"filter": {c.gymFilter("")}, "fields": {"id,name,location,sort"}, "sort": {"sort,name"}})), nil, nil)
	case "routes":
		c.tickSends()
		c.locationsAndDefects()
		c.do("api:route-list", "GET", list("averageRating", url.Values{
			"page": {"1"}, "perPage": {"20"}, "filter": {c.gymFilter("archived = false")}, "sort": {"-screw_date"}, "expand": {"location,wall"},
		}), nil, nil)
		c.do("api:cap-status", "GET", "/api/cap/status", nil, nil)
	case "route":
		c.do("api:route", "GET", "/api/collections/routes/records/"+arg+"?expand=location,wall", nil, nil)
		c.do("api:route-ratings", "GET", list("ratings", all(url.Values{"filter": {fmt.Sprintf(`route_id = "%s"`, arg)}, "sort": {"-created"}})), nil, nil)
		c.do("api:route-defects", "GET", list("open_route_defects", all(url.Values{"filter": {fmt.Sprintf(`route = "%s"`, arg)}})), nil, nil)
		c.do("api:beta-videos", "GET", list("beta_videos", all(url.Values{"filter": {fmt.Sprintf(`route = "%s"`, arg)}, "sort": {"-created"}})), nil, nil)
		c.previewVideos(arg)
	case "map":
		c.tickSends()
		c.locationsAndDefects()
		location := c.gym.locations[0]
		c.do("api:map-walls", "GET", list("walls", all(url.Values{"filter": {fmt.Sprintf(`location = "%s"`, location)}, "sort": {"sort,name"}})), nil, nil)
		c.do("api:map-routes", "GET", list("averageRating", all(url.Values{
			"filter": {fmt.Sprintf(`archived = false && location = "%s"`, location)},
			"fields": {"id,name,color,grade,grade_system,grade_index,anchor_point,location,type,comment,creator,screw_date,wall,wall_position,average_rating,ratings_count"},
		})), nil, nil)
	case "leaderboard":
		c.do("api:seasons", "GET", list("seasons", all(url.Values{"filter": {c.gymFilter("")}, "sort": {"-starts_at"}})), nil, nil)
		c.do("api:leaderboard", "GET", "/api/gyms/"+c.gym.id+"/leaderboard?kind=boulder", nil, nil)
		if mrand.IntN(4) == 0 {
			c.do("api:leaderboard", "GET", "/api/gyms/"+c.gym.id+"/leaderboard?kind=route", nil, nil)
		}
	case "feed":
		c.do("api:feed-routes", "GET", list("routes", all(url.Values{
			"sort": {"-created"}, "expand": {"wall"},
			"filter": {c.gymFilter(fmt.Sprintf(`archived = false && created >= "%s"`, time.Now().AddDate(0, 0, -30).UTC().Format("2006-01-02 15:04:05.000Z")))},
		})), nil, nil)
		c.do("api:feed-beta-videos", "GET", list("beta_videos", url.Values{
			"page": {"1"}, "perPage": {"20"}, "filter": {c.gymFilter("")}, "sort": {"-created"}, "expand": {"route"},
		}), nil, nil)
		if c.signedIn() {
			c.climbersOf("api:feed-friend-ticks", list("friend_ticks", url.Values{
				"page": {"1"}, "perPage": {"100"}, "sort": {"-created"}, "expand": {"route"}, "filter": {fmt.Sprintf(`route.gym = "%s"`, c.gym.id)},
			}))
		}
	case "friends":
		c.climbersOf("api:friends-feed", list("friend_ticks", url.Values{
			"page": {"1"}, "perPage": {"60"}, "sort": {"-date,-created"}, "expand": {"route"},
		}))
	case "logbook":
		c.tickSends()
		c.do("api:logbook", "GET", list("ticks", all(url.Values{"sort": {"-date,-created"}, "expand": {"route.gym"}})), nil, nil)
	case "profile":
		c.do("api:climber", "GET", "/api/climbers/"+arg, nil, nil)
		if arg == c.me() {
			c.do("api:own-ticks", "GET", list("ticks", all(url.Values{"filter": {fmt.Sprintf(`user = "%s"`, arg)}, "sort": {"-date"}, "expand": {"route"}})), nil, nil)
			c.do("api:achievements", "GET", "/api/climbers/"+arg+"/achievements", nil, nil)
			return
		}
		c.do("api:own-ticks", "GET", list("ticks", all(url.Values{"fields": {"id,route,type,attempts,date,grade,grade_system,grade_index"}})), nil, nil)
		c.do("api:climber-ticks", "GET", list("friend_ticks", all(url.Values{"filter": {fmt.Sprintf(`user = "%s"`, arg)}, "sort": {"-date"}, "expand": {"route"}})), nil, nil)
	}
}

func (c *client) climbersOf(label, path string) {
	var ticks items
	c.do(label, "GET", path, nil, &ticks)
	ids := map[string]bool{}
	for _, tick := range ticks.Items {
		if user, _ := tick["user"].(string); user != "" {
			ids[user] = true
		}
	}
	if len(ids) == 0 {
		return
	}
	joined := make([]string, 0, len(ids))
	for id := range ids {
		joined = append(joined, id)
	}
	c.known = append(c.known[:0:0], joined...)
	c.do("api:climbers", "GET", "/api/climbers?ids="+strings.Join(joined, ","), nil, nil)
}

// refetchLoaded mirrors refreshLiveKeys after an SSE reconnect: every loaded live key, spread over 0-5 s.
func (c *client) refetchLoaded(current, arg string) {
	pages := []string{}
	for page := range c.loaded {
		if keepalivePages[page] || page == current {
			pages = append(pages, page)
		}
	}
	for _, page := range pages {
		time.Sleep(time.Duration(mrand.IntN(5000/max(1, len(pages)))) * time.Millisecond)
		switch page {
		case "overview", "map":
			c.fetchPage(page, arg)
		case "routes":
			c.do("api:route-list", "GET", list("averageRating", url.Values{
				"page": {"1"}, "perPage": {"20"}, "filter": {c.gymFilter("archived = false")}, "sort": {"-screw_date"}, "expand": {"location,wall"},
			}), nil, nil)
			c.do("api:open-defects", "GET", list("open_route_defects", all(url.Values{"filter": {c.gymFilter("")}, "fields": {"route,category"}})), nil, nil)
		case "route":
			c.fetchPage("route", arg)
		}
	}
}
