package realtime

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/rand/v2"
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
	"gripello/internal/platform/tenancy"
)

const (
	heartbeat       = 30 * time.Second
	absoluteTimeout = 30 * time.Minute
	replayLimit     = 500
	permCacheTTL    = 5 * time.Second
	permLookupLimit = 2 * time.Second
	// A subscription verified just before its session was revoked can arrive after the revocation; it outlives the 15 s token cache and bus lag.
	revokedFor = 10 * time.Minute
	// Server-only (empty audience): a subscription change on its way to the replica holding the stream.
	subscriptionTopic = "realtime.subscriptions"
)

// Permissions answers audience questions the hub can't decide from the principal alone, as one set per event.
type Permissions interface {
	UsersWith(ctx context.Context, gym, permission string) ([]string, error)
	Followers(ctx context.Context, followeeID string) ([]string, error)
	GymViewers(ctx context.Context, gym string) ([]string, error)
}

// frame is one SSE message, encoded once per event however many streams it goes to.
type frame struct {
	id    int64
	topic string
	data  []byte
	epoch int // the client's principal generation when it was queued
}

func frameOf(e events.Event) frame { return frame{id: e.ID, topic: e.Topic, data: withKind(e)} }

type client struct {
	id          string
	principal   *auth.Principal
	epoch       int   // bumped when the principal changes, so frames queued for the old one are not written
	subscribed  int64 // id of the subscription change applied last
	topics      []string
	send        chan frame
	replayFrom  int64 // Last-Event-ID, replayed once the client has told us its topics
	replay      []frame
	resyncAt    int64 // the replay couldn't cover the gap: the client refetches, then continues after this id
	replayReady chan struct{}
	mu          sync.Mutex
	stale       atomic.Bool
	gone        chan struct{}
	goneOnce    sync.Once
}

// takeReplay hands the stream what applySubscription queued; it goes out before any newer live event.
func (c *client) takeReplay() ([]frame, int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	frames, resyncAt := c.replay, c.resyncAt
	c.replay, c.resyncAt = nil, 0
	return frames, resyncAt
}

