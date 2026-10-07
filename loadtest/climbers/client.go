package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	mrand "math/rand/v2"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type client struct {
	http        *http.Client
	token       string
	user        map[string]any
	gym         *gym
	cookie      string
	pageTopic   []string
	onEvent     func(topic, data string)
	reconnected chan struct{}
	stopSSE     context.CancelFunc
	loaded      map[string]bool
	unread      string
	known       []string
	warm        atomic.Bool
	done        chan struct{}
	ended       sync.Once
}

const pbIdleTimeout = 5 * time.Minute

type items struct {
	Items []map[string]any `json:"items"`
}

var (
	sseOpen       atomic.Int64
	sseDrops      atomic.Int64
	peakSSE       atomic.Int64
	eventsByTopic sync.Map
	pendingWrites sync.Map
	stopping      atomic.Bool
	shownErrors   sync.Map
	knownETags    sync.Map
)

func newClient(g *gym) *client {
	transport := &http.Transport{
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: true},
		ForceAttemptHTTP2:   true,
		MaxIdleConnsPerHost: 6,
		IdleConnTimeout:     90 * time.Second,
	}
	c := &client{http: &http.Client{Transport: transport, Timeout: 30 * time.Second}, gym: g, loaded: map[string]bool{}, reconnected: make(chan struct{}, 1), done: make(chan struct{})}
	c.setCookie()
	return c
}

func (c *client) setCookie() {
	cookie := "gym=" + c.gym.slug
	if c.token != "" {
		auth, _ := json.Marshal(map[string]any{"token": c.token, "record": map[string]any{
			"id": c.user["id"], "collectionId": c.user["collectionId"], "collectionName": "users",
			"email": c.user["email"], "verified": true,
		}})
		cookie += "; pb_auth=" + url.QueryEscape(string(auth))
	}
	c.cookie = cookie
}

func (c *client) signedIn() bool { return c.token != "" }

func (c *client) me() string {
	id, _ := c.user["id"].(string)
	return id
}

type multipartBody struct {
	data        []byte
	contentType string
}

func (c *client) do(label, method, path string, body any, out any, alreadyDone ...int) bool {
	if slices.Contains(strings.Split(*skip, ","), label) {
		return false
	}
	var reader io.Reader
	contentType := ""
	switch b := body.(type) {
	case nil:
	case multipartBody:
		reader, contentType = bytes.NewReader(b.data), b.contentType
	default:
		data, _ := json.Marshal(b)
		reader, contentType = bytes.NewReader(data), "application/json"
	}
	req, _ := http.NewRequest(method, *baseURL+path, reader)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if c.token != "" && strings.HasPrefix(path, "/api/") {
		req.Header.Set("Authorization", c.token)
	}
	req.Header.Set("Cookie", c.cookie)
	req.Header.Set("Accept-Encoding", "gzip")
	if etag, ok := knownETags.Load(path); ok && c.warm.Load() && method == "GET" && isStatic(path) {
		req.Header.Set("If-None-Match", etag.(string))
	}
	start := time.Now()
	resp, err := c.http.Do(req)
	if err != nil {
		record(label, 0, "neterr")
		return false
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	countTraffic(label, requestSize(req), responseSize(resp, len(raw)))
	if etag := resp.Header.Get("ETag"); etag != "" && method == "GET" && isStatic(path) {
		knownETags.Store(path, etag)
	}
	data := raw
	if resp.Header.Get("Content-Encoding") == "gzip" {
		if unzipped, err := gzip.NewReader(bytes.NewReader(raw)); err == nil {
			data, _ = io.ReadAll(unzipped)
		}
	}
	if slices.Contains(alreadyDone, resp.StatusCode) {
		record(label+" (already done)", time.Since(start), "")
		return false
	}
	if resp.StatusCode >= 400 {
		record(label, 0, fmt.Sprint(resp.StatusCode))
		if _, seen := shownErrors.LoadOrStore(fmt.Sprint(label, resp.StatusCode), true); *showErrors && !seen {
			fmt.Printf("%s %d %s: %.300s\n", label, resp.StatusCode, path, data)
		}
		return false
	}
	record(label, time.Since(start), "")
	if out != nil {
		_ = json.Unmarshal(data, out)
	}
	return true
}

func list(collection string, params url.Values) string {
	return "/api/collections/" + collection + "/records?" + params.Encode()
}

func all(params url.Values) url.Values {
	params.Set("perPage", "1000")
	params.Set("skipTotal", "1")
	return params
}

func (c *client) gymFilter(extra string) string {
	filter := fmt.Sprintf(`gym = "%s"`, c.gym.id)
	if extra != "" {
		filter += " && " + extra
	}
	return filter
}

func recordID() string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	buf := make([]byte, 15)
	_, _ = rand.Read(buf)
	for i := range buf {
		buf[i] = alphabet[int(buf[i])%len(alphabet)]
	}
	return string(buf)
}

