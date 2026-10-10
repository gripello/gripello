package events

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const channel = "gripello_events"

// An id below a committed one can still be in flight; a rolled-back publish leaves a gap for good.
const gapGrace = 2 * time.Second

// Audience decides who may receive an event, evaluated on each replica against the subscriber's principal.
// Criteria are ORed (Users ∪ GymPerm ∪ FollowersOf ∪ SignedIn); NotUsers always excludes; Public short-circuits.
// GuestsOnly lets a payload variant target anonymous clients while signed-in ones get a richer variant.
type Audience struct {
	Public      bool     `json:"public,omitempty"`
	GuestsOnly  bool     `json:"guests_only,omitempty"`
	Users       []string `json:"users,omitempty"`
	NotUsers    []string `json:"not_users,omitempty"`
	SignedIn    bool     `json:"signed_in,omitempty"`
	GymPerm     string   `json:"gym_perm,omitempty"` // "<gym>:<permission>"
	FollowersOf string   `json:"followers_of,omitempty"`
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
	aud, _ := json.Marshal(audience)
	if _, err := tx.Exec(ctx, `INSERT INTO events (topic, kind, payload, audience, actor) VALUES ($1, $2, $3, $4, $5)`, topic, kind, body, aud, actor); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `SELECT pg_notify($1, '')`, channel)
	return err
}

type Handler func(Event)

// A handler that falls this far behind blocks dispatch for everyone until it catches up.
const handlerBacklog = 1024

type subscription struct {
	prefix string
	queue  chan Event
}

// Bus listens on one dedicated connection and fans new outbox rows out to in-process handlers.
type Bus struct {
	pool     *pgxpool.Pool
	mu       sync.RWMutex
	subs     []subscription
	lastID   int64
	gapSince time.Time
}

func NewBus(pool *pgxpool.Pool) *Bus {
	return &Bus{pool: pool}
}

// Subscribe registers for topics starting with prefix ("" = everything); each handler runs in order on its own goroutine, so a slow one can't stall the others.
func (b *Bus) Subscribe(prefix string, h Handler) {
	queue := make(chan Event, handlerBacklog)
	go func() {
		for e := range queue {
			runSafely(h, e)
		}
	}()
	b.mu.Lock()
	defer b.mu.Unlock()
	b.subs = append(b.subs, subscription{prefix, queue})
}

func runSafely(h Handler, e Event) (ok bool) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("events: handler panicked", "event", e.ID, "topic", e.Topic, "panic", r)
			ok = false
		}
	}()
	h(e)
	return true
}

// Run blocks until ctx is done; it reconnects on errors and never skips rows (it reads by id, not by notification payload).
func (b *Bus) Run(ctx context.Context) {
	b.pool.QueryRow(ctx, `SELECT COALESCE(MAX(id), 0) FROM events`).Scan(&b.lastID)
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
func (b *Bus) drain(ctx context.Context) (waitingOnGap bool, err error) {
	rows, err := b.pool.Query(ctx, `SELECT id, topic, kind, payload, audience, actor, created FROM events WHERE id > $1 ORDER BY id`, b.lastID)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var e Event
		var aud []byte
		if err := rows.Scan(&e.ID, &e.Topic, &e.Kind, &e.Payload, &aud, &e.Actor, &e.Created); err != nil {
			return false, err
		}
		if e.ID != b.lastID+1 && b.lastID != 0 {
			if b.gapSince.IsZero() {
				b.gapSince = time.Now()
			}
			if time.Since(b.gapSince) < gapGrace {
				return true, nil
			}
		}
		b.gapSince = time.Time{}
		json.Unmarshal(aud, &e.Audience)
		b.lastID = e.ID
		b.dispatch(e)
	}
	return false, rows.Err()
}

func (b *Bus) dispatch(e Event) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, sub := range b.subs {
		if strings.HasPrefix(e.Topic, sub.prefix) {
			sub.queue <- e
		}
	}
}

// Since returns events after id, for SSE Last-Event-ID replay.
func (b *Bus) Since(ctx context.Context, id int64, limit int) ([]Event, error) {
	rows, err := b.pool.Query(ctx, `SELECT id, topic, kind, payload, audience, actor, created FROM events WHERE id > $1 ORDER BY id LIMIT $2`, id, limit)
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

var onceRetryDelay = time.Second

// SubscribeOnce runs h on exactly one replica per event: the replica that inserts the claim row runs it.
// A handler that panics gives the claim back and is retried, so a failure doesn't lose the event.
// Use it for side effects (writing rows, sending mail); plain Subscribe is for per-replica state like caches and SSE.
func (b *Bus) SubscribeOnce(prefix, handler string, h Handler) {
	b.Subscribe(prefix, func(e Event) {
		for attempt := 1; attempt <= 3; attempt++ {
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
			time.Sleep(time.Duration(attempt) * onceRetryDelay)
		}
	})
}
