package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log"
	mrand "math/rand/v2"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Phones in the gym against the public entry; see CLAUDE.md for seeding and running.
var (
	base       = flag.String("base", "http://localhost:8080", "public base URL (nginx in front of Nuxt and the API)")
	gymSlugs   = flag.String("gyms", "loadtest-1,loadtest-2,loadtest-3", "seeded gym slugs; climber n belongs to gym n % count")
	users      = flag.Int("users", 1000, "seeded climbers to sign in (loadtest+1..n@example.com)")
	password   = flag.String("password", "loadtest-password", "password of the seeded accounts")
	capSecret  = flag.String("cap-secret", "", "the target's CAP_SECRET, to sign captcha tokens for logins (needed when its captcha is on)")
	rate       = flag.Float64("rate", 120, "arriving phone sessions per minute at the profile's peak")
	profileArg = flag.String("profile", "flat", "arrival curve over the run: flat, evening, comp, ramp or x:y points like 0:0.2,0.5:1,1:0.3")
	mixArg     = flag.String("mix", "guest=25,qr=25,climber=25,social=12,spectator=8,competitor=5", "share of arriving sessions per persona")
	duration   = flag.Duration("duration", 10*time.Minute, "how long sessions keep arriving; running sessions finish within -drain")
	drain      = flag.Duration("drain", 2*time.Minute, "time for open sessions to finish after the last arrival")
	warmup     = flag.Duration("warmup", 30*time.Second, "leave the first part of the run out of the report")
	maxOpen    = flag.Int("max-sessions", 20000, "safety cap on concurrent sessions; arrivals beyond it are counted as dropped")
	coldShare  = flag.Float64("cold", 0.3, "share of sessions without the app in the HTTP/service worker cache (downloads JS, CSS, icons, SW)")
	loginShare = flag.Float64("logins", 0.1, "share of signed-in climber sessions that sign in on the login page instead of a remembered cookie")
	thinkScale = flag.Float64("think-scale", 1, "multiplies every think time (0.1 for a quick smoke run)")
	setters    = flag.Int("setters", 2, "routesetters on the staff pages, per gym, for the whole run")
	judges     = flag.Int("judges", 2, "judges entering scores, per gym with an open competition")
	tvs        = flag.Int("tvs", 1, "competition result screens per gym with an open competition")
	scoreEvery = flag.Duration("score-every", 30*time.Second, "median pause between a judge's score bursts")
	sloArg     = flag.String("slo", "ssr.p95<1s,static.p95<300ms,api.p95<400ms,thumbs.p95<500ms,writes.p95<600ms,sse-connect.p95<500ms,sse-event.p95<2s,all.errors<1%", "thresholds; any failure exits 1")
	insecure   = flag.Bool("insecure", false, "skip TLS verification (self-signed certificates)")
)

type route struct {
	ID          string  `json:"id"`
	Type        string  `json:"type"`
	Grade       string  `json:"grade"`
	GradeSystem string  `json:"grade_system"`
	GradeIndex  float64 `json:"grade_index"`
	Location    string  `json:"location"`
}

type gym struct {
	slug, id, season, competition string
	routes                        []route
	locations, compRoutes, images []string
	climbers, staff               []*account
}

var photo = func() []byte {
	img := image.NewRGBA(image.Rect(0, 0, 640, 480))
	for x := range 640 {
		for y := range 480 {
			img.Set(x, y, color.RGBA{uint8(x / 3), uint8(y / 2), uint8((x + y) / 5), 255})
		}
	}
	var buf bytes.Buffer
	png.Encode(&buf, img)
	return buf.Bytes()
}()

