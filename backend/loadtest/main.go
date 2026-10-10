package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math/rand/v2"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Replays the request sequences the Nuxt app makes on a phone (recorded with Playwright): every session starts
// with a server-rendered page, then taps navigate client-side. Seed with seed.sql, then:
// go run ./loadtest -base https://host -password ... -vus 3000 -insecure
var (
	base       = flag.String("base", "http://localhost:8080", "base URL")
	gymSlugs   = flag.String("gyms", "load-1,load-2,load-3", "comma-separated gym slugs")
	userFormat = flag.String("user-format", "loadtest+%d@example.com", "climber e-mail pattern")
	users      = flag.Int("users", 5000, "number of seeded climber accounts")
	password   = flag.String("password", "", "password shared by all climber accounts")
	vus        = flag.Int("vus", 1500, "virtual users")
	guestShare = flag.Float64("guests", 0.4, "share of guests")
	climbShare = flag.Float64("climbers", 0.3, "share of climbers logging sends in the gym; the rest are signed-in browsers")
	coldShare  = flag.Float64("cold", 0.3, "share of sessions that download the app's static assets")
	loginShare = flag.Float64("logins", 0.1, "share of signed-in sessions that go through the login page; the rest arrive with a session cookie")
	duration   = flag.Duration("duration", 5*time.Minute, "test duration after ramp-up")
	rampUp     = flag.Duration("ramp", time.Minute, "time to start all virtual users")
	insecure   = flag.Bool("insecure", false, "skip TLS verification")
)

type gym struct {
	slug, id string
	routes   []string
}

type sample struct {
	name    string
	status  int
	elapsed time.Duration
	at      time.Time
}

type account struct {
	token, cookieJSON, userID string
}

var (
	samples     = make(chan sample, 16384)
	streams     sync.WaitGroup
	openStreams atomic.Int64
	streamErrs  atomic.Int64
	streamEvts  atomic.Int64
	sessions    atomic.Int64
	assets      []string
	i18nPath    string
	buildMeta   string
)

type vu struct {
	ctx     context.Context
	client  *http.Client
	g       gym
	token   string
	cookie  string
	userID  string
	account int
	stop    context.CancelFunc
}

func main() {
	flag.Parse()
	gyms := loadGyms()
	loadAssets(gyms[0].slug)
	accounts := signInAccounts()
	log.Printf("%d gyms, %d static assets, %d signed-in accounts, starting %d VUs (ramp %s, hold %s)",
		len(gyms), len(assets), len(accounts), *vus, *rampUp, *duration)
	steadyFrom := time.Now().Add(*rampUp)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, *rampUp+*duration)
	defer cancel()

	stats := map[string][]sample{}
	collected := make(chan struct{})
	go func() {
		for s := range samples {
			stats[s.name] = append(stats[s.name], s)
		}
		close(collected)
	}()
	go progress(ctx)

	var wg sync.WaitGroup
	for i := range *vus {
		wg.Go(func() {
			if !sleepCtx(ctx, time.Duration(i)*(*rampUp)/time.Duration(*vus)) {
				return
			}
			v := &vu{ctx: ctx, client: newClient(), g: gyms[i%len(gyms)]}
			share := float64(i%100) / 100
			switch {
			case share < *guestShare || *password == "":
				v.run(v.guestSession)
			case share < *guestShare+*climbShare:
				v.use(accounts[accountIndex(i)], accountIndex(i))
				v.run(v.climberSession)
			default:
				v.use(accounts[accountIndex(i)], accountIndex(i))
				v.run(v.memberSession)
			}
		})
	}
	wg.Wait()
	streams.Wait()
	close(samples)
	<-collected
	report(stats, steadyFrom)
}

func accountIndex(i int) int { return 1 + i%*users }

