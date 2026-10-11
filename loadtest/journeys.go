package main

import (
	"fmt"
	"net/url"
	"strings"
	"time"
)

// Request sequences recorded from the app with record.ts (client navigation after an SSR entry); refresh them there.

var personas = []string{"guest", "qr", "climber", "social", "spectator", "competitor"}

func (p *phone) gymAPI(path string) string { return "/api/gyms/" + p.gym.id + path }

func (p *phone) page(path string) string { return "/" + p.gym.slug + path }

func (p *phone) once(key string, fetch func()) {
	if !p.cached["data:"+key] {
		p.cached["data:"+key] = true
		fetch()
	}
}

func (p *phone) locationsAndDefects() {
	p.once("locations", func() {
		p.get("GET /gyms/{gym}/locations", p.gymAPI("/locations"))
		p.get("GET /gyms/{gym}/defects/open", p.gymAPI("/defects/open"))
	})
}

func (p *phone) routesList() {
	p.locationsAndDefects()
	first := func() {
		p.get("GET /gyms/{gym}/routes (list)", p.gymAPI("/routes?include=location,wall&sort=-screw_date&page=1&limit=20&total=true"))
	}
	first()
	p.loaded("routes", first)
	p.once("cap", func() { p.get("GET /cap/status", "/api/cap/status") })
}

var routeSorts = []string{"-screw_date", "-average_rating", "grade_index", "-grade_index", "name"}

// filterRoutes is a tap on a filter pill, a sort change, a search or scrolling to the next page.
func (p *phone) filterRoutes() {
	q := url.Values{"include": {"location,wall"}, "sort": {pick(p, routeSorts)}, "page": {"1"}, "limit": {"20"}, "total": {"true"}}
	switch p.rng.IntN(5) {
	case 0:
		q.Set("type", pick(p, []string{"Boulder", "Route"}))
	case 1:
		q.Set("location", pick(p, p.gym.locations))
	case 2:
		q.Set("q", pick(p, []string{"1.", "2.4", "loadtest 3", "-1"}))
	case 3:
		q.Set("grade_system", "font")
		q.Add("grade", pick(p, []string{"6A", "6B", "6C"}))
		q.Add("grade", "6A+")
	case 4:
		q.Set("page", fmt.Sprint(2+p.rng.IntN(4)))
	}
	p.get("GET /gyms/{gym}/routes (filtered)", p.gymAPI("/routes?"+q.Encode()))
}

type rating struct {
	Author *person `json:"author"`
}

func (p *phone) routeDetail(id string) {
	fetch := func() { p.get("GET /routes/{id}", "/api/routes/"+id+"?include=location,wall") }
	fetch()
	var ratings struct{ Items []rating }
	p.get("GET /routes/{id}/ratings", "/api/routes/"+id+"/ratings?limit=500", &ratings)
	p.get("GET /routes/{id}/defects", "/api/routes/"+id+"/defects")
	if p.signedIn() {
		p.get("GET /me/blocks", "/api/me/blocks")
	}
	p.get("GET /routes/{id}/betas", "/api/routes/"+id+"/betas")
	var avatars []string
	for _, r := range ratings.Items {
		if r.Author != nil && len(avatars) < 10 {
			if a := avatar(*r.Author, "100x100"); a != "" {
				avatars = append(avatars, a)
			}
		}
	}
	p.images(avatars)
	p.loaded("route:"+id, fetch)
}

func (p *phone) mapPage() { p.locationsAndDefects() }

func (p *phone) info() { p.images(p.gym.images) }

func (p *phone) leaderboard() {
	p.get("GET /gyms/{gym}/seasons", p.gymAPI("/seasons"))
	season := ""
	if p.gym.season != "" {
		season = "&season=" + p.gym.season
	}
	p.get("GET /gyms/{gym}/leaderboard", p.gymAPI("/leaderboard?kind=boulder"+season))
	if p.rng.IntN(4) == 0 {
		p.get("GET /gyms/{gym}/leaderboard", p.gymAPI("/leaderboard?kind=route"+season))
	}
}

type feed struct {
	Items []struct {
		User string `json:"user"`
	} `json:"items"`
}

