package authn

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"gripello/internal/platform/ids"
	"gripello/internal/platform/lockout"
)

func (f *fixture) waitForLockWaiter() {
	f.t.Helper()
	for range 500 {
		if f.count(`SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`) > 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	f.t.Fatal("no request waited for the lock")
}

// whileHeld sends the request while another transaction holds sql uncommitted, then commits it.
func (f *fixture) whileHeld(sql string, args []any, path string, body any) (int, map[string]any) {
	f.t.Helper()
	ctx := context.Background()
	tx, err := f.app.DB.Begin(ctx)
	if err != nil {
		f.t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, sql, args...); err != nil {
		f.t.Fatal(err)
	}
	type result struct {
		status int
		body   map[string]any
	}
	done := make(chan result)
	go func() {
		status, body := f.send(http.MethodPost, path, "", body)
		done <- result{status, body}
	}()
	f.waitForLockWaiter()
	if err := tx.Commit(ctx); err != nil {
		f.t.Fatal(err)
	}
	res := <-done
	return res.status, res.body
}

func TestPasswordResetTokenWorksOnceUnderConcurrency(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	id := f.user("twice@example.com")
	f.send(http.MethodPost, "/auth/password-reset/request", "", map[string]string{"email": "twice@example.com"})
	token, _ := f.lastMailToken(1)
	status, body := f.whileHeld(`UPDATE users SET token_key = 'rotated-by-the-other-confirm' WHERE id = $1`, []any{id},
		"/auth/password-reset/confirm", map[string]string{"token": token, "password": "new-password-1", "passwordConfirm": "new-password-1"})
	if status != http.StatusBadRequest || !strings.Contains(mustJSON(body), "validation_invalid_token") {
		t.Fatalf("second confirm of one token = %d %v", status, body)
	}
}

func TestEmailChangeRacingASignUpIsAFieldError(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	f.user("mover@example.com")
	f.send(http.MethodPost, "/auth/email-change/request", f.loginToken("mover@example.com"), map[string]string{"newEmail": "wanted@example.com"})
	token, _ := f.lastMailToken(1)
	status, body := f.whileHeld(`INSERT INTO users (id, email, username, token_key) VALUES ($1, 'wanted@example.com', 'wanted', 'k')`, []any{ids.New()},
		"/auth/email-change/confirm", map[string]string{"token": token, "password": testPassword})
	if status != http.StatusBadRequest || !strings.Contains(mustJSON(body), codeNotUnique) {
		t.Fatalf("confirm racing a sign-up = %d %v", status, body)
	}
}

func TestLockoutOutcomesSurviveADisconnect(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	gone, cancel := context.WithCancel(context.Background())
	cancel()
	for _, key := range []string{"released", "failed"} {
		if err := lockout.Reserve(context.Background(), f.app.DB, key); err != nil {
			t.Fatal(err)
		}
	}
	if err := lockout.Release(gone, f.app.DB, "released"); err != nil {
		t.Errorf("release after a disconnect: %v", err)
	}
	for range lockout.MaxFailures - 1 {
		lockout.Reserve(context.Background(), f.app.DB, "failed")
	}
	if locked, err := lockout.Failed(gone, f.app.DB, "failed"); err != nil || !locked {
		t.Errorf("failure after a disconnect: locked %v, %v", locked, err)
	}
	if n := f.count(`SELECT failures FROM login_lockouts WHERE key = 'released'`); n != 0 {
		t.Errorf("released attempt still counted: %d", n)
	}
}