func main() {
	flag.Parse()
	tlsInsecure = *insecure
	shape, err := parseProfile(*profileArg)
	check(err)
	mix, err := parseMix(*mixArg, personas)
	check(err)
	slos, err := parseSLOs(*sloArg)
	check(err)

	var health struct{ Version string }
	mustGet("/api/health", &health)
	serverVer = health.Version
	gyms := loadGyms()
	signInAll(gyms)
	prepareImages(gyms)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	start := time.Now()
	stats.mu.Lock()
	stats.from = start.Add(*warmup)
	stats.mu.Unlock()
	runCtx, cancel := context.WithTimeout(ctx, *duration+*drain)
	defer cancel()
	go progress(runCtx)

	var sessions sync.WaitGroup
	var open, started, dropped atomic.Int64
	launch := func(g *gym, a *account, persona func(*phone)) {
		sessions.Go(func() {
			p := newPhone(runCtx, g, a, mrand.Float64() < *coldShare)
			defer p.end()
			persona(p)
		})
	}
	for _, g := range gyms {
		for i := range *setters * min(1, len(g.staff)) {
			launch(g, g.staff[i%len(g.staff)], setter)
		}
		if g.competition != "" {
			for i := range *judges * min(1, len(g.staff)) {
				launch(g, g.staff[i%len(g.staff)], judge)
			}
			for range *tvs {
				launch(g, nil, tv)
			}
		}
	}

	rng := mrand.New(mrand.NewPCG(1, uint64(start.UnixNano())))
	plan := arrivals(shape, *rate/60, *duration, rng)
	log.Printf("%d gyms, %d sessions planned over %s (%s profile, peak %.0f/min), drain %s", len(gyms), len(plan), *duration, *profileArg, *rate, *drain)
	run := map[string]func(*phone){"guest": guest, "qr": qr, "climber": climber, "social": social, "spectator": spectator, "competitor": competitor}
arrive:
	for _, at := range plan {
		select {
		case <-ctx.Done():
			break arrive
		case <-time.After(time.Until(start.Add(at))):
		}
		if open.Load() >= int64(*maxOpen) {
			dropped.Add(1)
			continue
		}
		name := pickWeighted(mix, rng)
		g := gyms[rng.IntN(len(gyms))]
		var a *account
		switch signedIn := rng.Float64(); {
		case name == "guest", name == "qr" && signedIn < 0.4, name == "spectator" && signedIn < 0.7:
		case name == "competitor" && len(g.climbers) > 0:
			a = pickCompetitor(g, rng)
		case len(g.climbers) > 0:
			a = g.climbers[rng.IntN(len(g.climbers))]
		}
		started.Add(1)
		open.Add(1)
		persona, cold := run[name], rng.Float64() < *coldShare
		sessions.Go(func() {
			defer open.Add(-1)
			p := newPhone(runCtx, g, a, cold)
			defer p.end()
			persona(p)
		})
	}
	log.Printf("last arrival, waiting up to %s for %d open sessions", *drain, open.Load())
	<-runCtx.Done()
	sessions.Wait()
	elapsed := time.Since(start) - *warmup
	fmt.Printf("\n%d sessions started, %d dropped at -max-sessions, SSE drops %d\n", started.Load(), dropped.Load(), sseDrops.Load())
	ok := stats.report(os.Stdout, elapsed, slos)
	if dropped.Load() > 0 {
		fmt.Println("  FAIL  sessions were dropped at -max-sessions: the offered load was not generated")
		ok = false
	}
	printEvents()
	if !ok {
		os.Exit(1)
	}
}

func pickCompetitor(g *gym, rng *mrand.Rand) *account {
	var even []*account
	for _, a := range g.climbers {
		if a.competitor {
			even = append(even, a)
		}
	}
	if len(even) == 0 {
		return g.climbers[rng.IntN(len(g.climbers))]
	}
	return even[rng.IntN(len(even))]
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
}

func setupClient() *http.Client {
	return newPhone(context.Background(), &gym{}, nil, false).http
}

