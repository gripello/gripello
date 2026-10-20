package events

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"runtime/debug"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform/apitime"
)

const channel = "gripello_events"

// An id below a committed one can still be in flight; a rolled-back publish leaves a gap for good.
const gapGrace = 2 * time.Second

const (
	// Ids passed over after gapGrace are looked up again on every drain for lateFor; rollbacks leave such ids for good.
	lateFor    = time.Minute
	maxSkipped = 1000
	drainBatch = 1000
	// Ids just below the sequence when the outbox is empty at startup may still commit.
	startupInFlight = 100
)

// Audience decides who may receive an event, evaluated on each replica against the subscriber's principal.
// Criteria are ORed (Users ∪ GymPerm ∪ FollowersOf ∪ SignedIn); NotUsers always excludes; Public short-circuits.
// GuestsOnly lets a payload variant target anonymous clients while signed-in ones get a richer variant.
type Audience struct {
	Public     bool     `json:"public,omitempty"`
	GuestsOnly bool     `json:"guests_only,omitempty"`
	Users      []string `json:"users,omitempty"`
	NotUsers   []string `json:"not_users,omitempty"`
	SignedIn   bool     `json:"signed_in,omitempty"`
	// PlatformAdmins reaches every platform admin, judged by the stream's principal like the other criteria.
	PlatformAdmins bool   `json:"platform_admins,omitempty"`
	GymPerm        string `json:"gym_perm,omitempty"` // "<gym>:<permission>"
	FollowersOf    string `json:"followers_of,omitempty"`
	Gym            string `json:"gym,omitempty"` // only viewers who may see this gym, for topics that don't name it
}

// Empty reports an audience no client matches, the mark of server-only events.
func (a Audience) Empty() bool {
	return !a.Public && !a.GuestsOnly && !a.SignedIn && !a.PlatformAdmins && len(a.Users) == 0 && a.GymPerm == "" && a.FollowersOf == ""
}

// Event is the outbox row. Actor (the user id behind the change) travels in the envelope, never in the
// payload clients receive, so the audit module can attribute public events without leaking ids.
type Event struct {
	ID       int64           `json:"id"`
	Topic    string          `json:"topic"`
	Kind     string          `json:"kind"`
	Payload  json.RawMessage `json:"payload"`
	Audience Audience        `json:"audience"`
	Actor    string          `json:"actor,omitempty"`
	Created  time.Time       `json:"created"`
}

// ChangedFields lists, sorted, the top-level JSON fields whose values differ between before and after, except ignored ones.
func ChangedFields(before, after any, ignored ...string) []string {
	var old, updated map[string]json.RawMessage
	b, _ := json.Marshal(before)
	a, _ := json.Marshal(after)
	json.Unmarshal(b, &old)
	json.Unmarshal(a, &updated)
	changed := []string{}
	for field, value := range updated {
		if !slices.Contains(ignored, field) && !bytes.Equal(old[field], value) {
			changed = append(changed, field)
		}
	}
	slices.Sort(changed)
	return changed
}

// TopicNotify is server-only: the notifications module turns each Notify into rows and pushes.
const TopicNotify = "notify"

type Notify struct {
	Type   string         `json:"type"`
	Users  []string       `json:"users"`
	Gym    string         `json:"gym"`
	Params map[string]any `json:"params"`
	URL    string         `json:"url"`
}

// PublishNotify skips notices without recipients.
func PublishNotify(ctx context.Context, tx pgx.Tx, actor string, n Notify) error {
	if len(n.Users) == 0 {
		return nil
	}
	return PublishAs(ctx, tx, actor, TopicNotify, TopicNotify, n, Audience{})
}

// Publish writes to the outbox inside the caller's transaction; the NOTIFY fires only when that commits.
func Publish(ctx context.Context, tx pgx.Tx, topic, kind string, payload any, audience Audience) error {
	return PublishAs(ctx, tx, "", topic, kind, payload, audience)
}

