// Package metrics counts requests per route pattern in 5-minute buckets; every replica adds its counts to
// request_stats once a minute, so the numbers cover the whole deployment and survive restarts.
// Visitors are counted per day as salted IP hashes; the salt changes daily and old salts are deleted.
package metrics

import (
	"cmp"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"log/slog"
	"maps"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"gripello/internal/platform/httpx"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	Bucket = 5 * time.Minute
	// Twice the longest overview range, so 30 days can be compared with the 30 before.
	Retention = 60 * 24 * time.Hour
)

// LatencyBounds are the upper bounds (ms) of the histogram columns b0..b9; b10 counts everything slower.
var LatencyBounds = []float64{5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000}

// streaming patterns stay open for minutes, their duration says nothing about speed.
var streaming = map[string]bool{"GET /api/realtime": true}

type key struct {
	bucket          time.Time
	method, pattern string
}

type counts struct {
	total, client, server int64
	durationMS            float64
	histogram             [11]int64
}

type Recorder struct {
	pool     *pgxpool.Pool
	mu       sync.Mutex
	pending  map[key]*counts
	visitors map[string]struct{}
}

func New(pool *pgxpool.Pool) *Recorder {
	return &Recorder{pool: pool, pending: map[key]*counts{}, visitors: map[string]struct{}{}}
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}

func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// Middleware must wrap the mux: the mux fills r.Pattern on the same request.
func (rec *Recorder) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		rec.Record(r.Method, r.Pattern, sw.status, time.Since(start), httpx.ClientIP(r))
	})
}

func (rec *Recorder) Record(method, pattern string, status int, took time.Duration, ip string) {
	if status == 0 {
		status = http.StatusOK
	}
	if pattern == "" {
		method, pattern = "", "unmatched"
	} else if m, path, ok := strings.Cut(pattern, " "); ok {
		method, pattern = m, path
	}
	k := key{bucket: time.Now().UTC().Truncate(Bucket), method: method, pattern: pattern}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	c := rec.pending[k]
	if c == nil {
		c = &counts{}
		rec.pending[k] = c
	}
	c.total++
	switch {
	case status >= 500:
		c.server++
	case status >= 400:
		c.client++
	}
	if !streaming[method+" "+pattern] {
		ms := float64(took.Microseconds()) / 1000
		c.durationMS += ms
		slot := len(LatencyBounds)
		for i, bound := range LatencyBounds {
			if ms <= bound {
				slot = i
				break
			}
		}
		c.histogram[slot]++
	}
	if ip != "" {
		rec.visitors[ip] = struct{}{}
	}
}

// Run flushes once a minute until ctx ends, then once more.
func (rec *Recorder) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			flushCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			rec.Flush(flushCtx)
			cancel()
			return
		case <-ticker.C:
			rec.Flush(ctx)
		}
	}
}

func (rec *Recorder) Flush(ctx context.Context) error {
	rec.mu.Lock()
	pending, visitors := rec.pending, rec.visitors
	rec.pending, rec.visitors = map[key]*counts{}, map[string]struct{}{}
	rec.mu.Unlock()
	if len(pending) == 0 && len(visitors) == 0 {
		return nil
	}
	err := pgx.BeginFunc(ctx, rec.pool, func(tx pgx.Tx) error {
		batch := &pgx.Batch{}
		// Sorted keys: replicas flushing at the same time lock rows in the same order and can't deadlock.
		keys := slices.SortedFunc(maps.Keys(pending), func(a, b key) int {
			return cmp.Or(a.bucket.Compare(b.bucket), cmp.Compare(a.method, b.method), cmp.Compare(a.pattern, b.pattern))
		})
		for _, k := range keys {
			c := pending[k]
			h := c.histogram
			batch.Queue(`INSERT INTO request_stats (bucket, method, pattern, total, client_errors, server_errors, duration_ms, b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
				ON CONFLICT (bucket, method, pattern) DO UPDATE SET total = request_stats.total + excluded.total,
				client_errors = request_stats.client_errors + excluded.client_errors, server_errors = request_stats.server_errors + excluded.server_errors,
				duration_ms = request_stats.duration_ms + excluded.duration_ms,
				b0 = request_stats.b0 + excluded.b0, b1 = request_stats.b1 + excluded.b1, b2 = request_stats.b2 + excluded.b2, b3 = request_stats.b3 + excluded.b3,
				b4 = request_stats.b4 + excluded.b4, b5 = request_stats.b5 + excluded.b5, b6 = request_stats.b6 + excluded.b6, b7 = request_stats.b7 + excluded.b7,
				b8 = request_stats.b8 + excluded.b8, b9 = request_stats.b9 + excluded.b9, b10 = request_stats.b10 + excluded.b10`,
				k.bucket, k.method, k.pattern, c.total, c.client, c.server, c.durationMS, h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8], h[9], h[10])
		}
		if len(visitors) > 0 {
			day := time.Now().UTC().Format(time.DateOnly)
			var salt []byte
			if err := tx.QueryRow(ctx, `INSERT INTO visitor_salts (day, salt) VALUES ($1, $2)
				ON CONFLICT (day) DO UPDATE SET salt = visitor_salts.salt RETURNING salt`, day, rand.Text()).Scan(&salt); err != nil {
				return err
			}
			for ip := range visitors {
				sum := sha256.Sum256(append(append([]byte{}, salt...), ip...))
				batch.Queue(`INSERT INTO request_visitors (day, hash) VALUES ($1, $2) ON CONFLICT DO NOTHING`, day, sum[:16])
			}
		}
		return tx.SendBatch(ctx, batch).Close()
	})
	if err != nil {
		slog.Warn("metrics: flushing request counts failed, retrying next minute", "error", err)
		rec.restore(pending, visitors)
	}
	return err
}

// restore puts counts of a failed flush back, so the next flush still writes them.
func (rec *Recorder) restore(pending map[key]*counts, visitors map[string]struct{}) {
	rec.mu.Lock()
	defer rec.mu.Unlock()
	for k, c := range pending {
		current := rec.pending[k]
		if current == nil {
			rec.pending[k] = c
			continue
		}
		current.total += c.total
		current.client += c.client
		current.server += c.server
		current.durationMS += c.durationMS
		for i := range current.histogram {
			current.histogram[i] += c.histogram[i]
		}
	}
	for ip := range visitors {
		rec.visitors[ip] = struct{}{}
	}
}

// Prune drops buckets past the retention and every salt but today's, so older visitor hashes can't be linked to IPs.
func Prune(ctx context.Context, pool *pgxpool.Pool) error {
	cutoff := time.Now().Add(-Retention)
	if _, err := pool.Exec(ctx, `DELETE FROM request_stats WHERE bucket < $1`, cutoff); err != nil {
		return err
	}
	if _, err := pool.Exec(ctx, `DELETE FROM request_visitors WHERE day < $1`, cutoff.UTC().Format(time.DateOnly)); err != nil {
		return err
	}
	_, err := pool.Exec(ctx, `DELETE FROM visitor_salts WHERE day < $1`, time.Now().UTC().Format(time.DateOnly))
	return err
}
