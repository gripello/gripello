package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"math/rand/v2"
	"mime/multipart"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// phone is one browser tab: its own connections, cookies, HTTP/SW cache and one EventSource while the tab is open.
type phone struct {
	ctx    context.Context
	rng    *rand.Rand
	http   *http.Client
	gym    *gym
	acct   *account
	cold   bool
	cached map[string]bool
	mu     sync.Mutex
	topics []string
	client string
	stream context.CancelFunc
	done   sync.WaitGroup
	live   map[string]func()
	soon   map[string]bool
	drops  int
}

type account struct {
	n                 int
	email, id, token  string
	cookie            string
	gym               int
	competitor, staff bool
}

const apiVersionHeader = "X-Gripello-Api-Version"

var (
	assetPattern = regexp.MustCompile(`/_(?:nuxt|i18n)/[A-Za-z0-9_./-]+\.(?:js|css|json)`)
	filePattern  = regexp.MustCompile(`/api/files/[A-Za-z0-9_]+/[A-Za-z0-9]+/[A-Za-z0-9_.%-]+(?:\?thumb=[0-9x]+)?`)
	buildPattern = regexp.MustCompile(`buildId:"([^"]+)"`)
	coldOnly     = []string{"/manifest.webmanifest", "/favicon.ico", "/app-icon.svg", "/offline.html", "/icon-192.png", "/icon-512.png"}
	serverVer    string
	tlsInsecure  bool
)

func newPhone(ctx context.Context, g *gym, a *account, cold bool) *phone {
	return &phone{
		ctx: ctx, rng: rand.New(rand.NewPCG(rand.Uint64(), rand.Uint64())), gym: g, acct: a, cold: cold, cached: map[string]bool{}, live: map[string]func(){}, soon: map[string]bool{},
		http: &http.Client{Timeout: 60 * time.Second, Transport: &http.Transport{
			ForceAttemptHTTP2: true, MaxIdleConnsPerHost: 6, TLSClientConfig: &tls.Config{InsecureSkipVerify: tlsInsecure},
		}},
	}
}

func (p *phone) signedIn() bool { return p.acct != nil && p.acct.token != "" }

func (p *phone) cookie() string {
	c := "gym=" + p.gym.slug
	if p.signedIn() {
		c += "; pb_auth=" + p.acct.cookie
	}
	return c
}

type upload struct {
	field, name string
	data        []byte
	fields      map[string]string
}