// PublishAs is Publish with the acting user's id in the envelope (empty for guests and system jobs).
func PublishAs(ctx context.Context, tx pgx.Tx, actor, topic, kind string, payload any, audience Audience) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	body = apitime.Canonical(body)
	aud, _ := json.Marshal(audience)
	if _, err := tx.Exec(ctx, `INSERT INTO events (topic, kind, payload, audience, actor) VALUES ($1, $2, $3, $4, $5)`, topic, kind, body, aud, actor); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `SELECT pg_notify($1, '')`, channel); err != nil {
		return err
	}
	publishObservers.Range(func(_, observer any) bool {
		observer.(Handler)(Event{Topic: topic, Kind: kind, Payload: body, Audience: audience, Actor: actor})
		return true
	})
	return nil
}

var publishObservers sync.Map

// ObservePublish runs h synchronously inside every publish of this process, before the commit; only for dropping per-replica cache entries, since the transaction may still roll back.
func ObservePublish(h Handler) (stop func()) {
	key := new(byte)
	publishObservers.Store(key, h)
	return func() { publishObservers.Delete(key) }
}

// PublishNow writes a server-only event in its own transaction, for changes that touch no other row.
func (b *Bus) PublishNow(ctx context.Context, topic, kind string, payload any) error {
	return pgx.BeginFunc(ctx, b.pool, func(tx pgx.Tx) error {
		return Publish(ctx, tx, topic, kind, payload, Audience{})
	})
}

type Handler func(Event)

// A handler that falls this far behind blocks dispatch for everyone until it catches up.
const handlerBacklog = 1024

type subscription struct {
	prefix string
	queue  chan Event
}

type onceSubscription struct {
	subscription
	handler string
}

// Bus listens on one dedicated connection and fans new outbox rows out to in-process handlers.
type Bus struct {
	pool     *pgxpool.Pool
	mu       sync.RWMutex
	subs     []subscription
	onces    []onceSubscription
	lastID   int64
	gapSince time.Time
	skipped  map[int64]time.Time // id → until when it may still commit
	done     <-chan struct{}
	// Once handlers hold it for reading while they claim and run; WaitForHandlers takes it for writing.
	running sync.RWMutex
	// delivered mirrors lastID for readers outside the listener goroutine.
	delivered  atomic.Int64
	started    atomic.Bool
	warnedFull time.Time
}

func NewBus(pool *pgxpool.Pool) *Bus {
	return &Bus{pool: pool}
}

// Subscribe registers for topics starting with prefix ("" = everything); each handler runs in order on its own goroutine, so a slow one can't stall the others.
func (b *Bus) Subscribe(prefix string, h Handler) {
	b.subscribe(prefix, h)
}

func (b *Bus) subscribe(prefix string, h Handler) subscription {
	queue := make(chan Event, handlerBacklog)
	go func() {
		for e := range queue {
			runSafely(h, e)
		}
	}()
	sub := subscription{prefix, queue}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.subs = append(b.subs, sub)
	return sub
}

func runSafely(h Handler, e Event) (ok bool) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("events: handler panicked", "event", e.ID, "topic", e.Topic, "kind", e.Kind, "panic", fmt.Sprint(r), "stack", string(debug.Stack()))
			ok = false
		}
	}()
	h(e)
	return true
}

// Start reads the live head before returning, so every event published afterwards is dispatched, then runs until ctx is done;
// it reconnects on errors and reads by id, not by notification payload.
// Plain handlers start at the live head; SubscribeOnce handlers also get the unclaimed events still in the outbox.
func (b *Bus) Start(ctx context.Context) {
	b.done = ctx.Done()
	var committed *int64
	for {
		err := b.pool.QueryRow(ctx, `SELECT (SELECT MAX(id) FROM events), CASE WHEN is_called THEN last_value ELSE 0 END FROM events_id_seq`).Scan(&committed, &b.lastID)
		if err == nil || ctx.Err() != nil {
			break
		}
		slog.Error("events: reading the outbox head failed", "error", err)
		time.Sleep(time.Second)
	}
	if committed != nil {
		b.lastID = *committed
	} else {
		b.skip(max(1, b.lastID-startupInFlight+1), b.lastID+1)
	}
	b.delivered.Store(b.lastID)
	b.started.Store(true)
	go b.sweepUnclaimed(ctx)
	go b.run(ctx)
}

