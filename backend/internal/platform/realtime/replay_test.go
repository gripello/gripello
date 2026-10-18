package realtime

import (
	"bufio"
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/testkit"
)

func TestAFullStreamIsSentToReplayInsteadOfLosingEvents(t *testing.T) {
	h := &Hub{perms: fakePerms{}, clients: map[string]*client{}, closing: make(chan struct{})}
	c := &client{id: "c1", send: make(chan frame, 1), gone: make(chan struct{}),
		principal: &auth.Principal{UserID: "u1"}, topics: []string{"own_ticks"}}
	h.clients[c.id] = c
	for id := range int64(2) {
		h.deliver(events.Event{ID: id + 1, Topic: "own_ticks", Audience: events.Audience{Users: []string{"u1"}}})
	}
	if !c.stale.Load() || h.Dropped() != 1 {
		t.Fatalf("stale=%v dropped=%d: a full buffer must end the stream", c.stale.Load(), h.Dropped())
	}
}

func TestServerOnlyEventsReachNoStream(t *testing.T) {
	h := &Hub{perms: fakePerms{}, clients: map[string]*client{}, closing: make(chan struct{})}
	c := &client{id: "c1", send: make(chan frame, 1), principal: &auth.Principal{UserID: "u1"}, topics: []string{"notify"}}
	h.clients[c.id] = c
	h.deliver(events.Event{ID: 1, Topic: "notify"})
	if len(c.send) != 0 {
		t.Fatal("an event without audience reached a stream")
	}
}

type stream struct {
	mu       sync.Mutex
	clientID string
	lines    []string
}

func (s *stream) snapshot() (string, []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.clientID, append([]string(nil), s.lines...)
}

// openStream connects like a client reopening the stream itself: the last id travels as a query parameter.
func openStream(t *testing.T, ctx context.Context, h *Hub, lastEventID int64, subscription string) *stream {
	t.Helper()
	server := httptest.NewServer(httpx.Handler(h.Connect))
	t.Cleanup(server.Close)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"?lastEventId="+strconv.FormatInt(lastEventID, 10), nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	s := &stream{}
	go func() {
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			line := scanner.Text()
			s.mu.Lock()
			if rest, ok := strings.CutPrefix(line, `data:{"clientId":"`); ok {
				s.clientID = strings.TrimSuffix(rest, `"}`)
			} else if strings.HasPrefix(line, "id:") || strings.HasPrefix(line, "event:") && line != "event:connect" {
				s.lines = append(s.lines, line)
			}
			s.mu.Unlock()
		}
	}()
	waitFor(t, func() bool { id, _ := s.snapshot(); return id != "" })
	id, _ := s.snapshot()
	rec := httptest.NewRecorder()
	mux := http.NewServeMux()
	mux.Handle("PUT /realtime/{clientId}/subscriptions", httpx.Handler(h.Subscriptions))
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/realtime/"+id+"/subscriptions", bytes.NewBufferString(subscription)))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("subscribe = %d %s", rec.Code, rec.Body)
	}
	return s
}

func TestReplayCoversTheStreamsTopicsInOrderBeforeLiveEvents(t *testing.T) {
	pool := testkit.Pool(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	bus := events.NewBus(pool)
	h := NewHub(bus, fakePerms{})
	bus.Start(ctx)

	before := publishPublic(t, pool, "gym:x")
	first := publishPublic(t, pool, "gym:x")
	publishPublic(t, pool, "gym:y")
	second := publishPublic(t, pool, "gym:x")
	s := openStream(t, ctx, h, before, `{"topics":["gym:x"]}`)
	live := publishPublic(t, pool, "gym:x")

	want := []string{"id:" + strconv.FormatInt(first, 10), "event:gym:x", "id:" + strconv.FormatInt(second, 10), "event:gym:x",
		"id:" + strconv.FormatInt(live, 10), "event:gym:x"}
	waitFor(t, func() bool { _, got := s.snapshot(); return len(got) >= len(want) })
	if _, got := s.snapshot(); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("stream = %v, want %v", got, want)
	}
}

func TestReplayAfterPrunedEventsAsksForAResync(t *testing.T) {
	pool := testkit.Pool(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	bus := events.NewBus(pool)
	h := NewHub(bus, fakePerms{})
	bus.Start(ctx)

	before := publishPublic(t, pool, "gym:x")
	pruned := publishPublic(t, pool, "gym:x")
	kept := publishPublic(t, pool, "gym:x")
	if _, err := pool.Exec(ctx, `DELETE FROM events WHERE id <= $1`, pruned); err != nil {
		t.Fatal(err)
	}
	s := openStream(t, ctx, h, before, `{"topics":["gym:x"]}`)

	waitFor(t, func() bool {
		_, got := s.snapshot()
		return len(got) >= 4
	})
	_, got := s.snapshot()
	if got[0] != "id:"+strconv.FormatInt(kept, 10) || got[3] != "event:resync" {
		t.Fatalf("stream = %v, want the kept event, then a resync", got)
	}
}

func TestASubscriptionCanReplayWhatTheStreamMissed(t *testing.T) {
	pool := testkit.Pool(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	bus := events.NewBus(pool)
	h := NewHub(bus, fakePerms{})
	bus.Start(ctx)

	before := publishPublic(t, pool, "gym:x")
	missed := publishPublic(t, pool, "gym:x")
	s := openStream(t, ctx, h, 0, `{"topics":["gym:x"],"since":`+strconv.FormatInt(before, 10)+`}`)

	waitFor(t, func() bool { _, got := s.snapshot(); return len(got) >= 2 })
	if _, got := s.snapshot(); got[0] != "id:"+strconv.FormatInt(missed, 10) {
		t.Fatalf("stream = %v, want the event after since", got)
	}
}