func mustGet(path string, out any) {
	res, err := setupClient().Get(*base + path)
	if err != nil {
		log.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK || json.NewDecoder(res.Body).Decode(out) != nil {
		log.Fatalf("GET %s: %s", path, res.Status)
	}
}

// loadGyms reads the catalog out of band, so sessions never send lookups a browser would not make.
func loadGyms() []*gym {
	var gyms []*gym
	for slug := range strings.SplitSeq(*gymSlugs, ",") {
		var info struct {
			ID         string `json:"id"`
			PageLogo   string `json:"page_logo"`
			CoverImage string `json:"cover_image"`
		}
		mustGet("/api/gyms/"+slug, &info)
		g := &gym{slug: slug, id: info.ID}
		var routes struct{ Items []route }
		mustGet("/api/gyms/"+g.id+"/routes?archived=false&page=1&limit=1000", &routes)
		g.routes = routes.Items
		if len(g.routes) == 0 {
			log.Fatalf("gym %s has no active routes: run yarn loadtest:seed", slug)
		}
		var locations struct{ Items []struct{ ID string } }
		mustGet("/api/gyms/"+g.id+"/locations", &locations)
		for _, l := range locations.Items {
			g.locations = append(g.locations, l.ID)
		}
		var seasons []struct {
			ID       string    `json:"id"`
			StartsAt time.Time `json:"starts_at"`
			EndsAt   time.Time `json:"ends_at"`
		}
		mustGet("/api/gyms/"+g.id+"/seasons", &seasons)
		for _, s := range seasons {
			if time.Now().After(s.StartsAt) && time.Now().Before(s.EndsAt) {
				g.season = s.ID
			}
		}
		var comps struct{ Items []struct{ ID string } }
		mustGet("/api/gyms/"+g.id+"/competitions?status=open", &comps)
		if len(comps.Items) > 0 {
			g.competition = comps.Items[0].ID
			var compRoutes struct{ Items []struct{ ID string } }
			mustGet("/api/competitions/"+g.competition+"/routes?voided=false", &compRoutes)
			for _, r := range compRoutes.Items {
				g.compRoutes = append(g.compRoutes, r.ID)
			}
			if len(g.compRoutes) == 0 {
				g.competition = ""
			}
		}
		g.images = gymImages(g.id, info.PageLogo, info.CoverImage)
		gyms = append(gyms, g)
	}
	return gyms
}

func gymImages(id, logo, cover string) []string {
	var out []string
	if logo != "" {
		out = append(out, "/api/files/gyms/"+id+"/"+url.PathEscape(logo)+"?thumb=0x200")
	}
	if cover != "" {
		out = append(out, "/api/files/gyms/"+id+"/"+url.PathEscape(cover)+"?thumb=1600x500")
	}
	return out
}

type login struct {
	account *account
	status  int
	took    time.Duration
}

// signIn posts the password like the login form; the cookie mirrors authCookie (URL-encoded JSON {token, record}).
func signIn(client *http.Client, a *account) (login, error) {
	body, _ := json.Marshal(map[string]string{"identity": a.email, "password": *password})
	req, _ := http.NewRequest("POST", *base+"/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(apiVersionHeader, serverVer)
	if *capSecret != "" {
		req.Header.Set("X-Cap-Token", capToken("login"))
	}
	start := time.Now()
	res, err := client.Do(req)
	if err != nil {
		return login{status: 0, took: time.Since(start)}, err
	}
	defer res.Body.Close()
	out := login{status: res.StatusCode, took: time.Since(start)}
	var auth struct {
		Token  string          `json:"token"`
		Record json.RawMessage `json:"record"`
	}
	if res.StatusCode != http.StatusOK || json.NewDecoder(res.Body).Decode(&auth) != nil {
		var problem bytes.Buffer
		problem.ReadFrom(res.Body)
		return out, fmt.Errorf("login %s: %s %s", a.email, res.Status, problem.String())
	}
	var record struct{ ID string }
	json.Unmarshal(auth.Record, &record)
	cookie, _ := json.Marshal(map[string]any{"token": auth.Token, "record": auth.Record})
	signed := *a
	signed.id, signed.token, signed.cookie = record.ID, auth.Token, url.QueryEscape(string(cookie))
	out.account = &signed
	return out, nil
}

// capToken signs what the target's /api/cap/<scope>/redeem would hand out after the proof of work.
func capToken(scope string) string {
	jti := make([]byte, 16)
	rand.Read(jti)
	enc := base64.RawURLEncoding
	header := enc.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	claims, _ := json.Marshal(map[string]any{"scope": scope, "jti": hex.EncodeToString(jti), "exp": time.Now().Add(5 * time.Minute).Unix()})
	payload := enc.EncodeToString(claims)
	mac := hmac.New(sha256.New, []byte(*capSecret))
	mac.Write([]byte(header + "." + payload))
	return header + "." + payload + "." + enc.EncodeToString(mac.Sum(nil))
}

// signInAll logs every account in before the clock starts: returning users arrive with their cookie.
func signInAll(gyms []*gym) {
	var all []*account
	for n := 1; n <= *users; n++ {
		g := gyms[n%len(gyms)]
		a := &account{n: n, email: fmt.Sprintf("loadtest+%d@example.com", n), gym: n % len(gyms), competitor: n <= 300*len(gyms) && n%2 == 0}
		g.climbers = append(g.climbers, a)
		all = append(all, a)
	}
	for i, g := range gyms {
		for s := 1; s <= 2; s++ {
			a := &account{email: fmt.Sprintf("loadtest+staff-%s-%d@example.com", strings.TrimPrefix(g.slug, "loadtest-"), s), gym: i, staff: true}
			g.staff = append(g.staff, a)
			all = append(all, a)
		}
	}
	work := make(chan *account)
	var failed atomic.Int64
	var firstErr atomic.Value
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			client := setupClient()
			for a := range work {
				result, err := signIn(client, a)
				if err != nil {
					if failed.Add(1) == 1 {
						firstErr.Store(err)
					}
					continue
				}
				*a = *result.account
			}
		})
	}
	started := time.Now()
	for _, a := range all {
		work <- a
	}
	close(work)
	wg.Wait()
	if failed.Load() > 0 {
		hint := ""
		if strings.Contains(fmt.Sprint(firstErr.Load()), "aptcha") {
			hint = " (pass -cap-secret)"
		}
		log.Fatalf("%d of %d sign-ins failed, first: %v%s", failed.Load(), len(all), firstErr.Load(), hint)
	}
	log.Printf("signed in %d accounts in %s", len(all), time.Since(started).Round(time.Second))
}