func trackWrite(kind, key string) {
	at := time.Now()
	pendingWrites.Store(kind+":"+key, at)
	time.AfterFunc(time.Minute, func() { pendingWrites.CompareAndDelete(kind+":"+key, at) })
}

func countEvent(topic string) {
	counter, _ := eventsByTopic.LoadOrStore(topic, &atomic.Int64{})
	counter.(*atomic.Int64).Add(1)
}

// subscriptions mirrors the browser: every subscribe() of a page load is batched into one POST.
func (c *client) subscriptions() []string {
	topics := []string{"PB_CONNECT", "gym_changes:" + c.gym.id, "open_route_defects:" + c.gym.id, "own_ticks", "follow_changes", "followed_ticks"}
	if c.signedIn() {
		topics = append(topics, "own_notifications", "users/"+c.me(), "memberships/*", "roles/*")
	}
	return append(append(topics, "gyms/"+c.gym.id), c.pageTopic...)
}

// reconnectDelays is the PocketBase JS SDK's retry schedule.
var reconnectDelays = []time.Duration{200, 300, 500, 1000, 1200, 1500, 2000}

func (c *client) openRealtime() {
	c.closeRealtime()
	ctx, cancel := context.WithCancel(context.Background())
	c.stopSSE = cancel
	topics, onEvent := c.subscriptions(), c.onEvent
	go func() {
		failures := 0
		for first := true; ctx.Err() == nil && !stopping.Load(); {
			if c.subscribeOnce(ctx, first, topics, onEvent) {
				first, failures = false, 0
			} else {
				failures++
			}
			delay := reconnectDelays[min(failures, len(reconnectDelays)-1)] * time.Millisecond
			select {
			case <-ctx.Done():
				return
			case <-stopSignal:
				return
			case <-time.After(delay):
			}
		}
	}()
}

func (c *client) closeRealtime() {
	if c.stopSSE != nil {
		c.stopSSE()
		c.stopSSE = nil
	}
}

// end closes a visit: its SSE stream and the idle connections a closed tab would drop.
func (c *client) end() {
	c.ended.Do(func() { close(c.done) })
	c.closeRealtime()
	c.http.Transport.(*http.Transport).CloseIdleConnections()
}

// subscribeOnce holds one SSE stream and reports whether it got connected.
func (c *client) subscribeOnce(ctx context.Context, first bool, topics []string, onEvent func(topic, data string)) bool {
	req, _ := http.NewRequestWithContext(ctx, "GET", *baseURL+"/api/realtime", nil)
	req.Header.Set("Accept", "text/event-stream")
	start := time.Now()
	resp, err := (&http.Client{Transport: c.http.Transport}).Do(req)
	if err != nil || resp.StatusCode != 200 {
		if resp != nil {
			resp.Body.Close()
		}
		if ctx.Err() == nil {
			record("realtime:connect", 0, "failed")
		}
		return false
	}
	defer resp.Body.Close()
	countTraffic("realtime:stream", requestSize(req), responseSize(resp, 0))
	reader := bufio.NewReaderSize(countingReader{resp.Body, "realtime:stream"}, 64*1024)
	var event string
	connected := false
	lastLine := time.Now()
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if connected {
				sseOpen.Add(-1)
				// PocketBase closes streams that stayed silent for 5 minutes; the SDK just reconnects.
				idleClose := time.Since(lastLine) >= pbIdleTimeout-10*time.Second
				if ctx.Err() == nil && !stopping.Load() && !idleClose {
					sseDrops.Add(1)
				}
			}
			return connected
		}
		lastLine = time.Now()
		line = strings.TrimRight(line, "\r\n")
		switch {
		case strings.HasPrefix(line, "event:"):
			event = strings.TrimSpace(line[6:])
		case strings.HasPrefix(line, "data:"):
			data := strings.TrimSpace(line[5:])
			if event == "PB_CONNECT" {
				var hello struct {
					ClientID string `json:"clientId"`
				}
				_ = json.Unmarshal([]byte(data), &hello)
				if ctx.Err() != nil || !c.do("realtime:subscribe", "POST", "/api/realtime", map[string]any{"clientId": hello.ClientID, "subscriptions": topics}, nil) {
					return connected
				}
				record("realtime:connect", time.Since(start), "")
				sseOpen.Add(1)
				connected = true
				if !first {
					select {
					case c.reconnected <- struct{}{}:
					default:
					}
				}
				continue
			}
			topic, _, _ := strings.Cut(event, ":")
			if topic == "gym_changes" {
				var change struct {
					Collection string `json:"collection"`
				}
				_ = json.Unmarshal([]byte(data), &change)
				topic += "/" + change.Collection
			}
			countEvent(topic)
			measureDelivery(event, data)
			if onEvent != nil {
				onEvent(event, data)
			}
		}
	}
}