func (f feed) users() []string {
	var ids []string
	for _, item := range f.Items {
		if item.User != "" {
			ids = append(ids, item.User)
		}
	}
	return ids
}

func (p *phone) gymFeed() []string {
	since := time.Now().UTC().AddDate(0, 0, -30).Format("2006-01-02T15:04:05.000Z")
	fetch := func() {
		p.get("GET /gyms/{gym}/routes (new)", p.gymAPI("/routes?since="+since+"&include=wall&sort=-created&page=1&limit=1000"))
		p.get("GET /gyms/{gym}/betas", p.gymAPI("/betas?include=route&page=1&limit=20"))
	}
	fetch()
	p.loaded("feed", fetch)
	if !p.signedIn() {
		return nil
	}
	var f feed
	p.get("GET /me/feed (gym)", "/api/me/feed?gym="+p.gym.id+"&sort=-created&page=1&limit=100", &f)
	p.climbers(f.users(), "100x100")
	return f.users()
}

func (p *phone) friends() []string {
	var f feed
	p.get("GET /me/feed", "/api/me/feed?page=1&limit=60&sort=-date&total=true", &f)
	p.climbers(f.users(), "100x100")
	return f.users()
}

func (p *phone) logbook() {
	fetch := func() { p.get("GET /me/ticks", "/api/me/ticks?sort=-date,-created&page=1&limit=1000") }
	fetch()
	p.loaded("logbook", fetch)
}

func (p *phone) profile(id string) {
	var c person
	p.get("GET /climbers/{id}", "/api/climbers/"+id, &c)
	p.get("GET /climbers/{id}/ticks", "/api/climbers/"+id+"/ticks?page=1&limit=1000")
	p.get("GET /me/blocks", "/api/me/blocks")
	p.get("GET /climbers/{id}/achievements", "/api/climbers/"+id+"/achievements")
	if a := avatar(c, "320x320"); a != "" {
		p.images([]string{a})
	}
}

type entry struct {
	ID string `json:"id"`
}

// competition is the public competition page: live results refetched a second after each change and every minute.
func (p *phone) competition() (myEntry string) {
	c := p.gym.competition
	p.get("GET /competitions/{id}", "/api/competitions/"+c)
	if p.signedIn() {
		var mine struct{ Items []entry }
		p.get("GET /competitions/{id}/entries (mine)", "/api/competitions/"+c+"/entries?user="+p.acct.id, &mine)
		if len(mine.Items) > 0 {
			myEntry = mine.Items[0].ID
		}
	}
	results := func() { p.get("GET /competitions/{id}/standings", "/api/competitions/"+c+"/standings?view=public") }
	results()
	if p.signedIn() {
		p.get("GET /competitions/{id}/routes", "/api/competitions/"+c+"/routes?voided=false")
	}
	p.get("GET /competitions/{id}/categories", "/api/competitions/"+c+"/categories")
	if myEntry != "" {
		p.get("GET /competitions/{id}/scores (mine)", "/api/competitions/"+c+"/scores?entry="+myEntry)
	}
	p.loaded("results", results)
	p.subscribe("competition_changes:" + c)
	return myEntry
}

func (p *phone) tick(route string, burst bool) {
	id := newID(p)
	sent("tick:" + id)
	name := "POST /me/ticks"
	if burst {
		name += " (offline queue)"
	}
	p.write(name, "POST", "/api/me/ticks", map[string]any{
		"id": id, "user": p.acct.id, "route": route, "type": pick(p, []string{"flash", "top", "top", "attempt"}),
		"attempts": 1 + p.rng.IntN(5), "date": time.Now().UTC().Format("2006-01-02") + " 12:00:00.000Z", "note": "",
	}, nil)
}

func (p *phone) review(r route) {
	p.write("POST /routes/{id}/ratings", "POST", "/api/routes/"+r.ID+"/ratings", map[string]any{
		"route_id": r.ID, "rating": 1 + p.rng.IntN(5), "grade": r.Grade, "grade_system": r.GradeSystem, "grade_index": r.GradeIndex,
		"comment": pick(p, []string{"", "", "loadtest review: crimpy start, nice top"}),
	}, nil)
}

