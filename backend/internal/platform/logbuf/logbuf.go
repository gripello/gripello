// Package logbuf ships every log record that passes the runtime level into server_logs, so the platform log page sees all replicas.
package logbuf

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"os"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Entry struct {
	Time    time.Time      `json:"time"`
	Replica string         `json:"replica"`
	Level   string         `json:"level"`
	Message string         `json:"message"`
	Attrs   map[string]any `json:"attrs,omitempty"`
	// Fingerprint and Weight are set for WARN+ records; a summary of suppressed repeats carries their count as Weight.
	Fingerprint string `json:"-"`
	Weight      int    `json:"-"`
}

// While the database is unreachable records queue up to this many; newer ones are dropped (stderr still has them).
const maxPending = 5000

const shipInterval = 2 * time.Second

// ponytail: storms keep this many rows per issue and minute (+ one weighted summary per flush), so their distinct users are undercounted.
const samplesPerMinute = 20

// Stacks are cut so a burst of panics can't fill the table with megabytes of goroutine dumps.
const maxStack = 8 << 10

type queue struct {
	mu         sync.Mutex
	pending    []Entry
	window     time.Time
	kept       map[string]int
	suppressed map[string]*Entry
	overflowed int
}

// Buffer is a slog.Handler that writes text to out and queues a copy of every record it lets through.
type Buffer struct {
	Level *slog.LevelVar
	queue *queue
	text  slog.Handler
	attrs []slog.Attr
	group string
}

func New(out io.Writer) *Buffer {
	level := &slog.LevelVar{}
	return &Buffer{Level: level, queue: &queue{}, text: slog.NewTextHandler(out, &slog.HandlerOptions{Level: level})}
}
func (b *Buffer) Enabled(ctx context.Context, level slog.Level) bool {
	return b.text.Enabled(ctx, level)
}

// SafeError keeps Postgres errors to code, table and constraint: their message and detail may quote row values (e-mails, user input).
func SafeError(err error) string {
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		context := strings.TrimSuffix(err.Error(), pg.Error())
		return fmt.Sprintf("%spostgres %s table=%s constraint=%s", context, pg.Code, pg.TableName, pg.ConstraintName)
	}
	return err.Error()
}

func scrub(a slog.Attr) slog.Attr {
	if err, ok := a.Value.Resolve().Any().(error); ok {
		return slog.String(a.Key, SafeError(err))
	}
	return a
}

// Handle scrubs error values for stderr and server_logs alike.
func (b *Buffer) Handle(ctx context.Context, original slog.Record) error {
	r := slog.NewRecord(original.Time, original.Level, original.Message, original.PC)
	original.Attrs(func(a slog.Attr) bool {
		r.AddAttrs(scrub(a))
		return true
	})
	attrs := map[string]any{}
	add := func(a slog.Attr) {
		key := a.Key
		if b.group != "" {
			key = b.group + "." + key
		}
		attrs[key] = scrub(a).Value.Resolve().Any()
	}
	for _, a := range b.attrs {
		add(a)
	}
	r.Attrs(func(a slog.Attr) bool {
		add(a)
		return true
	})
	if len(attrs) == 0 {
		attrs = nil
	}
	if stack, ok := attrs["stack"].(string); ok && len(stack) > maxStack {
		attrs["stack"] = strings.ToValidUTF8(stack[:maxStack], "") + "…"
	}
	b.queue.add(Entry{Time: r.Time, Level: r.Level.String(), Message: r.Message, Attrs: attrs,
		Fingerprint: Fingerprint(r.Level, r.Message, attrs), Weight: 1})
	return b.text.Handle(ctx, r)
}

func (b *Buffer) WithAttrs(attrs []slog.Attr) slog.Handler {
	clone := *b
	attrs = slices.Clone(attrs)
	for i, a := range attrs {
		attrs[i] = scrub(a)
	}
	clone.attrs = append(slices.Clip(b.attrs), attrs...)
	clone.text = b.text.WithAttrs(attrs)
	return &clone
}

func (b *Buffer) WithGroup(name string) slog.Handler {
	clone := *b
	clone.group = name
	clone.text = b.text.WithGroup(name)
	return &clone
}

func (q *queue) add(e Entry) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if e.Fingerprint != "" {
		// Only forward: records logged concurrently arrive slightly out of order around the minute boundary.
		if minute := e.Time.Truncate(time.Minute); minute.After(q.window) {
			q.window, q.kept = minute, map[string]int{}
		}
		if q.kept[e.Fingerprint] >= samplesPerMinute {
			if q.suppressed == nil {
				q.suppressed = map[string]*Entry{}
			}
			weight := 1
			if previous := q.suppressed[e.Fingerprint]; previous != nil {
				weight += previous.Weight
			}
			e.Weight = weight
			q.suppressed[e.Fingerprint] = &e
			return
		}
		q.kept[e.Fingerprint]++
	}
	if len(q.pending) < maxPending {
		q.pending = append(q.pending, e)
	} else {
		q.overflowed++
	}
}