// signInAccounts logs every signed-in VU's account in before the clock starts, like returning users with a cookie.
func signInAccounts() map[int]account {
	accounts := map[int]account{}
	if *password == "" {
		return accounts
	}
	var mu sync.Mutex
	work := make(chan int)
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			client := newClient()
			for n := range work {
				body, _ := json.Marshal(map[string]string{"identity": fmt.Sprintf(*userFormat, n), "password": *password})
				res, err := client.Post(*base+"/api/auth/login", "application/json", bytes.NewReader(body))
				if err != nil {
					log.Fatal(err)
				}
				if res.StatusCode != http.StatusOK {
					log.Fatalf("pre-login of %s: %s", fmt.Sprintf(*userFormat, n), res.Status)
				}
				var out struct {
					Token  string          `json:"token"`
					Record json.RawMessage `json:"record"`
				}
				json.NewDecoder(res.Body).Decode(&out)
				res.Body.Close()
				var record struct{ ID string }
				json.Unmarshal(out.Record, &record)
				cookie, _ := json.Marshal(map[string]any{"token": out.Token, "record": out.Record})
				mu.Lock()
				accounts[n] = account{out.Token, string(cookie), record.ID}
				mu.Unlock()
			}
		})
	}
	seen := map[int]bool{}
	for i := range *vus {
		if share := float64(i%100) / 100; share >= *guestShare && !seen[accountIndex(i)] {
			seen[accountIndex(i)] = true
			work <- accountIndex(i)
		}
	}
	close(work)
	wg.Wait()
	return accounts
}

func (v *vu) use(a account, n int) {
	v.account = n
	v.token, v.userID = a.token, a.userID
	v.cookie = "pb_auth=" + url.QueryEscape(a.cookieJSON) + "; gym=" + v.g.slug
}

// Every VU is one phone with its own connection, like a browser.
func newClient() *http.Client {
	return &http.Client{Transport: &http.Transport{
		ForceAttemptHTTP2: true,
		TLSClientConfig:   &tls.Config{InsecureSkipVerify: *insecure},
	}}
}

func (v *vu) run(session func()) {
	for v.ctx.Err() == nil {
		sessions.Add(1)
		session()
		if v.stop != nil {
			v.stop()
		}
		if !v.think(time.Minute, 4*time.Minute) {
			return
		}
	}
}

func (v *vu) guestSession() {
	v.open("/"+v.g.slug, false)
	v.think(2*time.Second, 6*time.Second)
	v.routesTab()
	for range rand.IntN(4) {
		v.get("routes-page", v.routesPage(2+rand.IntN(3)))
		v.think(time.Second, 2*time.Second)
	}
	for range 1 + rand.IntN(4) {
		v.viewRoute(pick(v.g.routes))
		if !v.think(5*time.Second, 25*time.Second) {
			return
		}
	}
	if rand.IntN(3) == 0 {
		v.community()
		v.think(5*time.Second, 15*time.Second)
	}
	if rand.IntN(3) == 0 {
		v.leaderboard()
		v.think(5*time.Second, 15*time.Second)
	}
}

func (v *vu) climberSession() {
	if rand.Float64() < *loginShare {
		v.signIn(v.account)
	}
	v.open("/"+v.g.slug+"/routes", true)
	v.routesLanding()
	for range 3 + rand.IntN(6) {
		if !v.think(60*time.Second, 180*time.Second) {
			return
		}
		route := pick(v.g.routes)
		v.viewRoute(route)
		v.think(5*time.Second, 20*time.Second)
		if rand.IntN(10) < 7 {
			v.tick(route)
			if rand.IntN(4) == 0 {
				v.think(10*time.Second, 30*time.Second)
				v.review(route)
			}
		}
		if rand.IntN(4) == 0 {
			v.logbook()
		}
	}
}