func (p *phone) reportDefect(route string) {
	p.write("POST /gyms/{gym}/tasks (defect)", "POST", p.gymAPI("/tasks"), map[string]any{
		"kind": "defect", "route": route, "category": pick(p, []string{"label_tag", "spinning_hold"}), "description": runMarker,
	}, nil)
}

// runMarker tags rows the run creates, so staff only ever close load test tasks and cleanup finds them.
const runMarker = "loadtest run"

func (p *phone) entry(name, path string) {
	p.open(name, path)
	if p.signedIn() {
		p.loaded("sends", func() { p.get("GET /me/ticks/sends", "/api/me/ticks/sends") })
	}
}

// browse taps through the gym like a visitor: mostly routes, sometimes a reload (pull to refresh, push link).
func (p *phone) browse(steps int, median time.Duration) {
	for range steps {
		if !p.pause(median) {
			return
		}
		r := pick(p, p.gym.routes).ID
		switch roll := p.rng.IntN(100); {
		case roll < 25:
			p.routesList()
		case roll < 35:
			p.filterRoutes()
		case roll < 60:
			if p.rng.IntN(10) == 0 {
				p.entry("GET /{gym}/route", p.page("/route?id="+r))
			}
			p.routeDetail(r)
		case roll < 68:
			p.mapPage()
		case roll < 73:
			p.info()
		case roll < 83:
			p.leaderboard()
		case roll < 93:
			p.gymFeed()
		default:
			if p.gym.competition != "" {
				p.competition()
			}
		}
	}
}

func guest(p *phone) {
	switch p.rng.IntN(10) {
	case 0, 1, 2, 3, 4:
		p.entry("GET /{gym}", p.page(""))
	case 5, 6, 7:
		p.entry("GET /{gym}/routes", p.page("/routes"))
		p.loaded("routes", func() {
			p.get("GET /gyms/{gym}/routes (list)", p.gymAPI("/routes?include=location,wall&sort=-screw_date&page=1&limit=20&total=true"))
		})
	default:
		p.entry("GET /{gym}/info", p.page("/info"))
	}
	p.browse(3+p.rng.IntN(8), 12*time.Second)
}

// qr is the main in-gym entry: the phone camera opens the tag's /route?id= link, which redirects to the gym's route page.
func qr(p *phone) {
	r := pick(p, p.gym.routes)
	p.entry("GET /route?id (QR tag)", "/route?id="+r.ID)
	p.routeDetail(r.ID)
	if p.signedIn() && p.pause(20*time.Second) && p.rng.IntN(10) < 7 {
		p.tick(r.ID, false)
	}
	p.browse(p.rng.IntN(4), 15*time.Second)
}

// scan is the in-app scanner: open /scan, look the tag's route up, then show it.
func (p *phone) scan() route {
	r := pick(p, p.gym.routes)
	p.get("GET /routes/{id} (scan)", "/api/routes/"+r.ID)
	p.routeDetail(r.ID)
	return r
}

// climber is a session at the wall: phone mostly in the pocket with the stream open, a burst of taps after each problem.
func climber(p *phone) {
	if p.rng.Float64() < *loginShare {
		p.login("/" + p.gym.slug + "/routes")
	} else {
		p.entry("GET /{gym}/routes", p.page("/routes"))
		p.loaded("routes", func() {
			p.get("GET /gyms/{gym}/routes (list)", p.gymAPI("/routes?include=location,wall&sort=-screw_date&page=1&limit=20&total=true"))
		})
	}
	offline := p.rng.IntN(10) == 0
	var queued []string
	for range 3 + p.rng.IntN(8) {
		if !p.pause(90 * time.Second) {
			break
		}
		var r route
		if p.rng.IntN(2) == 0 {
			r = p.scan()
		} else {
			p.routesList()
			r = pick(p, p.gym.routes)
			p.routeDetail(r.ID)
		}
		if !p.pause(10 * time.Second) {
			break
		}
		if p.rng.IntN(10) < 8 {
			if offline {
				queued = append(queued, r.ID)
			} else {
				p.tick(r.ID, false)
			}
		}
		if p.rng.IntN(5) == 0 && p.pause(20*time.Second) {
			p.review(r)
		}
		if p.rng.IntN(40) == 0 {
			p.reportDefect(r.ID)
		}
		if p.rng.IntN(4) == 0 {
			p.logbook()
		}
	}
	// Back in signal (lobby, train): the outbox flushes every queued tick at once.
	for _, r := range queued {
		p.tick(r, true)
	}
	if len(queued) > 0 {
		p.logbook()
	}
}

