package realtime

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
)

const (
	heartbeat       = 30 * time.Second
	absoluteTimeout = 30 * time.Minute
	replayLimit     = 500
	permCacheTTL    = 5 * time.Second
	// Server-only (empty audience): a subscription change on its way to the replica holding the stream.
	subscriptionTopic = "realtime.subscriptions"
)

// Permissions answers audience questions the hub can't decide from the principal alone.
type Permissions interface {
	Can(ctx context.Context, userID, gym, permission string) bool
	Follows(ctx context.Context, followerID, followeeID string) bool
}

type client struct {
	id         string
	principal  *auth.Principal
	topics     []string
	send       chan events.Event
	replayFrom int64 // Last-Event-ID, replayed once the client has told us its topics
	mu         sync.Mutex
}

// Hub holds this replica's SSE clients; cross-replica delivery comes through the events bus.
type Hub struct {
	bus       *events.Bus
	perms     Permissions
	mu        sync.RWMutex
	clients   map[string]*client
	cacheMu   sync.Mutex
	cache     map[string]cachedAnswer
	closing   chan struct{}
	closeOnce sync.Once
}

type cachedAnswer struct {
	ok      bool
	expires time.Time
}

func NewHub(bus *events.Bus, perms Permissions) *Hub {
	h := &Hub{bus: bus, perms: perms, clients: map[string]*client{}, closing: make(chan struct{})}
	bus.Subscribe("", h.deliver)
	return h
}

// Close ends every open stream, so a graceful server shutdown doesn't wait for them; clients reconnect to another replica.
func (h *Hub) Close() {
	h.closeOnce.Do(func() { close(h.closing) })
}

func (h *Hub) Clients() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// Membership, role, follow and account changes reach the hub as events; they drop every cached answer.
func invalidatesPermissions(topic string) bool {
	for _, prefix := range []string{"gym:", "follow", "user:"} {
		if strings.HasPrefix(topic, prefix) {
			return true
		}
	}
	return false
}

// cached answers audience questions for permCacheTTL, so an event fanned out to many clients costs one query per distinct question.
func (h *Hub) cached(key string, ask func() bool) bool {
	h.cacheMu.Lock()
	answer, hit := h.cache[key]
	h.cacheMu.Unlock()
	if hit && time.Now().Before(answer.expires) {
		return answer.ok
	}
	ok := ask()
	h.cacheMu.Lock()
	if h.cache == nil || len(h.cache) > 100_000 {
		h.cache = map[string]cachedAnswer{}
	}
	h.cache[key] = cachedAnswer{ok, time.Now().Add(permCacheTTL)}
	h.cacheMu.Unlock()
	return ok
}

