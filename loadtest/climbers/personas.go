package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	mrand "math/rand/v2"
	"mime/multipart"
	"net/url"
	"sync"
	"sync/atomic"
	"time"
)

var nextClimber atomic.Int64

func climberEmail() (string, int) {
	n := int(nextClimber.Add(1)-1) % (*seededUsers - 100)
	return fmt.Sprintf("load-%d@gripello.test", n), n
}

type weighted struct {
	page   string
	weight int
}

var (
	guestPages   = []weighted{{"route", 30}, {"routes", 15}, {"map", 15}, {"overview", 10}, {"leaderboard", 10}, {"feed", 10}}
	climberPages = []weighted{{"route", 30}, {"routes", 12}, {"map", 12}, {"overview", 8}, {"leaderboard", 8}, {"feed", 8}, {"logbook", 8}, {"friends", 8}, {"profile", 6}}
)

func pick(pages []weighted) string {
	total := 0
	for _, p := range pages {
		total += p.weight
	}
	roll := mrand.IntN(total)
	for _, p := range pages {
		if roll -= p.weight; roll < 0 {
			return p.page
		}
	}
	return pages[0].page
}

// browseSession runs one visit: an entry full load, then client navigations with occasional reloads.
func (c *client) browseSession(entry string, pages []weighted, act func(page, arg string)) {
	page, arg := entry, ""
	if entry == "qr" || entry == "route" {
		arg = c.gym.randomRoute()["id"].(string)
	}
	c.fullLoad(entry, arg, mrand.Float64() < *coldShare)
	if entry == "qr" {
		page = "route"
	}
	refetch := func() { c.refetchLoaded(page, arg) }
	for views := 5 + mrand.IntN(20); views > 0 && c.wait(1, refetch); views-- {
		page, arg = pick(pages), ""
		switch page {
		case "route":
			arg = c.gym.randomRoute()["id"].(string)
		case "profile":
			arg = c.me()
		}
		if mrand.Float64() < *hardShare {
			c.fullLoad(page, arg, false)
		} else {
			c.navigate(page, arg)
		}
		if act != nil {
			act(page, arg)
		}
	}
	c.end()
}

func guest() {
	for !stopping.Load() {
		c := newClient(randomGym())
		entry := "overview"
		if mrand.IntN(2) == 0 {
			entry = "qr"
		}
		c.browseSession(entry, guestPages, nil)
		if !pause(3) {
			return
		}
	}
}

func (c *client) login(email string) bool {
	c.do("ssr:login", "GET", "/auth/login", nil, nil)
	c.do("auth:methods", "GET", "/api/collections/users/auth-methods?fields=mfa,otp,password,oauth2", nil, nil)
	var auth struct {
		Token  string         `json:"token"`
		Record map[string]any `json:"record"`
	}
	if !c.do("auth:login", "POST", "/api/collections/users/auth-with-password", map[string]any{"identity": email, "password": *password}, &auth) {
		return false
	}
	c.token, c.user = auth.Token, auth.Record
	c.setCookie()
	for range 3 {
		c.do("auth:me", "GET", "/api/collections/users/records/"+c.me()+"?expand=memberships_via_user.gym,memberships_via_user.role.permissions", nil, nil)
	}
	c.do("api:version", "GET", "/api/version", nil, nil)
	c.do("api:version", "GET", "/api/version", nil, nil)
	c.do("api:health", "GET", "/api/health", nil, nil)
	c.do("api:online", "GET", "/api/online", nil, nil)
	c.do("api:follows", "GET", list("follows", all(url.Values{})), nil, nil)
	c.do("api:gym-switcher", "GET", list("gyms", all(url.Values{"filter": {"active = true"}, "fields": {"id,collectionId,slug,name,unit_name,page_logo"}, "sort": {"name"}})), nil, nil)
	c.do("api:notifications", "GET", list("notifications", all(url.Values{"sort": {"-created"}})), nil, nil)
	c.do("auth:refresh", "POST", "/api/collections/users/auth-refresh", nil, nil)
	return true
}