func (v *vu) memberSession() {
	if rand.Float64() < *loginShare {
		v.signIn(v.account)
	}
	v.open("/"+v.g.slug+"/routes", true)
	v.routesLanding()
	for range 3 + rand.IntN(8) {
		if !v.think(5*time.Second, 25*time.Second) {
			return
		}
		switch rand.IntN(6) {
		case 0, 1:
			v.viewRoute(pick(v.g.routes))
		case 2:
			v.community()
		case 3:
			v.leaderboard()
		case 4:
			v.friends()
		case 5:
			v.logbook()
		}
	}
}

func (v *vu) signIn(account int) {
	v.token, v.cookie, v.userID = "", "", ""
	v.page("login-page", "/auth/login?redirect=/"+v.g.slug+"/routes")
	v.startClient(false)
	v.post("passkey-options", "/api/auth/passkey/options", nil)
	v.think(3*time.Second, 8*time.Second)
	var out struct {
		Token  string          `json:"token"`
		Record json.RawMessage `json:"record"`
	}
	body, _ := json.Marshal(map[string]string{"identity": fmt.Sprintf(*userFormat, account), "password": *password})
	if !v.do("login", "POST", "/api/auth/login", body, &out) {
		v.stop()
		v.stop = nil
		return
	}
	var record struct{ ID string }
	json.Unmarshal(out.Record, &record)
	v.token, v.userID = out.Token, record.ID
	cookie, _ := json.Marshal(map[string]any{"token": out.Token, "record": out.Record})
	v.cookie = "pb_auth=" + url.QueryEscape(string(cookie)) + "; gym=" + v.g.slug
	v.stop()
	v.stream(true)
	for range 2 {
		v.get("me", "/api/me")
		v.get("memberships", "/api/me/memberships")
	}
	v.get("gym", "/api/gyms/"+v.g.slug)
	v.routesLanding()
	v.stop()
	v.stop = nil
}

// open loads a server-rendered page the way a browser cold-starts the app.
func (v *vu) open(path string, signedIn bool) {
	v.page("ssr", path)
	if rand.Float64() < *coldShare {
		v.downloadAssets()
	}
	v.startClient(signedIn)
}

func (v *vu) startClient(signedIn bool) {
	if i18nPath != "" {
		v.get("i18n", i18nPath)
	}
	v.stream(signedIn)
	v.get("version", "/api/version")
	v.get("health", "/api/health")
	if signedIn {
		v.get("online", "/api/online")
		v.get("notifications", "/api/me/notifications?limit=200")
	}
	if buildMeta != "" {
		v.get("build-meta", buildMeta)
	}
}

func (v *vu) routesTab() {
	v.get("locations", "/api/gyms/"+v.g.id+"/locations")
	v.get("defects-open", "/api/gyms/"+v.g.id+"/defects/open")
	v.get("routes-page", v.routesPage(1))
	v.get("cap-status", "/api/cap/status")
}

func (v *vu) routesLanding() {
	v.get("version", "/api/version")
	v.get("health", "/api/health")
	v.get("online", "/api/online")
	v.get("follows", "/api/me/follows")
	v.get("locations", "/api/gyms/"+v.g.id+"/locations")
	v.get("sends", "/api/me/ticks/sends")
	v.get("defects-open", "/api/gyms/"+v.g.id+"/defects/open")
	v.get("routes-page", v.routesPage(1))
	v.get("notifications", "/api/me/notifications?limit=200")
}

func (v *vu) routesPage(page int) string {
	return fmt.Sprintf("/api/gyms/%s/routes?include=location,wall&sort=-screw_date&page=%d&limit=20&total=true", v.g.id, page)
}

func (v *vu) viewRoute(route string) {
	v.get("route-defects", "/api/routes/"+route+"/defects")
	v.get("route", "/api/routes/"+route+"?include=location,wall")
	if v.token != "" {
		v.get("blocks", "/api/me/blocks")
	}
	v.get("route-ratings", "/api/routes/"+route+"/ratings?limit=500")
	v.get("route-betas", "/api/routes/"+route+"/betas")
	if v.token != "" {
		// The app reloads these right after opening a route while signed in.
		v.get("follows", "/api/me/follows")
		v.get("defects-open", "/api/gyms/"+v.g.id+"/defects/open")
		v.get("route-defects", "/api/routes/"+route+"/defects")
		v.get("route-ratings", "/api/routes/"+route+"/ratings?limit=500")
		v.get("route", "/api/routes/"+route+"?include=location,wall")
		v.get("routes-page", v.routesPage(1))
	}
}

