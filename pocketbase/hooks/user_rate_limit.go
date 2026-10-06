package hooks

import (
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

const (
	climberLookupsPerMinute = 120
	userRateWindow          = time.Minute
)

type userRateWindowCount struct {
	start time.Time
	count int
}

// PocketBase limits by IP, which a whole gym shares over its WiFi.
type userRateLimiter struct {
	sync.Mutex
	max     int
	windows map[string]userRateWindowCount
}

func newUserRateLimiter(max int) *userRateLimiter {
	return &userRateLimiter{max: max, windows: map[string]userRateWindowCount{}}
}

func (l *userRateLimiter) allow(userID string, now time.Time) bool {
	l.Lock()
	defer l.Unlock()
	window := l.windows[userID]
	if now.Sub(window.start) >= userRateWindow {
		for id, other := range l.windows {
			if now.Sub(other.start) >= userRateWindow {
				delete(l.windows, id)
			}
		}
		window = userRateWindowCount{start: now}
	}
	window.count++
	l.windows[userID] = window
	return window.count <= l.max
}

func (l *userRateLimiter) middleware() *hook.Handler[*core.RequestEvent] {
	return &hook.Handler[*core.RequestEvent]{
		Func: func(e *core.RequestEvent) error {
			if e.Auth != nil && !e.HasSuperuserAuth() && !l.allow(e.Auth.Id, time.Now()) {
				return e.TooManyRequestsError("", nil)
			}
			return e.Next()
		},
	}
}

var climberLookups = newUserRateLimiter(climberLookupsPerMinute)