func climber() {
	email, n := climberEmail()
	c := newClient(homeGym(n))
	if !c.login(email) {
		return
	}
	known := map[string]bool{}
	views := 0
	act := func(page, arg string) {
		views++
		route := c.gym.randomRoute()
		if page == "route" {
			route = map[string]any{"id": arg}
		}
		if *tickEvery > 0 && views%*tickEvery == 0 {
			c.logTick(route["id"].(string))
		}
		switch roll := mrand.IntN(300); {
		case roll < 25:
			c.rate(c.gym.randomRoute())
		case roll < 55:
			c.markNotificationRead()
		case roll < 60 && len(known) > 0:
			for other := range known {
				c.follow(other)
				break
			}
		case roll < 62:
			c.betaLink(route["id"].(string))
		case roll < 64:
			c.reportDefect(route["id"].(string))
		}
	}
	for first := true; !stopping.Load(); first = false {
		entry := "overview"
		if !first && mrand.IntN(3) == 0 {
			entry = "qr"
		}
		c.browseSession(entry, climberPages, act)
		for _, other := range c.known {
			if len(known) < 100 {
				known[other] = true
			}
		}
		if !pause(3) {
			return
		}
	}
}

func multipartOf(fields map[string]string) multipartBody {
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	for key, value := range fields {
		_ = form.WriteField(key, value)
	}
	_ = form.Close()
	return multipartBody{body.Bytes(), form.FormDataContentType()}
}

func (c *client) logTick(route string) {
	id := recordID()
	now := time.Now().UTC().Format("2006-01-02 15:04:05.000Z")
	trackWrite("tick", id)
	if c.do("write:tick", "POST", "/api/collections/ticks/records", map[string]any{
		"id": id, "user": c.me(), "route": route, "type": []string{"flash", "top", "top", "attempt"}[mrand.IntN(4)],
		"attempts": 1 + mrand.IntN(4), "date": time.Now().UTC().Format(time.DateOnly) + " 12:00:00.000Z", "note": "",
		"created": now, "updated": now,
	}, nil) {
		c.do("api:tick-sends", "GET", list("tick_sends", all(url.Values{"fields": {"route"}})), nil, nil)
		time.Sleep(300 * time.Millisecond)
		c.do("api:tick-sends", "GET", list("tick_sends", all(url.Values{"fields": {"route"}})), nil, nil)
	}
}

func (c *client) rate(route map[string]any) {
	id := recordID()
	trackWrite("rating", id)
	c.do("write:rating", "POST", "/api/collections/ratings/records", map[string]any{
		"id": id, "route_id": route["id"], "rating": 1 + mrand.IntN(5),
		"grade": route["grade"], "grade_system": route["grade_system"], "grade_index": route["grade_index"], "comment": "load test",
	}, nil)
}

func (c *client) markNotificationRead() {
	if c.unread == "" {
		return
	}
	c.do("write:notification-read", "PATCH", "/api/collections/notifications/records/"+c.unread, map[string]any{"read": true}, nil)
	c.unread = ""
	c.navigate("profile", c.me())
}

func (c *client) follow(other string) {
	if other == c.me() {
		return
	}
	c.do("write:follow", "POST", "/api/collections/follows/records", map[string]any{"follower": c.me(), "followee": other}, nil, 400)
	c.do("api:follows", "GET", list("follows", all(url.Values{})), nil, nil)
	c.do("api:follows", "GET", list("follows", all(url.Values{})), nil, nil)
	c.do("api:climber", "GET", "/api/climbers/"+other, nil, nil)
}

func (c *client) betaLink(route string) {
	if c.do("write:beta-link", "POST", "/api/collections/beta_videos/records", multipartOf(map[string]string{
		"route": route, "user": c.me(), "url": fmt.Sprintf("https://youtube.com/shorts/%d", 100000+mrand.IntN(900000)),
	}), nil) {
		c.do("api:beta-videos", "GET", list("beta_videos", all(url.Values{"filter": {fmt.Sprintf(`route = "%s"`, route)}, "sort": {"-created"}})), nil, nil)
	}
}