func measureDelivery(topic, data string) {
	var payload struct {
		Collection string `json:"collection"`
		Action     string `json:"action"`
		Kind       string `json:"kind"`
		Entry      string `json:"entry"`
		Record     struct {
			ID string `json:"id"`
		} `json:"record"`
	}
	_ = json.Unmarshal([]byte(data), &payload)
	key := ""
	switch {
	case payload.Collection == "ratings":
		key = "rating:" + payload.Record.ID
	case payload.Collection == "routes" && payload.Action == "create":
		key = "route:" + payload.Record.ID
	case strings.HasPrefix(topic, "competition_changes") && payload.Kind == "scores":
		key = "score:" + payload.Entry
	case topic == "own_ticks":
		key = "tick:" + payload.Record.ID
	}
	if key == "" {
		return
	}
	if sent, ok := pendingWrites.Load(key); ok {
		recordEvent(strings.SplitN(key, ":", 2)[0]+"→event", time.Since(sent.(time.Time)))
	}
}

// later runs fn after a random delay in [from, to], coalescing calls that arrive while one is pending.
func later(pending *atomic.Bool, from, to time.Duration, fn func()) {
	if !pending.CompareAndSwap(false, true) {
		return
	}
	go func() {
		time.Sleep(from + time.Duration(mrand.Int64N(int64(to-from)+1)))
		pending.Store(false)
		if !stopping.Load() {
			fn()
		}
	}()
}

func pause(scale float64) bool {
	d := time.Duration(float64(*think) * scale * (0.5 + mrand.Float64()))
	select {
	case <-time.After(d):
		return true
	case <-stopSignal:
		return false
	}
}

type countingReader struct {
	io.Reader
	label string
}

func (r countingReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	countTraffic(r.label, 0, int64(n))
	return n, err
}

func headerSize(header http.Header) int64 {
	size := int64(0)
	for key, values := range header {
		for _, value := range values {
			size += int64(len(key) + len(value) + 4)
		}
	}
	return size
}

// ponytail: header sizes are HTTP/1 text sizes, HTTP/2 HPACK sends less; TLS framing is not counted
func requestSize(req *http.Request) int64 {
	size := int64(len(req.Method)+len(req.URL.RequestURI())+12) + headerSize(req.Header)
	if req.ContentLength > 0 {
		size += req.ContentLength
	}
	return size
}

func responseSize(resp *http.Response, body int) int64 {
	return 15 + headerSize(resp.Header) + int64(body)
}

func isStatic(path string) bool {
	for _, prefix := range []string{"/_nuxt/", "/_i18n/", "/sw.js", "/app-icon", "/icon-", "/offline.html"} {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
}

// wait is a think pause that runs onReconnect on this goroutine when the SSE stream reconnected meanwhile.
func (c *client) wait(scale float64, onReconnect func()) bool {
	deadline := time.After(time.Duration(float64(*think) * scale * (0.5 + mrand.Float64())))
	for {
		select {
		case <-deadline:
			return true
		case <-stopSignal:
			return false
		case <-c.reconnected:
			if onReconnect != nil {
				onReconnect()
			}
		}
	}
}