func (b *Bus) run(ctx context.Context) {
	for ctx.Err() == nil {
		if err := b.listen(ctx); err != nil && ctx.Err() == nil {
			slog.Error("events: listener stopped", "error", err)
			time.Sleep(time.Second)
		}
	}
}

func (b *Bus) listen(ctx context.Context) error {
	conn, err := b.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, "LISTEN "+channel); err != nil {
		return err
	}
	for {
		waitingOnGap, err := b.drain(ctx)
		if err != nil {
			return err
		}
		wait := 30 * time.Second
		if waitingOnGap {
			wait = 50 * time.Millisecond
		}
		waitCtx, cancel := context.WithTimeout(ctx, wait)
		_, err = conn.Conn().WaitForNotification(waitCtx)
		cancel()
		if err != nil && ctx.Err() != nil {
			return ctx.Err()
		}
		if err != nil && waitCtx.Err() == nil {
			return err
		}
	}
}

// drain dispatches in id order and holds back at a gap until gapGrace has passed, because ids are taken
// at insert time but become visible at commit: reading past a gap would skip a slower transaction's event.
// Rows are read before dispatching, so a full handler queue never holds a connection.
func (b *Bus) drain(ctx context.Context) (waitingOnGap bool, err error) {
	if err := b.dispatchLate(ctx); err != nil {
		return false, err
	}
	for {
		pending, err := b.query(ctx, `SELECT id, topic, kind, payload, audience, actor, created FROM events WHERE id > $1 ORDER BY id LIMIT $2`, b.lastID, drainBatch)
		if err != nil {
			return false, err
		}
		for _, e := range pending {
			if e.ID != b.lastID+1 {
				if b.gapSince.IsZero() {
					b.gapSince = time.Now()
				}
				if time.Since(b.gapSince) < gapGrace {
					return true, nil
				}
				b.skip(b.lastID+1, e.ID)
			}
			b.gapSince = time.Time{}
			b.lastID = e.ID
			b.delivered.Store(e.ID)
			b.dispatch(e)
		}
		if len(pending) < drainBatch {
			return false, nil
		}
	}
}

func (b *Bus) skip(from, to int64) {
	if b.skipped == nil {
		b.skipped = map[int64]time.Time{}
	}
	until := time.Now().Add(lateFor)
	for id := from; id < to; id++ {
		if len(b.skipped) >= maxSkipped {
			slog.Warn("events: too many skipped ids, an event committing later is not dispatched to plain handlers", "from", id, "to", to)
			return
		}
		b.skipped[id] = until
	}
}

// dispatchLate hands handlers the skipped ids that committed after all; they arrive out of id order.
func (b *Bus) dispatchLate(ctx context.Context) error {
	if len(b.skipped) == 0 {
		return nil
	}
	ids := make([]int64, 0, len(b.skipped))
	for id, until := range b.skipped {
		if time.Now().After(until) {
			delete(b.skipped, id)
		} else {
			ids = append(ids, id)
		}
	}
	late, err := b.query(ctx, `SELECT id, topic, kind, payload, audience, actor, created FROM events WHERE id = ANY($1) ORDER BY id`, ids)
	if err != nil {
		return err
	}
	for _, e := range late {
		delete(b.skipped, e.ID)
		b.dispatch(e)
	}
	return nil
}

// dispatch blocks on a full queue without holding b.mu, and never once Start's ctx is done.
func (b *Bus) dispatch(e Event) {
	b.mu.RLock()
	subs := b.subs
	b.mu.RUnlock()
	for _, sub := range subs {
		if strings.HasPrefix(e.Topic, sub.prefix) {
			if len(sub.queue) > handlerBacklog*8/10 && time.Since(b.warnedFull) > time.Minute {
				b.warnedFull = time.Now()
				slog.Warn("events: handler queue almost full, dispatch will stall", "prefix", sub.prefix, "queued", len(sub.queue))
			}
			select {
			case sub.queue <- e:
			case <-b.done:
				return
			}
		}
	}
}