func (c *client) reportDefect(route string) {
	if c.do("write:defect", "POST", "/api/collections/tasks/records", multipartOf(map[string]string{
		"kind": "defect", "route": route, "description": "load test",
		"category": []string{"loose_hold", "spinning_hold", "label_tag", "other"}[mrand.IntN(4)],
	}), nil) {
		c.do("api:route-defects", "GET", list("open_route_defects", all(url.Values{"filter": {fmt.Sprintf(`route = "%s"`, route)}})), nil, nil)
	}
}

type competitionChange struct {
	Competition string `json:"competition"`
	Kind        string `json:"kind"`
	Entry       string `json:"entry"`
	At          int64  `json:"at"`
}

// watchCompetition wires the live-results behaviour shared by competitors, spectators, TV and judges.
func (c *client) watchCompetition(onScores func(change competitionChange)) (lastAt *atomic.Int64) {
	lastAt = &atomic.Int64{}
	var resultsPending, competitionPending, categoriesPending atomic.Bool
	c.pageTopic = []string{"competition_changes:" + c.gym.competition}
	c.onEvent = func(topic, data string) {
		var change competitionChange
		if topic != "competition_changes:"+c.gym.competition || json.Unmarshal([]byte(data), &change) != nil {
			return
		}
		lastAt.Store(change.At)
		switch change.Kind {
		case "categories":
			later(&categoriesPending, 0, 500*time.Millisecond, c.competitionCategories)
			return
		case "competition":
			later(&competitionPending, 0, 500*time.Millisecond, c.competitionRecord)
		}
		later(&resultsPending, time.Second, 2*time.Second, func() { c.results(lastAt.Load()) })
		if change.Kind == "scores" && onScores != nil {
			onScores(change)
		}
	}
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-stopSignal:
				return
			case <-c.done:
				return
			case <-ticker.C:
				c.results(lastAt.Load())
			}
		}
	}()
	return lastAt
}

func (c *client) results(since int64) {
	path := "/api/ui/competition-results?id=" + c.gym.competition
	if since > 0 {
		path += fmt.Sprintf("&since=%d", since)
	}
	c.do("api:competition-results", "GET", path, nil, nil)
}

func (c *client) competitionRecord() {
	c.do("api:competition", "GET", "/api/collections/competitions/records/"+c.gym.competition, nil, nil)
}

func (c *client) competitionCategories() {
	c.do("api:competition-categories", "GET", list("competition_categories", all(url.Values{
		"filter": {fmt.Sprintf(`competition = "%s"`, c.gym.competition)}, "sort": {"sort,name"},
	})), nil, nil)
}

func (c *client) myEntry() map[string]any {
	var entries items
	c.do("api:comp-entry", "GET", list("competition_entries", url.Values{
		"page": {"1"}, "perPage": {"1"}, "filter": {fmt.Sprintf(`competition = "%s" && user = "%s"`, c.gym.competition, c.me())},
	}), nil, &entries)
	if len(entries.Items) == 0 {
		return nil
	}
	return entries.Items[0]
}

// scoreBook maps "entry/compRoute" to score ids; it is shared between a persona and its event goroutines.
type scoreBook struct {
	sync.Mutex
	ids map[string]string
}

func (b *scoreBook) get(entry, route string) (string, bool) {
	b.Lock()
	defer b.Unlock()
	id, ok := b.ids[entry+"/"+route]
	return id, ok
}

func (b *scoreBook) load(scores []map[string]any) {
	b.Lock()
	defer b.Unlock()
	for _, score := range scores {
		b.ids[score["entry"].(string)+"/"+score["comp_route"].(string)] = score["id"].(string)
	}
}

