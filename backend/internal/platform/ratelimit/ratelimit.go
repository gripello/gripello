package ratelimit

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"gripello/internal/platform/httpx"
)

type window struct {
	start time.Time
	count int
}

// ponytail: per-replica fixed window, so N replicas allow N×max; move to a Postgres counter if that matters.
type Limiter struct {
	mu      sync.Mutex
	max     int
	window  time.Duration
	windows map[string]window
}

func New(max int, per time.Duration) *Limiter {
	return &Limiter{max: max, window: per, windows: map[string]window{}}
}

func (l *Limiter) Allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	current := l.windows[key]
	if now.Sub(current.start) >= l.window {
		for id, other := range l.windows {
			if now.Sub(other.start) >= l.window {
				delete(l.windows, id)
			}
		}
		current = window{start: now}
	}
	current.count++
	l.windows[key] = current
	return current.count <= l.max
}

// Check answers 429 with Retry-After once key is over its limit.
func (l *Limiter) Check(w http.ResponseWriter, key string) error {
	if l.Allow(key, time.Now()) {
		return nil
	}
	w.Header().Set("Retry-After", strconv.Itoa(int(l.window.Seconds())))
	return httpx.NewError(http.StatusTooManyRequests, "Too many requests.")
}