func (h *Hub) deliver(e events.Event) {
	switch {
	case e.Topic == subscriptionTopic:
		h.applySubscription(e)
		return
	case e.Topic == "session.revoked":
		h.dropSession(e)
		return
	case e.Kind == "user.updated":
		h.refreshPlatformAdmin(e)
	}
	if invalidatesPermissions(e.Topic) {
		h.cacheMu.Lock()
		h.cache = nil
		h.cacheMu.Unlock()
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, c := range h.clients {
		c.mu.Lock()
		subscribed := slices.Contains(c.topics, e.Topic)
		p := c.principal
		c.mu.Unlock()
		if !subscribed || !h.accepts(e.Audience, p) {
			continue
		}
		select {
		case c.send <- e:
		default: // slow client: drop; it catches up through Last-Event-ID on reconnect
		}
	}
}

func (h *Hub) dropSession(e events.Event) {
	var payload struct {
		Session string `json:"session"`
	}
	json.Unmarshal(e.Payload, &payload)
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, c := range h.clients {
		c.mu.Lock()
		if c.principal != nil && c.principal.SessionID == payload.Session {
			c.principal = nil
		}
		c.mu.Unlock()
	}
}

func (h *Hub) refreshPlatformAdmin(e events.Event) {
	var payload struct {
		Record struct {
			PlatformAdmin bool `json:"platform_admin"`
		} `json:"record"`
		Changed []string `json:"changed"`
	}
	if json.Unmarshal(e.Payload, &payload) != nil || !slices.Contains(payload.Changed, "platform_admin") {
		return
	}
	userID := strings.TrimPrefix(e.Topic, "user:")
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, c := range h.clients {
		c.mu.Lock()
		if c.principal != nil && c.principal.UserID == userID {
			refreshed := *c.principal
			refreshed.PlatformAdmin = payload.Record.PlatformAdmin
			c.principal = &refreshed
		}
		c.mu.Unlock()
	}
}

// accepts ORs every criterion set on the audience; NotUsers always excludes.
func (h *Hub) accepts(a events.Audience, p *auth.Principal) bool {
	if a.Public {
		return true
	}
	if a.GuestsOnly {
		return p == nil
	}
	if p == nil || slices.Contains(a.NotUsers, p.UserID) {
		return false
	}
	if a.SignedIn || slices.Contains(a.Users, p.UserID) {
		return true
	}
	ctx := context.Background()
	if gym, perm, ok := cut(a.GymPerm); ok && (p.PlatformAdmin || h.cached("can\x00"+p.UserID+"\x00"+gym+"\x00"+perm, func() bool {
		return h.perms.Can(ctx, p.UserID, gym, perm)
	})) {
		return true
	}
	return a.FollowersOf != "" && h.cached("follows\x00"+p.UserID+"\x00"+a.FollowersOf, func() bool {
		return h.perms.Follows(ctx, p.UserID, a.FollowersOf)
	})
}

func cut(s string) (string, string, bool) {
	for i := 0; i < len(s); i++ {
		if s[i] == ':' {
			return s[:i], s[i+1:], true
		}
	}
	return s, "", false
}

// Connect is GET /realtime: opens the stream, sends `connect` with the clientId, replays after Last-Event-ID.
func (h *Hub) Connect(w http.ResponseWriter, r *http.Request) error {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return httpx.NewError(http.StatusInternalServerError, "Streaming unsupported.")
	}
	c := &client{id: ids.New(), send: make(chan events.Event, 64)}
	if p, ok := auth.From(r.Context()); ok {
		c.principal = &p
	}
	if last, err := strconv.ParseInt(r.Header.Get("Last-Event-ID"), 10, 64); err == nil && last > 0 {
		c.replayFrom = last
	}
	h.mu.Lock()
	h.clients[c.id] = c
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.clients, c.id)
		h.mu.Unlock()
	}()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	fmt.Fprintf(w, "event:connect\ndata:%s\n\n", mustJSON(map[string]string{"clientId": c.id}))
	flusher.Flush()

	ctx, cancel := context.WithTimeout(r.Context(), absoluteTimeout)
	defer cancel()
	ping := time.NewTicker(heartbeat)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-h.closing:
			return nil
		case <-ping.C:
			fmt.Fprint(w, ":ping\n\n")
			flusher.Flush()
		case e := <-c.send:
			c.mu.Lock()
			subscribed := slices.Contains(c.topics, e.Topic)
			c.mu.Unlock()
			if !subscribed {
				continue
			}
			fmt.Fprintf(w, "id:%d\nevent:%s\ndata:%s\n\n", e.ID, e.Topic, withKind(e))
			flusher.Flush()
		}
	}
}

// Subscriptions is PUT /realtime/{clientId}/subscriptions {"topics": [...]}; the auth of this request becomes the stream's principal.
// The stream may live on another replica, so the change travels over the bus; the deliver loop applies it in event order.
func (h *Hub) Subscriptions(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Topics []string `json:"topics"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	change := subscriptionChange{Client: r.PathValue("clientId"), Topics: body.Topics}
	if p, ok := auth.From(r.Context()); ok {
		change.Principal = &p
	}
	if err := h.bus.PublishNow(r.Context(), subscriptionTopic, "subscriptions.set", change); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

type subscriptionChange struct {
	Client    string          `json:"client"`
	Topics    []string        `json:"topics"`
	Principal *auth.Principal `json:"principal,omitempty"`
}

func (h *Hub) applySubscription(e events.Event) {
	var change subscriptionChange
	if json.Unmarshal(e.Payload, &change) != nil {
		return
	}
	h.mu.RLock()
	c := h.clients[change.Client]
	h.mu.RUnlock()
	if c == nil {
		return
	}
	c.mu.Lock()
	c.topics = change.Topics
	c.principal = change.Principal
	replayFrom := c.replayFrom
	c.replayFrom = 0
	c.mu.Unlock()
	if replayFrom == 0 {
		return
	}
	missed, _ := h.bus.Since(context.Background(), replayFrom, replayLimit)
	for _, missedEvent := range missed {
		// Events after this one still pass through deliver; replaying them too would send them twice.
		if missedEvent.ID >= e.ID {
			break
		}
		if slices.Contains(change.Topics, missedEvent.Topic) && h.accepts(missedEvent.Audience, change.Principal) {
			select {
			case c.send <- missedEvent:
			default:
			}
		}
	}
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

// withKind puts the event kind into the JSON object clients receive, so handlers can branch on it.
func withKind(e events.Event) []byte {
	body := bytes.TrimSpace(e.Payload)
	if len(body) < 2 || body[0] != '{' {
		return mustJSON(map[string]any{"kind": e.Kind, "data": json.RawMessage(body)})
	}
	head := []byte(`{"kind":` + string(mustJSON(e.Kind)))
	if len(body) == 2 {
		return append(head, '}')
	}
	return append(append(head, ','), body[1:]...)
}