// submitScore writes a score like the scorecard: POST on the first touch of a route, PATCH afterwards.
func (c *client) submitScore(label string, book *scoreBook, entry, route string) {
	attempts := 1 + mrand.IntN(5)
	body := map[string]any{"attempts": attempts, "zone_attempt": 1, "top_attempt": attempts, "style": ""}
	trackWrite("score", entry)
	if id, ok := book.get(entry, route); ok {
		c.do(label, "PATCH", "/api/collections/competition_scores/records/"+id, body, nil)
		return
	}
	body["entry"], body["comp_route"] = entry, route
	var created map[string]any
	if c.do(label, "POST", "/api/collections/competition_scores/records", body, &created) {
		book.load([]map[string]any{created})
	}
}

func (c *client) competitionResync(lastAt *atomic.Int64) func() {
	return func() {
		c.competitionCategories()
		c.competitionRecord()
		c.results(lastAt.Load())
	}
}

func competitor() {
	email, n := climberEmail()
	c := newClient(homeGym(n))
	defer c.end()
	if c.gym.competition == "" || !c.login(email) {
		return
	}
	var entryID atomic.Value
	entryID.Store("")
	var scoresPending atomic.Bool
	book := &scoreBook{ids: map[string]string{}}
	ownScores := func() {
		var scores items
		c.do("api:comp-scores", "GET", list("competition_scores", all(url.Values{"filter": {fmt.Sprintf(`entry = "%s"`, entryID.Load())}})), nil, &scores)
		book.load(scores.Items)
	}
	lastAt := c.watchCompetition(func(change competitionChange) {
		if entry := entryID.Load().(string); entry != "" && change.Entry == entry {
			later(&scoresPending, 400*time.Millisecond, 800*time.Millisecond, ownScores)
		}
	})
	c.fullLoad("competition", "", mrand.Float64() < *coldShare)
	entry := c.myEntry()
	c.competitionResync(lastAt)()
	if entry == nil {
		var created map[string]any
		c.do("write:comp-register", "POST", "/api/collections/competition_entries/records", map[string]any{
			"competition": c.gym.competition, "user": c.me(), "category": c.gym.category,
			"display_name": fmt.Sprintf("Climber %d", n), "birth_year": 1990, "hidden": false, "guardian_consent": false,
		}, &created, 400)
		entry = c.myEntry()
		c.myEntry()
		if entry == nil {
			return
		}
	}
	entryID.Store(entry["id"].(string))
	c.do("api:comp-routes", "GET", list("competition_routes", all(url.Values{
		"filter": {fmt.Sprintf(`competition = "%s" && voided = false`, c.gym.competition)}, "sort": {"number"}, "expand": {"route"},
	})), nil, nil)
	ownScores()
	for c.wait(float64(*scoreEvery)/float64(*think), c.competitionResync(lastAt)) {
		c.submitScore("write:comp-score", book, entry["id"].(string), c.gym.compRoutes[mrand.IntN(len(c.gym.compRoutes))])
	}
}

func spectator() {
	c := newClient(randomGym())
	defer c.end()
	if c.gym.competition == "" {
		return
	}
	lastAt := c.watchCompetition(nil)
	for cold := mrand.Float64() < *coldShare; !stopping.Load(); cold = false {
		c.fullLoad("competition", "", cold)
		c.competitionResync(lastAt)()
		if !c.wait(60, c.competitionResync(lastAt)) {
			return
		}
	}
}

func tv() {
	c := newClient(randomGym())
	defer c.end()
	if c.gym.competition == "" {
		return
	}
	lastAt := c.watchCompetition(nil)
	c.fullLoad("tv", "", false)
	resync := func() { c.results(lastAt.Load()) }
	resync()
	for c.wait(1000, resync) {
	}
}

