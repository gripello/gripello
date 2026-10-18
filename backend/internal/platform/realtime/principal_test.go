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
	c := &client{id: "c1", principal: principal, send: make(chan frame, 1)}
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