// Lag is how long the oldest event not yet dispatched on this replica has been waiting; 0 when caught up or before Run has read the head.
func (b *Bus) Lag(ctx context.Context) (time.Duration, error) {
	if !b.started.Load() {
		return 0, nil
	}
	var seconds float64
	err := b.pool.QueryRow(ctx, `SELECT COALESCE(EXTRACT(EPOCH FROM now() - MIN(created)), 0) FROM events WHERE id > $1`, b.delivered.Load()).Scan(&seconds)
	return time.Duration(seconds * float64(time.Second)), err
}

// QueueMax is the fullest handler queue right now; near handlerBacklog a slow handler is about to stall dispatch.
func (b *Bus) QueueMax() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	longest := 0
	for _, sub := range b.subs {
		longest = max(longest, len(sub.queue))
	}
	return longest
}

// Since returns events after id, for SSE Last-Event-ID replay.
// Since lists the events of topics after id; complete is false when the limit cut the list or
// Prune already dropped events after id, so the caller can't rebuild the gap from it.
func (b *Bus) Since(ctx context.Context, id int64, topics []string, limit int) (missed []Event, complete bool, err error) {
	missed, err = b.query(ctx, `SELECT id, topic, kind, payload, audience, actor, created FROM events
		WHERE id > $1 AND topic COLLATE "C" = ANY($2) ORDER BY id LIMIT $3`, id, topics, limit)
	if err != nil || len(missed) == limit {
		return missed, false, err
	}
	var oldest *int64
	if err := b.pool.QueryRow(ctx, `SELECT min(id) FROM events`).Scan(&oldest); err != nil {
		return missed, false, err
	}
	return missed, oldest == nil || *oldest <= id+1, nil
}

func (b *Bus) query(ctx context.Context, sql string, args ...any) ([]Event, error) {
	rows, err := b.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Event
	for rows.Next() {
		var e Event
		var aud []byte
		if err := rows.Scan(&e.ID, &e.Topic, &e.Kind, &e.Payload, &aud, &e.Actor, &e.Created); err != nil {
			return nil, err
		}
		json.Unmarshal(aud, &e.Audience)
		out = append(out, e)
	}
	return out, rows.Err()
}

// Prune keeps the outbox small; replay only needs to cover a reconnect window.
func (b *Bus) Prune(ctx context.Context, olderThan time.Duration) error {
	_, err := b.pool.Exec(ctx, `DELETE FROM events WHERE created < now() - $1::interval`, olderThan.String())
	return err
}

var (
	onceRetryDelay = time.Second
	onceSweepEvery = 30 * time.Second
	// Younger events are still on their way through live dispatch.
	onceSweepMinAge    = 10 * time.Second
	onceFullSweepEvery = 15 * time.Minute
)

// sweepUnclaimed hands every SubscribeOnce handler the outbox events it never claimed: ones committed while no
// bus ran, ones still queued at shutdown, ones live dispatch skipped behind a gap, and ones whose retries all failed.
// Each sweep reads only ids past the handler's cursor; the first sweep and one every onceFullSweepEvery read the
// whole outbox, catching retries that failed after the cursor passed and ids that committed below it.
// Events pruned from the outbox (see Prune) are gone for good.
func (b *Bus) sweepUnclaimed(ctx context.Context) {
	every, fullEvery, minAge := onceSweepEvery, onceFullSweepEvery, onceSweepMinAge
	cursors := map[chan Event]int64{}
	nextFullSweep := time.Now().Add(fullEvery)
	for {
		if time.Now().After(nextFullSweep) {
			clear(cursors)
			nextFullSweep = time.Now().Add(fullEvery)
		}
		b.sweepOnces(ctx, cursors, minAge)
		select {
		case <-time.After(every/2 + rand.N(every)):
		case <-ctx.Done():
			return
		}
	}
}