func setter(index int) {
	g := gyms[index%len(gyms)]
	c := newClient(g)
	defer c.end()
	if !c.login(fmt.Sprintf("load-%d@gripello.test", *seededUsers-100+(index%len(gyms))*5+index/len(gyms)%5)) {
		return
	}
	var reloadPending, boardPending atomic.Bool
	reloadRoutes := func() {
		c.do("api:manage-routes", "GET", list("averageRating", url.Values{
			"page": {"1"}, "perPage": {"25"}, "filter": {c.gymFilter("archived = false")}, "sort": {"-screw_date"}, "expand": {"location"},
		}), nil, nil)
	}
	loadBoard := func() items {
		var board items
		c.do("api:task-board", "GET", list("tasks", url.Values{
			"page": {"1"}, "perPage": {"200"}, "sort": {"-priority,due_date,-created"}, "expand": {"route,wall"},
			"filter": {c.gymFilter(`(status = "open" || status = "in_progress" || status = "waiting")`)},
		}), nil, &board)
		c.do("api:task-board-done", "GET", list("tasks", url.Values{
			"page": {"1"}, "perPage": {"30"}, "sort": {"-done_at"}, "expand": {"route,wall"}, "filter": {c.gymFilter(`status = "done"`)},
		}), nil, nil)
		c.do("api:file-token", "POST", "/api/files/token", nil, nil)
		return board
	}
	onRoutesPage := func() {
		c.pageTopic = []string{"routes/*", "ratings/*"}
		c.onEvent = func(topic, _ string) {
			if topic == "routes/*" || topic == "ratings/*" {
				later(&reloadPending, 500*time.Millisecond, time.Second, reloadRoutes)
			}
		}
		c.fullLoad("manage-routes", "", false)
	}
	onRoutesPage()
	created := []string{}
	for c.wait(6, reloadRoutes) {
		switch mrand.IntN(10) {
		case 0, 1, 2, 3:
			if id := c.createRoute(); id != "" {
				created = append(created, id)
			}
			reloadRoutes()
		case 4, 5:
			if len(created) > 0 {
				c.editRoute(created[len(created)-1])
				reloadRoutes()
			}
		case 6:
			if len(created) > 3 {
				requests := []map[string]any{}
				for _, id := range created[:3] {
					requests = append(requests, map[string]any{"method": "PATCH", "url": "/api/collections/routes/records/" + id, "body": map[string]any{"archived": true}})
				}
				if c.do("write:archive-routes", "POST", "/api/batch", map[string]any{"requests": requests}, nil) {
					created = created[3:]
				}
				reloadRoutes()
				c.unplacedRoutes()
			}
		case 7, 8:
			c.pageTopic = []string{"tasks/*"}
			c.onEvent = func(topic, _ string) {
				if topic == "tasks/*" {
					later(&boardPending, 500*time.Millisecond, 600*time.Millisecond, func() { loadBoard() })
				}
			}
			c.fullLoad("manage-tasks", "", false)
			c.do("api:task-assignees", "GET", list("task_assignees", all(url.Values{"filter": {c.gymFilter("")}, "sort": {"name"}})), nil, nil)
			for _, task := range loadBoard().Items {
				if task["kind"] == "defect" {
					c.do("write:task-status", "PATCH", "/api/collections/tasks/records/"+task["id"].(string)+"?expand=route,wall", map[string]any{"status": "done"}, nil)
					break
				}
			}
			c.wait(3, nil)
			onRoutesPage()
		case 9:
			if mrand.IntN(3) == 0 {
				c.pageTopic, c.onEvent = nil, nil
				c.fullLoad("manage-analytics", "", false)
				c.wait(3, nil)
				onRoutesPage()
			}
		}
	}
}

func (c *client) unplacedRoutes() {
	c.do("api:unplaced-walls", "GET", list("walls", all(url.Values{"filter": {c.gymFilter("")}, "fields": {"location"}})), nil, nil)
	c.do("api:unplaced-locations", "GET", list("locations", all(url.Values{"filter": {c.gymFilter("")}, "fields": {"id,map"}})), nil, nil)
	c.do("api:unplaced-routes", "GET", list("routes", url.Values{
		"page": {"1"}, "perPage": {"1"}, "skipTotal": {"1"}, "fields": {"location"},
		"filter": {fmt.Sprintf(`archived = false && wall = "" && location = "%s"`, c.gym.locations[0])},
	}), nil, nil)
}