// call is one request; body is nil, a JSON value or a multipart upload.
func (p *phone) call(group, name, method, path string, body any, out any) (int, []byte) {
	var reader io.Reader
	contentType := ""
	switch b := body.(type) {
	case nil:
	case upload:
		var buf bytes.Buffer
		form := multipart.NewWriter(&buf)
		if b.data != nil {
			part, _ := form.CreateFormFile(b.field, b.name)
			part.Write(b.data)
		}
		for key, value := range b.fields {
			form.WriteField(key, value)
		}
		form.Close()
		reader, contentType = &buf, form.FormDataContentType()
	default:
		data, _ := json.Marshal(b)
		reader, contentType = bytes.NewReader(data), "application/json"
	}
	req, err := http.NewRequestWithContext(p.ctx, method, *base+path, reader)
	if err != nil {
		return 0, nil
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.Header.Set("Cookie", p.cookie())
	if strings.HasPrefix(path, "/api/") && !strings.HasPrefix(path, "/api/files/") {
		req.Header.Set(apiVersionHeader, serverVer)
		if p.signedIn() {
			req.Header.Set("Authorization", "Bearer "+p.acct.token)
		}
	}
	if group == groupSSR {
		req.Header.Set("Accept", "text/html")
	}
	start := time.Now()
	res, err := p.http.Do(req)
	if err != nil {
		if p.ctx.Err() == nil {
			stats.add(group, name, 0, time.Since(start))
			stats.sample(group+" "+name, 0, method+" "+path, []byte(err.Error()))
		}
		return 0, nil
	}
	data, err := io.ReadAll(res.Body)
	res.Body.Close()
	if err != nil && p.ctx.Err() != nil {
		return 0, nil
	}
	stats.add(group, name, res.StatusCode, time.Since(start))
	if res.StatusCode >= 400 {
		stats.sample(group+" "+name, res.StatusCode, method+" "+path, data)
	}
	if out != nil && res.StatusCode/100 == 2 {
		json.Unmarshal(data, out)
	}
	return res.StatusCode, data
}

func (p *phone) get(name, path string, out ...any) bool {
	var target any
	if len(out) > 0 {
		target = out[0]
	}
	status, _ := p.call(groupAPI, name, "GET", path, nil, target)
	return status/100 == 2
}

func (p *phone) write(name, method, path string, body any, out any) bool {
	status, _ := p.call(groupWrite, name, method, path, body, out)
	return status/100 == 2
}

// open is a document load (cold start, QR scan, push link, reload): SSR, then the hydration requests every page sends.
func (p *phone) open(name, path string) {
	status, html := p.call(groupSSR, name, "GET", path, nil, nil)
	if status/100 != 2 {
		return
	}
	var fetch []string
	if m := buildPattern.FindSubmatch(html); m != nil {
		fetch = append(fetch, "/_nuxt/builds/meta/"+string(m[1])+".json")
		if p.cold && !p.cached["sw"] {
			p.cached["sw"] = true
			fetch = append(fetch, "/sw.js?build="+url.QueryEscape(string(m[1])))
		}
	}
	for _, asset := range assetPattern.FindAll(html, -1) {
		if p.cold && !p.cached[string(asset)] {
			p.cached[string(asset)] = true
			fetch = append(fetch, string(asset))
		}
	}
	if p.cold {
		for _, asset := range coldOnly {
			if !p.cached[asset] {
				p.cached[asset] = true
				fetch = append(fetch, asset)
			}
		}
	}
	p.parallel(groupStatic, fetch)
	p.images(filesIn(html))
	p.connect()
	p.get("GET /version", "/api/version")
	p.get("GET /health", "/api/health")
	if p.signedIn() {
		p.get("GET /online", "/api/online")
		p.get("GET /me/notifications", "/api/me/notifications?limit=200")
	}
}

var thumbSize = regexp.MustCompile(`thumb=([0-9x]+)`)

// assetName groups static files and thumbnails by kind, not by URL.
func assetName(path string) string {
	switch {
	case strings.HasPrefix(path, "/api/files/"):
		table := strings.SplitN(strings.TrimPrefix(path, "/api/files/"), "/", 2)[0]
		if m := thumbSize.FindStringSubmatch(path); m != nil {
			return "GET /files/" + table + " ?thumb=" + m[1]
		}
		return "GET /files/" + table
	case strings.HasPrefix(path, "/_nuxt/builds/"):
		return "GET /_nuxt/builds/meta"
	case strings.HasPrefix(path, "/_nuxt/") || strings.HasPrefix(path, "/_i18n/"):
		return "GET " + path[:strings.Index(path[1:], "/")+2] + "*" + path[strings.LastIndex(path, "."):]
	case strings.HasPrefix(path, "/sw.js"):
		return "GET /sw.js"
	}
	return "GET " + path
}

func filesIn(html []byte) []string {
	var out []string
	for _, f := range filePattern.FindAll(html, -1) {
		out = append(out, strings.ReplaceAll(string(f), "&amp;", "&"))
	}
	return out
}

// images loads file URLs once per tab; warm phones have about half of them in the service worker's file cache.
func (p *phone) images(paths []string) {
	var fetch []string
	for _, path := range paths {
		if !p.cached[path] {
			p.cached[path] = true
			// ponytail: the SW keeps the last 50 files, a coin flip stands in for which of them a returning phone has.
			if p.cold || p.rng.IntN(2) == 0 {
				fetch = append(fetch, path)
			}
		}
	}
	p.parallel(groupThumb, fetch)
}

// parallel fetches like a browser: six connections' worth at a time.
func (p *phone) parallel(group string, paths []string) {
	work := make(chan string)
	var wg sync.WaitGroup
	for range min(6, len(paths)) {
		wg.Go(func() {
			for path := range work {
				p.call(group, assetName(path), "GET", path, nil, nil)
			}
		})
	}
	for _, path := range paths {
		work <- path
	}
	close(work)
	wg.Wait()
}

func avatar(c person, size string) string {
	switch {
	case c.Avatar == "":
		return ""
	case strings.HasPrefix(c.Avatar, "/"):
		return c.Avatar
	}
	return "/api/files/users/" + c.ID + "/" + url.PathEscape(c.Avatar) + "?thumb=" + size
}

type person struct {
	ID     string `json:"id"`
	Avatar string `json:"avatar"`
}

// climbers resolves names and avatars of people in a list, like useClimbers.
func (p *phone) climbers(ids []string, size string) {
	ids = slices.Compact(slices.Sorted(slices.Values(ids)))
	if len(ids) == 0 {
		return
	}
	var found []person
	p.get("GET /climbers?ids", "/api/climbers?ids="+strings.Join(ids[:min(len(ids), 50)], ","), &found)
	var paths []string
	for _, c := range found {
		if a := avatar(c, size); a != "" {
			paths = append(paths, a)
		}
	}
	p.images(paths)
}

// subscribe sets the page's extra topics; the app PUTs the whole topic list whenever it changes.
func (p *phone) subscribe(extra ...string) {
	p.mu.Lock()
	topics := slices.Sorted(slices.Values(append(p.pageTopics(), extra...)))
	changed := !slices.Equal(topics, p.topics)
	p.topics = topics
	client := p.client
	p.mu.Unlock()
	if changed && client != "" {
		p.call(groupAPI, "PUT /realtime/{id}/subscriptions", "PUT", "/api/realtime/"+client+"/subscriptions", map[string]any{"topics": topics}, nil)
	}
}

// layoutTopics is what the layout subscribes before the gym and the session are known.
func layoutTopics(gym string) []string {
	return []string{"follow_changes", "followed_ticks", "gym_changes:" + gym, "open_route_defects:" + gym, "own_ticks"}
}

func (p *phone) pageTopics() []string {
	topics := append(layoutTopics(p.gym.id), "gym:"+p.gym.id)
	if p.signedIn() {
		topics = append(topics, "own_notifications", "user:"+p.acct.id)
	}
	return topics
}

// connect opens the tab's EventSource (a full page load replaces the old one) and keeps it open, reconnecting like the app.
func (p *phone) connect() {
	p.close()
	ctx, cancel := context.WithCancel(p.ctx)
	p.stream = cancel
	p.mu.Lock()
	if p.topics == nil {
		p.topics = slices.Sorted(slices.Values(p.pageTopics()))
	}
	p.mu.Unlock()
	p.done.Go(func() {
		for ctx.Err() == nil {
			if p.listen(ctx) && ctx.Err() == nil {
				sseDrops.Add(1)
				p.mu.Lock()
				p.drops++
				p.mu.Unlock()
			}
			select {
			case <-ctx.Done():
			case <-time.After(time.Second + time.Duration(p.rng.Int64N(int64(4*time.Second)))):
			}
		}
	})
}

func (p *phone) close() {
	if p.stream != nil {
		p.stream()
		p.stream = nil
		p.mu.Lock()
		p.client = ""
		p.mu.Unlock()
	}
}

// end closes the tab.
func (p *phone) end() {
	p.close()
	p.done.Wait()
	p.http.CloseIdleConnections()
}

// listen holds one SSE connection and reports whether it was established.
func (p *phone) listen(ctx context.Context) bool {
	req, _ := http.NewRequestWithContext(ctx, "GET", *base+"/api/realtime", nil)
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cookie", p.cookie())
	start := time.Now()
	res, err := (&http.Client{Transport: p.http.Transport}).Do(req)
	if err != nil || res.StatusCode != http.StatusOK {
		status := 0
		if res != nil {
			status = res.StatusCode
			res.Body.Close()
		}
		if ctx.Err() == nil {
			stats.add(groupSSEConnect, "GET /realtime", status, time.Since(start))
		}
		return false
	}
	defer res.Body.Close()
	sseOpen.Add(1)
	defer sseOpen.Add(-1)
	lines := bufio.NewScanner(res.Body)
	lines.Buffer(make([]byte, 64*1024), 4<<20)
	event := ""
	for lines.Scan() {
		line := lines.Text()
		if name, ok := strings.CutPrefix(line, "event:"); ok {
			event = strings.TrimSpace(name)
			continue
		}
		data, ok := strings.CutPrefix(line, "data:")
		if !ok {
			continue
		}
		if event == "connect" {
			var hello struct{ ClientID string }
			json.Unmarshal([]byte(data), &hello)
			stats.add(groupSSEConnect, "GET /realtime", http.StatusOK, time.Since(start))
			p.mu.Lock()
			p.client = hello.ClientID
			topics := p.topics
			p.mu.Unlock()
			path := "/api/realtime/" + hello.ClientID + "/subscriptions"
			// The layout subscribes first, then the gym and session add theirs: two PUTs per connection.
			p.call(groupAPI, "PUT /realtime/{id}/subscriptions", "PUT", path, map[string]any{"topics": layoutTopics(p.gym.id)}, nil)
			p.call(groupAPI, "PUT /realtime/{id}/subscriptions", "PUT", path, map[string]any{"topics": topics}, nil)
			p.mu.Lock()
			afterDrop := p.drops > 0
			p.drops = 0
			p.mu.Unlock()
			if afterDrop {
				p.refreshLive()
			}
			continue
		}
		received(event, data)
		p.react(event, data)
	}
	return true
}

var (
	sseOpen     atomic.Int64
	sseDrops    atomic.Int64
	sseEvents   sync.Map
	pending     sync.Map
	eventTopics = regexp.MustCompile(`:[a-z0-9]{15}$`)
)

// sent marks a write whose realtime echo we time: every client that receives it adds a delivery sample.
func sent(key string) {
	at := time.Now()
	pending.Store(key, at)
	time.AfterFunc(time.Minute, func() { pending.CompareAndDelete(key, at) })
}

func received(topic, data string) {
	topic = eventTopics.ReplaceAllString(topic, ":{id}")
	counter, _ := sseEvents.LoadOrStore(topic, new(atomic.Int64))
	counter.(*atomic.Int64).Add(1)
	var payload struct {
		Kind   string `json:"kind"`
		Entry  string `json:"entry"`
		Record struct {
			ID string `json:"id"`
		} `json:"record"`
	}
	json.Unmarshal([]byte(data), &payload)
	key := ""
	switch {
	case topic == "own_ticks" || topic == "followed_ticks":
		key = "tick:" + payload.Record.ID
	case strings.HasPrefix(topic, "competition_changes") && payload.Entry != "":
		key = "score:" + payload.Entry
	}
	if at, ok := pending.Load(key); ok && key != "" {
		stats.add(groupSSEEvent, fmt.Sprintf("%s (write→event)", topic), http.StatusOK, time.Since(at.(time.Time)))
	}
}

// loaded registers a live data key the realtime cache refreshes, like a useAsyncData entry kept by keep-alive pages.
func (p *phone) loaded(key string, refresh func()) {
	p.mu.Lock()
	p.live[key] = refresh
	p.mu.Unlock()
}

// later coalesces refreshes of one key: the first trigger schedules it, later ones until then are dropped.
func (p *phone) later(key string, delay time.Duration) {
	p.mu.Lock()
	refresh, ok := p.live[key]
	if !ok || p.soon[key] {
		p.mu.Unlock()
		return
	}
	p.soon[key] = true
	p.mu.Unlock()
	p.done.Go(func() {
		select {
		case <-p.ctx.Done():
			return
		case <-time.After(delay):
		}
		p.mu.Lock()
		delete(p.soon, key)
		p.mu.Unlock()
		refresh()
	})
}

// refreshLive is the reconnect resync: every loaded live key, spread over 5 s.
func (p *phone) refreshLive() {
	p.mu.Lock()
	keys := slices.Collect(maps.Keys(p.live))
	p.mu.Unlock()
	for _, key := range keys {
		p.later(key, time.Duration(p.rng.Int64N(int64(5*time.Second))))
	}
}

// react mirrors realtime-cache.client.ts and the pages' own listeners: which events make a phone fetch again.
func (p *phone) react(topic, data string) {
	var change struct {
		Collection string `json:"collection"`
		Action     string `json:"action"`
		Record     struct {
			ID string `json:"id"`
		} `json:"record"`
	}
	json.Unmarshal([]byte(data), &change)
	switch {
	case strings.HasPrefix(topic, "gym_changes:") && change.Collection == "routes":
		if change.Action == "create" {
			p.later("routes", p.coalesceDelay())
		}
		p.later("route:"+change.Record.ID, 0)
		p.later("manage-routes", p.coalesceDelay())
	case strings.HasPrefix(topic, "gym_changes:") && change.Collection == "beta_videos":
		p.later("feed", p.coalesceDelay())
	case topic == "own_ticks":
		p.later("sends", p.coalesceDelay())
		p.later("logbook", p.coalesceDelay())
	case strings.HasPrefix(topic, "competition_changes:"):
		p.later("results", 2*time.Second+time.Duration(rand.Int64N(int64(2*time.Second))))
	case strings.HasPrefix(topic, "tasks:"):
		p.later("tasks", p.coalesceDelay())
	}
}

// coalesceDelay is the app's coalesce() wait (app/utils/realtimeCache.ts): 1–2 s, so phones don't refetch in lockstep.
func (p *phone) coalesceDelay() time.Duration {
	return time.Second + time.Duration(rand.Int64N(int64(time.Second)))
}

// pause is a think time that ends early when the run stops.
func (p *phone) pause(median time.Duration) bool {
	select {
	case <-p.ctx.Done():
		return false
	case <-time.After(time.Duration(float64(thinkTime(median, p.rng)) * *thinkScale)):
		return true
	}
}