func (v *vu) tick(route string) {
	body, _ := json.Marshal(map[string]any{
		"id": newID(), "user": v.userID, "route": route, "type": pick([]string{"flash", "top", "top", "attempt"}),
		"attempts": 1 + rand.IntN(4), "date": time.Now().UTC().Format("2006-01-02") + " 12:00:00.000Z", "note": "",
	})
	v.post("tick", "/api/me/ticks", body)
	v.get("sends", "/api/me/ticks/sends")
	v.get("sends", "/api/me/ticks/sends")
}

func (v *vu) review(route string) {
	body, _ := json.Marshal(map[string]any{
		"route_id": route, "rating": 1 + rand.IntN(5), "grade": "6a", "grade_system": "font", "grade_index": 12,
		"comment": "Good flow, tricky top out",
	})
	v.post("review", "/api/routes/"+route+"/ratings", body)
}

func (v *vu) logbook() {
	v.get("logbook", "/api/me/ticks?sort=-date,-created&page=1&limit=1000")
}

func (v *vu) community() {
	v.get("gym-betas", "/api/gyms/"+v.g.id+"/betas?include=route&page=1&limit=20")
	since := time.Now().UTC().AddDate(0, 0, -30).Format("2006-01-02T15:04:05.000Z")
	if v.token != "" {
		var feed feedPage
		v.do("gym-feed", "GET", "/api/me/feed?gym="+v.g.id+"&sort=-created&page=1&limit=100", nil, &feed)
		v.get("new-routes", "/api/gyms/"+v.g.id+"/routes?since="+since+"&include=wall&sort=-created&page=1&limit=1000")
		v.get("blocks", "/api/me/blocks")
		v.climbers(feed)
		return
	}
	v.get("new-routes", "/api/gyms/"+v.g.id+"/routes?since="+since+"&include=wall&sort=-created&page=1&limit=1000")
}

func (v *vu) leaderboard() {
	v.get("seasons", "/api/gyms/"+v.g.id+"/seasons")
	v.get("leaderboard", "/api/gyms/"+v.g.id+"/leaderboard?kind=boulder")
}

func (v *vu) friends() {
	var feed feedPage
	v.do("friends-feed", "GET", "/api/me/feed?page=1&limit=60&sort=-date&total=true", nil, &feed)
	v.climbers(feed)
}

type feedPage struct {
	Items []struct{ User string } `json:"items"`
}

func (v *vu) climbers(feed feedPage) {
	var ids []string
	for _, item := range feed.Items {
		if item.User != "" && !slices.Contains(ids, item.User) {
			ids = append(ids, item.User)
		}
	}
	if len(ids) > 0 {
		v.get("climbers", "/api/climbers?ids="+strings.Join(ids, ","))
	}
}

func (v *vu) downloadAssets() {
	work := make(chan string)
	var wg sync.WaitGroup
	for range 6 {
		wg.Go(func() {
			for path := range work {
				v.get("asset", path)
			}
		})
	}
	for _, path := range assets {
		work <- path
	}
	close(work)
	wg.Wait()
}

func (v *vu) page(name, path string) { v.do(name, "GET", path, nil) }
func (v *vu) get(name, path string)  { v.do(name, "GET", path, nil) }
func (v *vu) post(name, path string, body []byte) {
	v.do(name, "POST", path, body)
}

func (v *vu) do(name, method, path string, body []byte, out ...any) bool {
	return v.request(v.ctx, v.token, v.cookie, name, method, path, body, out...)
}