// reconnect ends the stream before it sends anything newer, so the client resumes through Last-Event-ID.
func (c *client) reconnect() {
	c.stale.Store(true)
	c.goneOnce.Do(func() { close(c.gone) })
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
	revokedMu sync.Mutex
	revoked   map[string]time.Time
	seen      int64 // highest event id deliver got; only the deliver goroutine touches it
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
	// the bus dispatches events that committed after a gap out of order
	latest := h.seen
	h.seen = max(h.seen, e.ID)
	switch {
	case e.Topic == subscriptionTopic:
		h.applySubscription(e, latest)
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
	if e.Audience.Empty() {
		return
	}
	accepts := h.accepts(e)
	var out *frame
	for _, c := range h.snapshot() {
		c.mu.Lock()
		subscribed := slices.Contains(c.topics, e.Topic)
		p, epoch := c.principal, c.epoch
		c.mu.Unlock()
		if !subscribed || c.stale.Load() {
			continue
		}
		ok, retry := accepts(p)
		if retry {
			c.reconnect()
		}
		if !ok {
			continue
		}
		if out == nil {
			f := frameOf(e)
			out = &f
		}
		f := *out
		f.epoch = epoch
		select {
		case c.send <- f:
		default: // slow client: end the stream before anything newer, it catches up through Last-Event-ID
			h.dropped.Add(1)
			c.reconnect()
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
	if payload.Session == "" {
		return
	}
	h.revokedMu.Lock()
	if h.revoked == nil {
		h.revoked = map[string]time.Time{}
	}
	for sid, at := range h.revoked {
		if time.Since(at) > revokedFor {
			delete(h.revoked, sid)
		}
	}
	h.revoked[payload.Session] = time.Now()
	h.revokedMu.Unlock()
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, c := range h.clients {
		c.mu.Lock()
		// Ending the stream also discards what was queued for the session; the client resumes as whoever it is now.
		if c.principal != nil && c.principal.SessionID == payload.Session {
			c.principal = nil
			c.reconnect()
		}
		c.mu.Unlock()
	}
}

// live drops a principal whose session this hub saw revoked.
func (h *Hub) live(p *auth.Principal) *auth.Principal {
	if p == nil {
		return nil
	}
	h.revokedMu.Lock()
	defer h.revokedMu.Unlock()
	if _, revoked := h.revoked[p.SessionID]; revoked {
		return nil
	}
	return p
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
			if c.principal.PlatformAdmin && !payload.Record.PlatformAdmin {
				c.reconnect() // frames queued for the admin must not go out
			}
			refreshed := *c.principal
			refreshed.PlatformAdmin = payload.Record.PlatformAdmin
			c.principal = &refreshed
		}
		c.mu.Unlock()
	}
}

var gymTopics = []string{"gym_changes:", "open_route_defects:", "tasks:", "gym:", "moderation:", "competitions:", "leaderboard:"}

func gymOf(e events.Event) string {
	if e.Audience.Gym != "" {
		return e.Audience.Gym
	}
	for _, prefix := range gymTopics {
		if gym, ok := strings.CutPrefix(e.Topic, prefix); ok && gym != "platform" {
			return gym
		}
	}
	return ""
}

// accepts adds the gym gate to the audience: events of a gym reach only those who may see it (gym_visible), unless addressed by user.
// retry reports a failed visibility lookup: the client must reconnect and get the event through replay.
func (h *Hub) accepts(e events.Event) func(*auth.Principal) (ok, retry bool) {
	audience := h.audience(e.Audience)
	gym := gymOf(e)
	if gym == "" || h.perms == nil {
		return func(p *auth.Principal) (bool, bool) { return audience(p), false }
	}
	var viewers map[string]bool
	var lookupFailed bool
	return func(p *auth.Principal) (bool, bool) {
		if !audience(p) {
			return false, false
		}
		if p != nil && (p.PlatformAdmin || slices.Contains(e.Audience.Users, p.UserID)) {
			return true, false
		}
		if viewers == nil {
			viewers = h.usersFor("sees\x00"+gym, func(ctx context.Context) ([]string, error) {
				ids, err := h.perms.GymViewers(ctx, gym)
				lookupFailed = err != nil
				return ids, err
			})
		}
		if lookupFailed {
			return false, true
		}
		return viewers["*"] || p != nil && viewers[p.UserID], false
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
		if a.SignedIn || a.PlatformAdmins && p.PlatformAdmin || slices.Contains(a.Users, p.UserID) {
			return true
		}
		if hasGymPerm {
			if p.PlatformAdmin && slices.Contains(tenancy.PlatformAdminGrants, perm) {
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
	c := &client{id: ids.New(), send: make(chan frame, 64), gone: make(chan struct{}), replayReady: make(chan struct{}, 1)}
	if p, ok := auth.From(r.Context()); ok {
		c.principal = h.live(&p)
	}
	lastID := r.Header.Get("Last-Event-ID")
	if lastID == "" {
		lastID = r.URL.Query().Get("lastEventId") // a stream the client reopened itself can't set the header
	}
	if last, err := strconv.ParseInt(lastID, 10, 64); err == nil && last > 0 {
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
	written := newWrittenIDs()
	writeReplay := func() {
		frames, resyncAt := c.takeReplay()
		for _, f := range frames {
			written.write(w, f)
		}
		if resyncAt > 0 {
			written.writeID(w, resyncAt)
			fmt.Fprint(w, "event:resync\ndata:{}\n\n")
		}
		if len(frames) > 0 || resyncAt > 0 {
			flusher.Flush()
		}
	}
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-h.closing:
			return nil
		case <-c.gone:
			sendRetryLater(w, flusher)
			return nil
		case <-ping.C:
			fmt.Fprint(w, ":ping\n\n")
			flusher.Flush()
		case <-c.replayReady:
			if c.stale.Load() {
				sendRetryLater(w, flusher)
				return nil
			}
			writeReplay()
		case f := <-c.send:
			if c.stale.Load() {
				sendRetryLater(w, flusher)
				return nil
			}
			writeReplay()
			c.mu.Lock()
			current := slices.Contains(c.topics, f.topic) && f.epoch == c.epoch
			c.mu.Unlock()
			if !current {
				continue
			}
			if written.write(w, f) {
				flusher.Flush()
			}
		}
	}
}

// writtenIDs remembers the last replayLimit ids a stream wrote: a replay may repeat frames already queued or sent live.
type writtenIDs struct {
	seen  map[int64]bool
	order []int64
	last  int64
}

func newWrittenIDs() *writtenIDs { return &writtenIDs{seen: map[int64]bool{}} }

func (s *writtenIDs) write(w http.ResponseWriter, f frame) bool {
	if s.seen[f.id] {
		return false
	}
	s.seen[f.id] = true
	s.order = append(s.order, f.id)
	if len(s.order) > replayLimit {
		delete(s.seen, s.order[0])
		s.order = s.order[1:]
	}
	s.writeID(w, f.id)
	fmt.Fprintf(w, "event:%s\ndata:%s\n\n", f.topic, f.data)
	return true
}

// writeID only moves the stream's Last-Event-ID forward; a frame below it (replayed, or committed late) goes out without one.
func (s *writtenIDs) writeID(w http.ResponseWriter, id int64) {
	if id > s.last {
		s.last = id
		fmt.Fprintf(w, "id:%d\n", id)
	}
}

// sendRetryLater spreads the reconnects of streams closed together (one failed lookup closes all of a gym's) over a few seconds.
func sendRetryLater(w http.ResponseWriter, flusher http.Flusher) {
	fmt.Fprintf(w, "retry:%d\n\n", 2000+rand.IntN(8000))
	flusher.Flush()
}

// Subscriptions is PUT /realtime/{clientId}/subscriptions {"topics": [...], "since"?: id}; the auth of this request becomes the stream's principal.
// The stream may live on another replica, so the change travels over the bus; the deliver loop applies it in event order.
// since replays what the stream's previous principal couldn't receive, e.g. after signing in.
func (h *Hub) Subscriptions(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Topics []string `json:"topics"`
		Since  int64    `json:"since"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	change := subscriptionChange{Client: r.PathValue("clientId"), Topics: body.Topics, Since: body.Since}
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
	Since     int64           `json:"since,omitempty"`
	Principal *auth.Principal `json:"principal,omitempty"`
}

// latest > e.ID: the change committed late, events after it already went out under the old subscription.
func (h *Hub) applySubscription(e events.Event, latest int64) {
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
	principal := h.live(change.Principal)
	c.mu.Lock()
	if e.ID < c.subscribed {
		c.mu.Unlock()
		return
	}
	c.subscribed = e.ID
	c.topics = change.Topics
	if !samePrincipal(c.principal, principal) {
		c.epoch++
	}
	c.principal = principal
	replayFrom := max(c.replayFrom, change.Since)
	c.replayFrom = 0
	c.mu.Unlock()
	if latest > e.ID && len(change.Topics) > 0 {
		c.mu.Lock()
		c.resyncAt = latest
		c.mu.Unlock()
		c.signalReplay()
		return
	}
	if replayFrom == 0 || len(change.Topics) == 0 {
		return
	}
	missed, complete, err := h.bus.Since(context.Background(), replayFrom, change.Topics, replayLimit)
	if err != nil {
		slog.Warn("realtime: replay failed", "error", err)
	}
	var frames []frame
	for _, missedEvent := range missed {
		// Events after this one still pass through deliver; replaying them too would send them twice.
		if missedEvent.ID >= e.ID {
			complete = err == nil
			break
		}
		ok, retry := h.accepts(missedEvent)(principal)
		if retry {
			c.reconnect()
			return
		}
		if ok {
			frames = append(frames, frameOf(missedEvent))
		}
	}
	c.mu.Lock()
	c.replay = append(c.replay, frames...)
	if !complete {
		c.resyncAt = e.ID
	}
	c.mu.Unlock()
	c.signalReplay()
}

func (c *client) signalReplay() {
	select {
	case c.replayReady <- struct{}{}:
	default:
	}
}

func samePrincipal(a, b *auth.Principal) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
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