// social is a signed-in climber at home: friends, feed, notifications, leaderboard, profiles.
func social(p *phone) {
	var people []string
	switch p.rng.IntN(3) {
	case 0:
		p.entry("GET /friends", "/friends")
		people = p.friends()
	case 1:
		p.entry("GET /{gym}/feed", p.page("/feed"))
		people = p.gymFeed()
	default:
		p.entry("GET /logbook", "/logbook")
		p.logbook()
	}
	for range 3 + p.rng.IntN(8) {
		if !p.pause(15 * time.Second) {
			return
		}
		switch roll := p.rng.IntN(100); {
		case roll < 20:
			people = p.friends()
		case roll < 35:
			people = p.gymFeed()
		case roll < 50 && len(people) > 0:
			p.profile(pick(p, people))
		case roll < 58:
			p.profile(p.acct.id)
		case roll < 70:
			p.leaderboard()
		case roll < 80:
			p.write("POST /me/notifications/read", "POST", "/api/me/notifications/read", map[string]any{"all": true}, nil)
		case roll < 90:
			p.logbook()
		default:
			p.routeDetail(pick(p, p.gym.routes).ID)
		}
	}
}

// spectator watches live standings for a while; the stream drives the refetches.
func spectator(p *phone) {
	if p.gym.competition == "" {
		guest(p)
		return
	}
	p.entry("GET /{gym}/competitions/{id}", p.page("/competitions/"+p.gym.competition))
	p.competition()
	p.watch(5*time.Minute + time.Duration(p.rng.Int64N(int64(15*time.Minute))))
}

// watch keeps the page open, polling results every minute like useCompetitionResults.
func (p *phone) watch(d time.Duration) {
	deadline := time.After(time.Duration(float64(d) * *thinkScale))
	poll := time.NewTicker(time.Minute)
	defer poll.Stop()
	for {
		select {
		case <-p.ctx.Done():
			return
		case <-deadline:
			return
		case <-poll.C:
			p.later("results", 0)
		}
	}
}

// competitor scores their own entry from the scorecard between attempts.
func competitor(p *phone) {
	if p.gym.competition == "" || !p.acct.competitor {
		climber(p)
		return
	}
	p.entry("GET /{gym}/competitions/{id}", p.page("/competitions/"+p.gym.competition))
	mine := p.competition()
	if mine == "" {
		return
	}
	for range 4 + p.rng.IntN(10) {
		if !p.pause(90 * time.Second) {
			return
		}
		p.score("PUT /competitions/{id}/scores (climber)", mine, pick(p, p.gym.compRoutes))
	}
}

func (p *phone) score(name, entry, compRoute string) {
	attempts := 1 + p.rng.IntN(5)
	top := attempts
	if p.rng.IntN(3) == 0 {
		top = 0
	}
	sent("score:" + entry)
	p.write(name, "PUT", "/api/competitions/"+p.gym.competition+"/scores", map[string]any{"scores": []map[string]any{{
		"entry": entry, "comp_route": compRoute, "attempts": attempts, "zone_attempt": 1, "top_attempt": top,
	}}}, nil)
}

