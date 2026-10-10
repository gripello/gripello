package account

import (
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform"
	"gripello/internal/platform/httpx"
)

type module struct {
	db          *pgxpool.Pool
	blob        platform.BlobStore
	exportLimit *limiter
}

func Register(app *platform.App) {
	m := &module{db: app.DB, blob: app.Blob, exportLimit: &limiter{max: 3, window: time.Hour, hits: map[string][]time.Time{}}}
	app.Handle("GET /me", httpx.Handler(m.getMe))
	app.Handle("PATCH /me", httpx.Handler(m.updateMe))
	app.Handle("DELETE /me", httpx.Handler(m.deleteMe))
	app.Handle("DELETE /me/avatar", m.clearFile("avatar"))
	app.Handle("DELETE /me/banner", m.clearFile("banner"))
	app.Handle("POST /me/followed-walls/{wall}", httpx.Handler(m.followWall))
	app.Handle("DELETE /me/followed-walls/{wall}", httpx.Handler(m.unfollowWall))
	app.Handle("GET /me/export", httpx.Handler(m.export))
	app.Handle("GET /me/contributions", httpx.Handler(m.contributions))
}

// ponytail: per-replica limiter, so N replicas allow N×max; move to a Postgres counter if that matters.
type limiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	hits   map[string][]time.Time
}

func (l *limiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	for other, hits := range l.hits {
		if other != key && now.Sub(hits[len(hits)-1]) >= l.window {
			delete(l.hits, other)
		}
	}
	recent := l.hits[key][:0]
	for _, hit := range l.hits[key] {
		if now.Sub(hit) < l.window {
			recent = append(recent, hit)
		}
	}
	if len(recent) >= l.max {
		l.hits[key] = recent
		return false
	}
	l.hits[key] = append(recent, now)
	return true
}