func (b *Bus) sweepOnces(ctx context.Context, cursors map[chan Event]int64, minAge time.Duration) {
	var upTo int64
	if err := b.pool.QueryRow(ctx, `SELECT COALESCE(MAX(id), 0) FROM events WHERE created < now() - $1::interval`,
		minAge.String()).Scan(&upTo); err != nil {
		if ctx.Err() == nil {
			slog.Error("events: sweeping unclaimed events failed", "error", err)
		}
		return
	}
	b.mu.RLock()
	onces := b.onces
	b.mu.RUnlock()
	for _, once := range onces {
		if cursors[once.queue] >= upTo {
			continue
		}
		missed, err := b.query(ctx, `SELECT id, topic, kind, payload, audience, actor, created FROM events e
			WHERE `+topicHasPrefix+` AND id > $3 AND id <= $4
			  AND NOT EXISTS (SELECT 1 FROM event_claims c WHERE c.event_id = e.id AND c.handler = $2)
			ORDER BY id`, once.prefix, once.handler, cursors[once.queue], upTo)
		if err != nil {
			if ctx.Err() == nil {
				slog.Error("events: sweeping unclaimed events failed", "handler", once.handler, "error", err)
			}
			continue
		}
		cursors[once.queue] = upTo
		for _, e := range missed {
			select {
			case once.queue <- e:
			case <-ctx.Done():
				return
			}
		}
	}
}

// starts_with(topic, $1) as a range events_topic_id_idx can serve; U+10FFFF is a noncharacter no topic contains.
const topicHasPrefix = `topic COLLATE "C" >= $1 AND topic COLLATE "C" < $1 || chr(1114111)`

// SubscribeOnce runs h on exactly one replica per event: the replica that inserts the claim row runs it.
// ponytail: a crash mid-handler loses that claimed event; a claim lease (claimed_at + done) closes that when it matters.
// A handler that panics gives the claim back and is retried, so a failure doesn't lose the event.
// Use it for side effects (writing rows, sending mail); plain Subscribe is for per-replica state like caches and SSE.
func (b *Bus) SubscribeOnce(prefix, handler string, h Handler) {
	retryDelay := onceRetryDelay
	sub := b.subscribe(prefix, func(e Event) {
		b.running.RLock()
		defer b.running.RUnlock()
		for attempt := 1; attempt <= 3 && !b.stopping(); attempt++ {
			tag, err := b.pool.Exec(context.Background(),
				`INSERT INTO event_claims (event_id, handler) VALUES ($1, $2) ON CONFLICT DO NOTHING`, e.ID, handler)
			if err != nil {
				slog.Error("events: claim failed", "handler", handler, "event", e.ID, "error", err)
				return
			}
			if tag.RowsAffected() == 0 || runSafely(h, e) {
				return
			}
			b.pool.Exec(context.Background(), `DELETE FROM event_claims WHERE event_id = $1 AND handler = $2`, e.ID, handler)
			time.Sleep(time.Duration(attempt) * retryDelay)
		}
	})
	b.mu.Lock()
	defer b.mu.Unlock()
	b.onces = append(b.onces, onceSubscription{sub, handler})
}

// stopping: once Start's ctx is done, queued events stay unclaimed for another replica's sweep.
func (b *Bus) stopping() bool {
	select {
	case <-b.done:
		return true
	default:
		return false
	}
}

// WaitForHandlers lets once handlers that already claimed an event finish, at most timeout; call it after Start's ctx is done.
func (b *Bus) WaitForHandlers(timeout time.Duration) {
	idle := make(chan struct{})
	go func() {
		b.running.Lock()
		b.running.Unlock()
		close(idle)
	}()
	select {
	case <-idle:
	case <-time.After(timeout):
		slog.Warn("events: once handlers still running at shutdown")
	}
}