// judge sits at a boulder with the judge page open and enters scores in bursts as climbers come through.
func judge(p *phone) {
	c := p.gym.competition
	p.entry("GET /{gym}/manage/competitions/{id}/judge", p.page("/manage/competitions/"+c+"/judge"))
	p.get("GET /gyms/{gym}/competitions (judge)", p.gymAPI("/competitions?status=open&status=closed"))
	p.get("GET /competitions/{id}", "/api/competitions/"+c)
	p.get("GET /competitions/{id}/routes", "/api/competitions/"+c+"/routes?voided=false")
	var entries struct {
		Items []struct {
			ID  string
			Bib int
		}
	}
	p.get("GET /competitions/{id}/entries (judge)", "/api/competitions/"+c+"/entries?status=registered&status=checked_in", &entries)
	scores := func() { p.get("GET /competitions/{id}/scores", "/api/competitions/"+c+"/scores") }
	scores()
	p.get("GET /competitions/{id}/categories", "/api/competitions/"+c+"/categories")
	p.loaded("results", scores)
	p.subscribe("competition_changes:" + c)
	var judged []string
	for _, e := range entries.Items {
		if e.Bib%2 == 1 {
			judged = append(judged, e.ID)
		}
	}
	if len(judged) == 0 {
		return
	}
	compRoute := pick(p, p.gym.compRoutes)
	for p.pause(time.Duration(float64(*scoreEvery) * 3)) {
		for range 2 + p.rng.IntN(5) {
			p.score("PUT /competitions/{id}/scores (judge)", pick(p, judged), compRoute)
			if !p.pause(8 * time.Second) {
				return
			}
		}
	}
}

// tv is the results screen on the hall's wall: one long-lived page.
func tv(p *phone) {
	p.entry("GET /{gym}/competitions/{id}/tv", p.page("/competitions/"+p.gym.competition+"/tv"))
	p.subscribe("competition_changes:" + p.gym.competition)
	results := func() {
		p.get("GET /competitions/{id}/standings", "/api/competitions/"+p.gym.competition+"/standings?view=public")
	}
	results()
	p.loaded("results", results)
	p.watch(24 * time.Hour)
}

// setter works the staff pages: sets routes (form data, create, edit, archive the ones they made) and the task board.
func setter(p *phone) {
	p.entry("GET /{gym}/manage/routes", p.page("/manage/routes"))
	p.manageRoutes()
	var mine []string
	for p.pause(40 * time.Second) {
		switch roll := p.rng.IntN(10); {
		case roll < 4:
			if id := p.createRoute(); id != "" {
				mine = append(mine, id)
			}
		case roll < 6 && len(mine) > 0:
			p.write("PATCH /routes/{id}", "PATCH", "/api/routes/"+pick(p, mine), map[string]any{"comment": runMarker + " " + newID(p)[:4]}, nil)
		case roll < 7 && len(mine) > 3:
			p.write("POST /routes/{id}/archive", "POST", "/api/routes/"+mine[0]+"/archive", map[string]any{"archived": true}, nil)
			mine = mine[1:]
		default:
			p.taskBoard()
			p.entry("GET /{gym}/manage/routes", p.page("/manage/routes"))
			p.manageRoutes()
		}
	}
}

func (p *phone) manageRoutes() {
	p.get("GET /gyms/{gym}/defects/open", p.gymAPI("/defects/open"))
	p.get("GET /gyms/{gym}/locations", p.gymAPI("/locations"))
	list := func() {
		p.get("GET /gyms/{gym}/routes (manage)", p.gymAPI("/routes?archived=false&include=location&sort=-screw_date&page=1&limit=25&total=true"))
	}
	list()
	p.get("GET /gyms/{gym}/walls", p.gymAPI("/walls"))
	p.loaded("manage-routes", list)
}

type wall struct {
	ID       string `json:"id"`
	Location string `json:"location"`
}

func (p *phone) createRoute() string {
	p.get("GET /gyms/{gym}/routes/colors", p.gymAPI("/routes/colors"))
	var walls struct{ Items []wall }
	p.get("GET /gyms/{gym}/walls", p.gymAPI("/walls"), &walls)
	if len(walls.Items) == 0 || !p.pause(60*time.Second) {
		return ""
	}
	w := pick(p, walls.Items)
	grade := pick(p, []struct {
		grade string
		index float64
	}{{"5+", 15}, {"6A", 15.7}, {"6B", 17.1}, {"6C", 18.7}, {"7A", 20.3}})
	var created struct{ ID string }
	p.write("POST /gyms/{gym}/routes", "POST", p.gymAPI("/routes"), map[string]any{
		"name": runMarker + " " + newID(p)[:6], "type": "Boulder", "grade": grade.grade, "grade_system": "font", "grade_index": grade.index,
		"location": w.Location, "wall": w.ID, "color": pick(p, []string{"#e53935", "#1e88e5", "#43a047"}), "creator": []string{"loadtest setter"},
		"screw_date": time.Now().UTC().Format(time.RFC3339), "wall_position": p.rng.Float64(),
	}, &created)
	return created.ID
}