func (c *client) routeFormData(location string) items {
	c.do("api:route-form-creators", "GET", list("routes", url.Values{
		"page": {"1"}, "perPage": {"500"}, "skipTotal": {"1"}, "filter": {c.gymFilter("")}, "fields": {"creator"}, "sort": {"-created"},
	}), nil, nil)
	c.do("api:used-colors", "GET", list("usedColors", all(url.Values{"fields": {"color"}, "filter": {c.gymFilter("")}})), nil, nil)
	var walls items
	c.do("api:form-walls", "GET", list("walls", all(url.Values{"filter": {fmt.Sprintf(`location = "%s"`, location)}, "sort": {"sort,name"}})), nil, &walls)
	return walls
}

func (c *client) createRoute() string {
	location := c.gym.locations[mrand.IntN(len(c.gym.locations))]
	walls := c.routeFormData(location)
	if len(walls.Items) == 0 {
		return ""
	}
	wall := walls.Items[mrand.IntN(len(walls.Items))]["id"].(string)
	c.do("api:wall-neighbours", "GET", list("routes", all(url.Values{"filter": {fmt.Sprintf(`wall = "%s" && archived = false`, wall)}, "fields": {"id,anchor_point,wall_position"}})), nil, nil)
	id := recordID()
	trackWrite("route", id)
	if !c.do("write:route", "POST", "/api/collections/routes/records", map[string]any{
		"id": id, "name": "load new " + id[:6], "grade": "6a", "grade_system": "font", "grade_index": 15,
		"location": location, "wall": wall, "type": "Boulder", "creator": []string{"Load Setter"}, "comment": "",
		"screw_date": time.Now().Format(time.DateOnly), "color": "#1e88e5", "anchor_point": 1, "archived": false, "permanent": false,
		"wall_position": mrand.Float64(),
	}, nil) {
		return ""
	}
	c.unplacedRoutes()
	return id
}

func (c *client) editRoute(id string) {
	c.routeFormData(c.gym.locations[0])
	c.do("write:route-edit", "PATCH", "/api/collections/routes/records/"+id, map[string]any{"comment": "edited " + recordID()[:4]}, nil)
	c.unplacedRoutes()
}

func judge(index int) {
	g := gyms[index%len(gyms)]
	c := newClient(g)
	defer c.end()
	if g.competition == "" || !c.login(fmt.Sprintf("load-%d@gripello.test", *seededUsers-100+(index%len(gyms))*5+4)) {
		return
	}
	var entries items
	var scoresPending atomic.Bool
	book := &scoreBook{ids: map[string]string{}}
	allScores := func() {
		var scores items
		c.do("api:judge-scores", "GET", list("competition_scores", all(url.Values{"filter": {fmt.Sprintf(`competition = "%s"`, g.competition)}})), nil, &scores)
		book.load(scores.Items)
	}
	c.watchCompetition(func(competitionChange) {
		later(&scoresPending, 400*time.Millisecond, 800*time.Millisecond, allScores)
	})
	c.fullLoad("judge", "", false)
	resync := func() {
		c.do("api:judge-routes", "GET", list("competition_routes", all(url.Values{
			"filter": {fmt.Sprintf(`competition = "%s" && voided = false`, g.competition)}, "sort": {"number"}, "expand": {"route.wall"},
		})), nil, nil)
		c.do("api:judge-entries", "GET", list("competition_entries", all(url.Values{
			"filter": {fmt.Sprintf(`competition = "%s" && (status = "registered" || status = "checked_in")`, g.competition)}, "sort": {"bib"},
		})), nil, &entries)
		allScores()
	}
	resync()
	for c.wait(float64(*scoreEvery)/float64(*think), resync) {
		if len(entries.Items) > 0 {
			c.submitScore("write:judge-score", book, entries.Items[mrand.IntN(len(entries.Items))]["id"].(string), g.compRoutes[mrand.IntN(len(g.compRoutes))])
		}
	}
}