// take hands out the queued records plus one summary per issue with suppressed repeats and one for records the full queue dropped.
func (q *queue) take() []Entry {
	q.mu.Lock()
	defer q.mu.Unlock()
	taken := q.pending
	q.pending = nil
	for _, latest := range q.suppressed {
		summary := *latest
		summary.Attrs = maps.Clone(latest.Attrs)
		if summary.Attrs == nil {
			summary.Attrs = map[string]any{}
		}
		summary.Attrs["suppressed"] = latest.Weight
		taken = append(taken, summary)
	}
	q.suppressed = nil
	if q.overflowed > 0 {
		attrs := map[string]any{"dropped": q.overflowed}
		taken = append(taken, Entry{Time: time.Now(), Level: slog.LevelWarn.String(), Message: "logbuf: queue full, records dropped",
			Attrs: attrs, Fingerprint: Fingerprint(slog.LevelWarn, "logbuf: queue full, records dropped", attrs), Weight: 1})
		q.overflowed = 0
	}
	return taken
}

// requeue puts a batch that failed to ship back in front of what arrived meanwhile.
func (q *queue) requeue(entries []Entry) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.pending = append(entries, q.pending...)
	if len(q.pending) > maxPending {
		q.overflowed += len(q.pending) - maxPending
		q.pending = q.pending[:maxPending]
	}
}

// Ship writes queued records every few seconds until ctx ends, then once more.
func (b *Buffer) Ship(ctx context.Context, pool *pgxpool.Pool, replica string) {
	ticker := time.NewTicker(shipInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			b.Flush(ctx, pool, replica)
		case <-ctx.Done():
			final, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			b.Flush(final, pool, replica)
			cancel()
			return
		}
	}
}

func (b *Buffer) Flush(ctx context.Context, pool *pgxpool.Pool, replica string) {
	entries := b.queue.take()
	if len(entries) == 0 {
		return
	}
	rows := make([][]any, len(entries))
	for i, e := range entries {
		var level slog.Level
		level.UnmarshalText([]byte(e.Level))
		var attrs []byte
		if e.Attrs != nil {
			attrs = cleanJSON(e.Attrs)
		}
		var fingerprint *string
		if e.Fingerprint != "" {
			fingerprint = &e.Fingerprint
		}
		rows[i] = []any{e.Time, replica, int(level), e.Level, clean(e.Message), attrs, fingerprint, max(e.Weight, 1)}
	}
	_, err := pool.CopyFrom(ctx, pgx.Identifier{"server_logs"}, []string{"time", "replica", "severity", "level", "message", "attrs", "fingerprint", "weight"}, pgx.CopyFromRows(rows))
	if err != nil {
		// A data error (class 22) fails again on every retry, so only connection-type failures are requeued.
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || !strings.HasPrefix(pgErr.Code, "22") {
			b.queue.requeue(entries)
		}
		// Not through slog: the failure would queue another record that can't be shipped either.
		fmt.Fprintf(os.Stderr, "logbuf: shipping %d records failed: %v\n", len(entries), err)
	}
}

// clean makes text storable: Postgres rejects NUL bytes and invalid UTF-8 in text and jsonb.
func clean(text string) string {
	return strings.ReplaceAll(strings.ToValidUTF8(text, "\uFFFD"), "\x00", "")
}

// cleanJSON encodes attrs for jsonb. Marshal already replaces invalid UTF-8; a NUL anywhere (nested values,
// Stringers) comes out as \u0000, so those encodings are decoded and every string cleaned before encoding again.
func cleanJSON(attrs map[string]any) []byte {
	encoded, err := json.Marshal(attrs)
	if err != nil || !bytes.Contains(encoded, []byte(`\u0000`)) {
		return encoded
	}
	var decoded any
	json.Unmarshal(encoded, &decoded)
	encoded, _ = json.Marshal(cleanValue(decoded))
	return encoded
}

func cleanValue(value any) any {
	switch v := value.(type) {
	case string:
		return clean(v)
	case []any:
		for i := range v {
			v[i] = cleanValue(v[i])
		}
	case map[string]any:
		cleaned := make(map[string]any, len(v))
		for key, item := range v {
			cleaned[clean(key)] = cleanValue(item)
		}
		return cleaned
	}
	return value
}

// Recent returns the newest records of every replica at or above min.
func Recent(ctx context.Context, pool *pgxpool.Pool, min slog.Level, limit int) ([]Entry, error) {
	rows, err := pool.Query(ctx, `SELECT time, replica, level, message, attrs FROM server_logs WHERE severity >= $1 ORDER BY time DESC, id DESC LIMIT $2`, int(min), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Entry{}
	for rows.Next() {
		var e Entry
		var attrs []byte
		if err := rows.Scan(&e.Time, &e.Replica, &e.Level, &e.Message, &attrs); err != nil {
			return nil, err
		}
		if attrs != nil {
			json.Unmarshal(attrs, &e.Attrs)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func Prune(ctx context.Context, pool *pgxpool.Pool, olderThan time.Duration) error {
	_, err := pool.Exec(ctx, `DELETE FROM server_logs WHERE time < now() - $1::interval`, olderThan.String())
	return err
}