type task struct {
	ID          string `json:"id"`
	Photo       string `json:"photo"`
	Description string `json:"description"`
	Status      string `json:"status"`
}

func (p *phone) taskBoard() {
	p.entry("GET /{gym}/manage/tasks", p.page("/manage/tasks"))
	p.get("GET /gyms/{gym}/tasks/assignees", p.gymAPI("/tasks/assignees"))
	var open struct{ Items []task }
	board := func() {
		p.get("GET /gyms/{gym}/tasks (open)", p.gymAPI("/tasks?status=open&status=in_progress&status=waiting&sort=-priority,due_date,-created&limit=200"), &open)
		p.get("GET /gyms/{gym}/tasks (done)", p.gymAPI("/tasks?status=done&sort=-done_at&limit=30"))
	}
	board()
	p.loaded("tasks", board)
	p.subscribe("tasks:" + p.gym.id)
	// Every card with a photo asks for its own file token, then loads the thumbnail.
	photos := 0
	for _, t := range open.Items {
		if t.Photo == "" || photos == 8 {
			continue
		}
		photos++
		var token struct{ Token string }
		if p.write("POST /files/token", "POST", "/api/files/token", map[string]string{"table": "tasks", "id": t.ID}, &token) {
			p.images([]string{"/api/files/tasks/" + t.ID + "/" + url.PathEscape(t.Photo) + "?thumb=400x0&token=" + token.Token})
		}
	}
	if !p.pause(30 * time.Second) {
		return
	}
	if p.rng.IntN(2) == 0 {
		p.write("POST /gyms/{gym}/tasks (photo)", "POST", p.gymAPI("/tasks"), upload{field: "photo", name: "photo.png", data: photo,
			fields: map[string]string{"kind": "maintenance", "title": runMarker + " task", "description": runMarker, "priority": "2",
				"route": pick(p, p.gym.routes).ID}}, nil)
	}
	for _, t := range open.Items {
		if strings.HasPrefix(t.Description, runMarker) {
			p.write("POST /tasks/{id}/status", "POST", "/api/tasks/"+t.ID+"/status", map[string]any{"status": pick(p, []string{"in_progress", "done"})}, nil)
			break
		}
	}
}

// login goes through the login page: SSR, passkey autofill options, captcha challenge, password, then the redirect target.
func (p *phone) login(redirect string) {
	acct := p.acct
	p.acct = nil
	p.open("GET /auth/login", "/auth/login?redirect="+url.QueryEscape(redirect))
	p.get("GET /cap/status", "/api/cap/status")
	p.write("POST /auth/passkey/options", "POST", "/api/auth/passkey/options", nil, nil)
	if !p.pause(6 * time.Second) {
		p.acct = acct
		return
	}
	if *capSecret != "" {
		p.write("POST /cap/login/challenge", "POST", "/api/cap/login/challenge", nil, nil)
	}
	fresh, err := signIn(p.http, acct)
	stats.add(groupWrite, "POST /auth/login", fresh.status, fresh.took)
	if err == nil {
		acct = fresh.account
	}
	p.acct = acct
	p.mu.Lock()
	p.topics = nil
	p.mu.Unlock()
	p.connect()
	p.get("GET /me/memberships", "/api/me/memberships")
	p.routesList()
	p.loaded("sends", func() { p.get("GET /me/ticks/sends", "/api/me/ticks/sends") })
}

func pick[T any](p *phone, list []T) T { return list[p.rng.IntN(len(list))] }

func newID(p *phone) string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 15)
	for i := range b {
		b[i] = chars[p.rng.IntN(len(chars))]
	}
	return string(b)
}
