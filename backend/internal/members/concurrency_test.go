package members

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAcceptingARevokedLinkDuringAResendFails(t *testing.T) {
	f := newFixture(t)
	token := f.invite(f.adminA, f.gymA, "resent@example.com", f.setterRoleA)
	ctx := context.Background()
	tx, err := f.app.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE invites SET token_hash = 'resent' WHERE email = 'resent@example.com'`); err != nil {
		t.Fatal(err)
	}
	done := make(chan int)
	go func() {
		request := httptest.NewRequest(http.MethodPost, "/api/invites/"+token+"/accept", strings.NewReader(`{"password":"1234567890","passwordConfirm":"1234567890"}`))
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		f.handler.ServeHTTP(recorder, request)
		done <- recorder.Code
	}()
	for tries := 0; f.count(`SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`) == 0; tries++ {
		if tries == 500 {
			t.Fatal("the accept did not wait for the resend")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if code := <-done; code != http.StatusNotFound {
		t.Fatalf("accepting the replaced link = %d, want 404", code)
	}
}