// request takes the context and credentials as arguments so stream goroutines never read the VU's mutable fields.
func (v *vu) request(ctx context.Context, token, cookie, name, method, path string, body []byte, out ...any) bool {
	req, _ := http.NewRequestWithContext(ctx, method, *base+path, bytes.NewReader(body))
	if token != "" && strings.HasPrefix(path, "/api/") {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if cookie != "" && !strings.HasPrefix(path, "/api/") {
		req.Header.Set("Cookie", cookie)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	start := time.Now()
	res, err := v.client.Do(req)
	if err != nil {
		if ctx.Err() == nil {
			samples <- sample{name, 0, time.Since(start), start}
		}
		return false
	}
	defer res.Body.Close()
	if len(out) > 0 {
		json.NewDecoder(res.Body).Decode(out[0])
	}
	io.Copy(io.Discard, res.Body)
	samples <- sample{name, res.StatusCode, time.Since(start), start}
	return res.StatusCode/100 == 2
}

func (v *vu) stream(signedIn bool) {
	ctx, cancel := context.WithCancel(v.ctx)
	v.stop = cancel
	topics := []string{"follow_changes", "followed_ticks", "gym:" + v.g.id, "gym_changes:" + v.g.id, "open_route_defects:" + v.g.id, "own_ticks"}
	if signedIn && v.userID != "" {
		topics = append(topics, "own_notifications", "user:"+v.userID)
	}
	token, cookie := v.token, v.cookie
	streams.Go(func() {
		req, _ := http.NewRequestWithContext(ctx, "GET", *base+"/api/realtime", nil)
		req.Header.Set("Accept", "text/event-stream")
		if cookie != "" {
			req.Header.Set("Cookie", cookie)
		}
		res, err := v.client.Do(req)
		if err != nil || res.StatusCode != http.StatusOK {
			if ctx.Err() == nil {
				streamErrs.Add(1)
			}
			return
		}
		defer res.Body.Close()
		openStreams.Add(1)
		defer openStreams.Add(-1)
		lines := bufio.NewScanner(res.Body)
		subscribed := false
		for lines.Scan() {
			data, ok := strings.CutPrefix(lines.Text(), "data:")
			if !ok {
				continue
			}
			if subscribed {
				streamEvts.Add(1)
				continue
			}
			var connect struct{ ClientID string }
			if json.Unmarshal([]byte(data), &connect) == nil && connect.ClientID != "" {
				path := "/api/realtime/" + connect.ClientID + "/subscriptions"
				first, _ := json.Marshal(map[string]any{"topics": slices.Delete(slices.Clone(topics), 2, 3)})
				all, _ := json.Marshal(map[string]any{"topics": topics})
				v.request(ctx, token, cookie, "subscribe", "PUT", path, first)
				v.request(ctx, token, cookie, "subscribe", "PUT", path, all)
				subscribed = true
			}
		}
		if ctx.Err() == nil {
			streamErrs.Add(1)
		}
	})
}

func (v *vu) think(min, spread time.Duration) bool {
	return sleepCtx(v.ctx, min+rand.N(spread))
}

func loadGyms() []gym {
	var gyms []gym
	for slug := range strings.SplitSeq(*gymSlugs, ",") {
		var info struct{ ID string }
		var list struct{ Items []struct{ ID string } }
		mustGet("/api/gyms/"+slug, &info)
		mustGet("/api/gyms/"+slug+"/routes?limit=1000", &list)
		g := gym{slug: slug, id: info.ID}
		for _, r := range list.Items {
			g.routes = append(g.routes, r.ID)
		}
		if len(g.routes) == 0 {
			log.Fatalf("gym %s has no routes", slug)
		}
		gyms = append(gyms, g)
	}
	return gyms
}

var (
	assetPattern = regexp.MustCompile(`/_nuxt/[A-Za-z0-9_.-]+\.(?:js|css)`)
	i18nPattern  = regexp.MustCompile(`/_i18n/[A-Za-z0-9]+/en/messages\.json`)
	buildPattern = regexp.MustCompile(`buildId:"([0-9a-f-]+)"`)
)

func loadAssets(slug string) {
	res, err := newClient().Get(*base + "/" + slug)
	if err != nil {
		log.Fatal(err)
	}
	defer res.Body.Close()
	html, _ := io.ReadAll(res.Body)
	for _, path := range assetPattern.FindAllString(string(html), -1) {
		if !slices.Contains(assets, path) {
			assets = append(assets, path)
		}
	}
	i18nPath = i18nPattern.FindString(string(html))
	if m := buildPattern.FindStringSubmatch(string(html)); m != nil {
		buildMeta = "/_nuxt/builds/meta/" + m[1] + ".json"
	}
}

func mustGet(path string, out any) {
	res, err := newClient().Get(*base + path)
	if err != nil {
		log.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK || json.NewDecoder(res.Body).Decode(out) != nil {
		log.Fatalf("GET %s: %s", path, res.Status)
	}
}

func progress(ctx context.Context) {
	tick := time.NewTicker(15 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			log.Printf("sessions %d, open streams %d, dropped %d, events received %d",
				sessions.Load(), openStreams.Load(), streamErrs.Load(), streamEvts.Load())
		}
	}
}

func report(stats map[string][]sample, steadyFrom time.Time) {
	names := make([]string, 0, len(stats))
	total, failed, rampTotal, rampFailed := 0, 0, 0, 0
	var rampSSR []sample
	for name := range stats {
		names = append(names, name)
	}
	slices.Sort(names)
	fmt.Printf("\nsteady state (after ramp-up)\n%-16s %8s %8s %8s %8s %8s  %s\n", "request", "count", "p50", "p95", "p99", "max", "status")
	for _, name := range names {
		var s []sample
		for _, x := range stats[name] {
			ok := x.status/100 == 2 || x.status == 304
			if x.at.Before(steadyFrom) {
				rampTotal++
				if !ok {
					rampFailed++
				}
				if name == "ssr" {
					rampSSR = append(rampSSR, x)
				}
				continue
			}
			s = append(s, x)
			total++
			if !ok {
				failed++
			}
		}
		if len(s) == 0 {
			continue
		}
		slices.SortFunc(s, func(a, b sample) int { return int(a.elapsed - b.elapsed) })
		codes := map[int]int{}
		for _, x := range s {
			codes[x.status]++
		}
		fmt.Printf("%-16s %8d %8s %8s %8s %8s  %v\n", name, len(s),
			pct(s, 50), pct(s, 95), pct(s, 99), s[len(s)-1].elapsed.Round(time.Millisecond), codes)
	}
	fmt.Printf("\nsteady: %d requests (%d failed), %.0f req/s\n", total, failed, float64(total)/duration.Seconds())
	if len(rampSSR) > 0 {
		slices.SortFunc(rampSSR, func(a, b sample) int { return int(a.elapsed - b.elapsed) })
		fmt.Printf("ramp-up: %d requests (%d failed), ssr p95 %s\n", rampTotal, rampFailed, pct(rampSSR, 95))
	}
	fmt.Printf("%d sessions, streams dropped %d, events received %d (status 0 = transport error)\n",
		sessions.Load(), streamErrs.Load(), streamEvts.Load())
}

func pct(s []sample, p int) time.Duration {
	return s[(len(s)-1)*p/100].elapsed.Round(time.Millisecond)
}

func pick[T any](list []T) T { return list[rand.IntN(len(list))] }

func newID() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 15)
	for i := range b {
		b[i] = chars[rand.IntN(len(chars))]
	}
	return string(b)
}

func sleepCtx(ctx context.Context, d time.Duration) bool {
	select {
	case <-ctx.Done():
		return false
	case <-time.After(d):
		return true
	}
}
