package account

import (
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"gripello/internal/platform/lockout"
)

func TestParallelDeleteMeGuessesStopAtTheLimit(t *testing.T) {
	f := newFixture(t)
	hash, _ := bcrypt.GenerateFromPassword([]byte("right-password"), bcrypt.MinCost)
	f.exec(`UPDATE users SET password_hash = $1`, string(hash))
	var wg sync.WaitGroup
	var checked atomic.Int32
	for range 3 * lockout.MaxFailures {
		wg.Go(func() {
			if f.send(f.climber, http.MethodDelete, "/me", strings.NewReader(`{"password":"wrong"}`), "application/json").Code == http.StatusBadRequest {
				checked.Add(1)
			}
		})
	}
	wg.Wait()
	if n := checked.Load(); n > lockout.MaxFailures {
		t.Errorf("%d parallel guesses were checked, limit %d", n, lockout.MaxFailures)
	}
	f.call(f.climber, http.MethodDelete, "/me", `{"password":"right-password"}`, http.StatusTooManyRequests)
}
