package realtime

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
)

// slowPerms answers like a database under load: every question costs a round trip.
type slowPerms struct {
	roundTrip time.Duration
	asked     atomic.Int64
}

func (s *slowPerms) UsersWith(context.Context, string, string) ([]string, error) {
	s.asked.Add(1)
	time.Sleep(s.roundTrip)
	return nil, nil
}

func (s *slowPerms) Followers(context.Context, string) ([]string, error) {
	s.asked.Add(1)
	time.Sleep(s.roundTrip)
	return []string{"u1"}, nil
}

func hubWithFriendFeedClients(perms Permissions, n int) *Hub {
	h := &Hub{perms: perms, clients: map[string]*client{}, closing: make(chan struct{})}
	for i := range n {
		id := fmt.Sprintf("c%d", i)
		h.clients[id] = &client{id: id, send: make(chan events.Event, 64),
			principal: &auth.Principal{UserID: fmt.Sprintf("u%d", i)}, topics: []string{"followed_ticks"}}
	}
	return h
}

func timeToConnectEvent(t *testing.T, h *Hub) time.Duration {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { h.Connect(w, r) }))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", server.URL, nil)
	start := time.Now()
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	line, _ := bufio.NewReader(res.Body).ReadString('\n')
	if !strings.HasPrefix(line, "event:connect") {
		t.Fatalf("first line %q", line)
	}
	return time.Since(start)
}

func TestConnectDoesNotWaitForAFanOut(t *testing.T) {
	perms := &slowPerms{roundTrip: time.Millisecond}
	h := hubWithFriendFeedClients(perms, 2000)
	go h.deliver(events.Event{ID: 1, Topic: "followed_ticks", Audience: events.Audience{FollowersOf: "climber"}})
	for perms.asked.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	if took := timeToConnectEvent(t, h); took > 200*time.Millisecond {
		t.Fatalf("a new stream waited %s for the fan-out of one friend event", took)
	}
}

func TestFanOutAsksOnceForAnEventsAudience(t *testing.T) {
	perms := &slowPerms{}
	h := hubWithFriendFeedClients(perms, 2000)
	h.deliver(events.Event{ID: 1, Topic: "followed_ticks", Audience: events.Audience{FollowersOf: "climber"}})
	if asked := perms.asked.Load(); asked > 1 {
		t.Fatalf("one friend event asked %d permission questions", asked)
	}
	for id, c := range h.clients {
		if got, want := len(c.send), map[bool]int{true: 1}[id == "c1"]; got != want {
			t.Fatalf("%s received %d events, want %d (only u1 follows the climber)", id, got, want)
		}
	}
}

type failingPerms struct{ asked atomic.Int64 }

func (f *failingPerms) UsersWith(context.Context, string, string) ([]string, error) {
	f.asked.Add(1)
	return nil, context.DeadlineExceeded
}

func (f *failingPerms) Followers(context.Context, string) ([]string, error) {
	f.asked.Add(1)
	return nil, context.DeadlineExceeded
}

func TestAFailedAudienceLookupIsNotRepeatedPerClient(t *testing.T) {
	perms := &failingPerms{}
	h := hubWithFriendFeedClients(perms, 500)
	h.deliver(events.Event{ID: 1, Topic: "followed_ticks", Audience: events.Audience{FollowersOf: "climber"}})
	if asked := perms.asked.Load(); asked != 1 {
		t.Fatalf("a failing lookup was asked %d times during one fan-out", asked)
	}
	h.deliver(events.Event{ID: 2, Topic: "followed_ticks", Audience: events.Audience{FollowersOf: "climber"}})
	if asked := perms.asked.Load(); asked != 2 {
		t.Fatal("a failed lookup must not be cached for the next event")
	}
}
