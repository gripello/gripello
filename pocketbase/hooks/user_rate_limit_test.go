package hooks

import (
	"testing"
	"time"
)

func TestClimberLookupsAreLimitedPerUser(t *testing.T) {
	limiter := newUserRateLimiter(2)
	now := time.Now()
	if !limiter.allow("a", now) || !limiter.allow("a", now) {
		t.Fatal("the first requests must pass")
	}
	if limiter.allow("a", now) {
		t.Fatal("a third request in the same minute must be refused")
	}
	if !limiter.allow("b", now) {
		t.Fatal("another climber on the same network keeps their own budget")
	}
	if !limiter.allow("a", now.Add(userRateWindow)) {
		t.Fatal("a new minute must reset the budget")
	}
	if _, ok := limiter.windows["b"]; ok {
		t.Fatal("expired windows must be pruned")
	}
}
