package realtime

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
)

func hubWithClient(principal *auth.Principal) (*Hub, *client) {
	c := &client{id: "c1", principal: principal, send: make(chan frame, 1), gone: make(chan struct{})}
	return &Hub{clients: map[string]*client{c.id: c}}, c
}

func payload(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

func TestSessionRevocationIsAppliedInOrderWithSubscriptionChanges(t *testing.T) {
	h, c := hubWithClient(nil)
	alice := &auth.Principal{UserID: "alice", SessionID: "s1"}
	h.deliver(events.Event{ID: 1, Topic: subscriptionTopic, Payload: payload(subscriptionChange{Client: c.id, Topics: []string{"own_ticks"}, Principal: alice})})
	h.deliver(events.Event{ID: 2, Topic: "session.revoked", Kind: "session.revoked", Payload: payload(map[string]string{"session": "s1", "user": "alice"})})
	if c.principal != nil {
		t.Fatalf("revoked session still streams as %+v", c.principal)
	}
}

func TestPlatformAdminRevocationReachesOpenStreams(t *testing.T) {
	admin := &auth.Principal{UserID: "alice", PlatformAdmin: true}
	h, c := hubWithClient(admin)
	other, otherClient := &auth.Principal{UserID: "bob", PlatformAdmin: true}, &client{id: "c2"}
	otherClient.principal = other
	h.clients[otherClient.id] = otherClient

	h.deliver(events.Event{Topic: "user:alice", Kind: "user.updated", Payload: payload(map[string]any{"record": map[string]any{"id": "alice", "platform_admin": false}, "changed": []string{"firstname"}})})
	if !c.principal.PlatformAdmin {
		t.Fatal("an unrelated profile change must keep the flag")
	}
	h.deliver(events.Event{Topic: "user:alice", Kind: "user.updated", Payload: payload(map[string]any{"record": map[string]any{"id": "alice", "platform_admin": false}, "changed": []string{"platform_admin"}})})
	if c.principal.PlatformAdmin || c.principal.UserID != "alice" {
		t.Fatalf("principal after revoke = %+v", c.principal)
	}
	if !admin.PlatformAdmin || !otherClient.principal.PlatformAdmin {
		t.Fatal("only alice's stream changes, through a copy of the principal")
	}
}

func TestCloseEndsOpenStreams(t *testing.T) {
	h := NewHub(events.NewBus(nil), fakePerms{})
	streams := httptest.NewServer(httpx.Handler(h.Connect))
	t.Cleanup(streams.Close)
	resp, err := http.Get(streams.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	waitFor(t, func() bool { return h.Clients() == 1 })

	ended := make(chan struct{})
	go func() {
		io.Copy(io.Discard, resp.Body)
		close(ended)
	}()
	h.Close()
	select {
	case <-ended:
	case <-time.After(5 * time.Second):
		t.Fatal("stream still open after Close")
	}
}

func TestASubscriptionVerifiedBeforeItsSessionWasRevokedBindsNoPrincipal(t *testing.T) {
	h, c := hubWithClient(&auth.Principal{UserID: "alice", SessionID: "s1"})
	h.deliver(events.Event{ID: 1, Topic: "session.revoked", Kind: "session.revoked", Payload: payload(map[string]string{"session": "s1", "user": "alice"})})
	if !c.stale.Load() {
		t.Fatal("a stream of the revoked session must end, dropping what was queued for it")
	}
	h.deliver(events.Event{ID: 2, Topic: subscriptionTopic, Payload: payload(subscriptionChange{Client: c.id, Topics: []string{"own_ticks"},
		Principal: &auth.Principal{UserID: "alice", SessionID: "s1"}})})
	if c.principal != nil {
		t.Fatalf("revoked session bound again as %+v", c.principal)
	}
}

func TestFramesQueuedForAnEarlierPrincipalAreMarkedStale(t *testing.T) {
	h, c := hubWithClient(&auth.Principal{UserID: "alice", SessionID: "s1"})
	c.topics = []string{"own_ticks"}
	h.deliver(events.Event{ID: 1, Topic: "own_ticks", Audience: events.Audience{Users: []string{"alice"}}})
	h.deliver(events.Event{ID: 2, Topic: subscriptionTopic, Payload: payload(subscriptionChange{Client: c.id, Topics: []string{"own_ticks"}})})
	if f := <-c.send; f.epoch == c.epoch {
		t.Fatal("a frame queued for alice would still be written after she signed out")
	}
	h.deliver(events.Event{ID: 3, Topic: subscriptionTopic, Payload: payload(subscriptionChange{Client: c.id, Topics: []string{"gym:x"}})})
	if c.epoch != 1 {
		t.Fatalf("epoch %d: a topic change keeps the principal", c.epoch)
	}
}

func TestStreamSkipsRepeatedFramesAndNeverMovesItsIDBack(t *testing.T) {
	written := newWrittenIDs()
	rec := httptest.NewRecorder()
	for _, id := range []int64{5, 7, 5, 6} {
		written.write(rec, frame{id: id, topic: "t", data: []byte("{}")})
	}
	want := "id:5\nevent:t\ndata:{}\n\nid:7\nevent:t\ndata:{}\n\nevent:t\ndata:{}\n\n"
	if got := rec.Body.String(); got != want {
		t.Fatalf("stream = %q, want %q", got, want)
	}
}

func TestALateSubscriptionChangeNeitherOverridesANewerOneNorSkipsSilently(t *testing.T) {
	h, c := hubWithClient(nil)
	c.replayReady = make(chan struct{}, 1)
	h.deliver(events.Event{ID: 5, Topic: subscriptionTopic, Payload: payload(subscriptionChange{Client: c.id, Topics: []string{"new"}})})
	h.deliver(events.Event{ID: 7, Topic: "gym:x", Audience: events.Audience{Public: true}})
	h.deliver(events.Event{ID: 4, Topic: subscriptionTopic, Payload: payload(subscriptionChange{Client: c.id, Topics: []string{"old"}})})
	if c.topics[0] != "new" {
		t.Fatalf("topics = %v: an older subscription change overrode a newer one", c.topics)
	}
	h2, c2 := hubWithClient(nil)
	c2.replayReady = make(chan struct{}, 1)
	h2.deliver(events.Event{ID: 7, Topic: "gym:x", Audience: events.Audience{Public: true}})
	h2.deliver(events.Event{ID: 4, Topic: subscriptionTopic, Payload: payload(subscriptionChange{Client: c2.id, Topics: []string{"gym:x"}})})
	if _, resyncAt := c2.takeReplay(); resyncAt != 7 {
		t.Fatalf("resync at %d: a late subscription missed events already sent live", resyncAt)
	}
}

func TestSessionsListsSignedInStreamsOnce(t *testing.T) {
	h, _ := hubWithClient(&auth.Principal{UserID: "u1", SessionID: "s1"})
	h.clients["c2"] = &client{id: "c2", principal: &auth.Principal{UserID: "u1", SessionID: "s1"}}
	h.clients["c3"] = &client{id: "c3"}
	if got := h.Sessions(); len(got) != 1 || got[0] != "s1" {
		t.Errorf("sessions = %v, want [s1]", got)
	}
}