// prepareImages uploads a gym logo and cover and avatars for every third climber once, so pages have thumbnails to load.
func prepareImages(gyms []*gym) {
	for _, g := range gyms {
		staff := newPhone(context.Background(), g, g.staff[0], false)
		if len(g.images) < 2 {
			var updated struct {
				PageLogo   string `json:"page_logo"`
				CoverImage string `json:"cover_image"`
			}
			for _, field := range []string{"page_logo", "cover_image"} {
				status, body := staff.call(groupWrite, "setup", "PATCH", "/api/gyms/"+g.id, upload{field: field, name: field + ".png", data: photo}, nil)
				if status != http.StatusOK {
					log.Fatalf("uploading the %s of %s: %d %s", field, g.slug, status, body)
				}
				json.Unmarshal(body, &updated)
			}
			g.images = gymImages(g.id, updated.PageLogo, updated.CoverImage)
		}
		for _, a := range g.climbers {
			if a.n%3 != 0 {
				continue
			}
			var me struct{ Avatar string }
			p := newPhone(context.Background(), g, a, false)
			if p.get("setup", "/api/me", &me) && me.Avatar == "" {
				if status, body := p.call(groupWrite, "setup", "PATCH", "/api/me", upload{field: "avatar", name: "avatar.png", data: photo}, nil); status != http.StatusOK {
					log.Fatalf("uploading the avatar of %s: %d %s", a.email, status, body)
				}
			}
			p.http.CloseIdleConnections()
		}
	}
	stats = newRecorder()
}

func progress(ctx context.Context) {
	tick := time.NewTicker(15 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			log.Printf("open SSE streams %d, drops %d", sseOpen.Load(), sseDrops.Load())
		}
	}
}

func printEvents() {
	fmt.Println("\nrealtime events received")
	sseEvents.Range(func(topic, n any) bool {
		fmt.Printf("  %-40s %d\n", topic, n.(*atomic.Int64).Load())
		return true
	})
}
