package realtime

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
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
	permLookupLimit = 2 * time.Second
	// Server-only (empty audience): a subscription change on its way to the replica holding the stream.
	subscriptionTopic = "realtime.subscriptions"
)

// Permissions answers audience questions the hub can't decide from the principal alone, as one set per event.
type Permissions interface {
	UsersWith(ctx context.Context, gym, permission string) ([]string, error)
	Followers(ctx context.Context, followeeID string) ([]string, error)
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
	cache     map[string]cachedUsers
	closing   chan struct{}
	closeOnce sync.Once
	dropped   atomic.Int64
}

type cachedUsers struct {
	users   map[string]bool
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

// Dropped counts events skipped for slow clients since start.
func (h *Hub) Dropped() int64 { return h.dropped.Load() }

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

// usersFor keeps each audience's user set for permCacheTTL, so an event fanned out to many clients costs at most one query.
func (h *Hub) usersFor(key string, load func(context.Context) ([]string, error)) map[string]bool {
	h.cacheMu.Lock()
	cached, hit := h.cache[key]
	h.cacheMu.Unlock()
	if hit && time.Now().Before(cached.expires) {
		return cached.users
	}
	ctx, cancel := context.WithTimeout(context.Background(), permLookupLimit)
	defer cancel()
	ids, err := load(ctx)
	if err != nil {
		slog.Warn("realtime: audience lookup failed", "audience", key, "error", err)
		return map[string]bool{} // empty, not cached: the rest of this fan-out must not ask again
	}
	users := make(map[string]bool, len(ids))
	for _, id := range ids {
		users[id] = true
	}
	h.cacheMu.Lock()
	if h.cache == nil || len(h.cache) > 10_000 {
		h.cache = map[string]cachedUsers{}
	}
	h.cache[key] = cachedUsers{users, time.Now().Add(permCacheTTL)}
	h.cacheMu.Unlock()
	return users
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
	accepts := h.audience(e.Audience)
	for _, c := range h.snapshot() {
		c.mu.Lock()
		subscribed := slices.Contains(c.topics, e.Topic)
		p := c.principal
		c.mu.Unlock()
		if !subscribed || !accepts(p) {
			continue
		}
		select {
		case c.send <- e:
		default: // slow client: drop; it catches up through Last-Event-ID on reconnect
			h.dropped.Add(1)
		}
	}
}

// snapshot copies the client list, so a fan-out never holds the lock that Connect needs to register a stream.
func (h *Hub) snapshot() []*client {
	h.mu.RLock()
	defer h.mu.RUnlock()
	clients := make([]*client, 0, len(h.clients))
	for _, c := range h.clients {
		clients = append(clients, c)
	}
	return clients
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

// audience ORs every criterion set on a; NotUsers always excludes. Permission and follower sets load once, on the first client that needs them.
func (h *Hub) audience(a events.Audience) func(*auth.Principal) bool {
	var gymPermUsers, followers map[string]bool
	gym, perm, hasGymPerm := cut(a.GymPerm)
	return func(p *auth.Principal) bool {
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
		if hasGymPerm {
			if p.PlatformAdmin {
				return true
			}
			if gymPermUsers == nil {
				gymPermUsers = h.usersFor("can\x00"+gym+"\x00"+perm, func(ctx context.Context) ([]string, error) {
					return h.perms.UsersWith(ctx, gym, perm)
				})
			}
			if gymPermUsers[p.UserID] {
				return true
			}
		}
		if a.FollowersOf == "" {
			return false
		}
		if followers == nil {
			followers = h.usersFor("follows\x00"+a.FollowersOf, func(ctx context.Context) ([]string, error) {
				return h.perms.Followers(ctx, a.FollowersOf)
			})
		}
		return followers[p.UserID]
	}
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
		accepts := h.audience(missedEvent.Audience)
		// Events after this one still pass through deliver; replaying them too would send them twice.
		if missedEvent.ID >= e.ID {
			break
		}
		if slices.Contains(change.Topics, missedEvent.Topic) && accepts(change.Principal) {
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
