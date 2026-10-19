package social

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gripello/internal/platform/ids"
)

func TestFollowRacingABlockIsRefused(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	tx, err := f.app.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if err := lockPair(ctx, tx, f.users["setter"], f.users["climber"]); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO blocks (id, blocker, blocked) VALUES ($1, $2, $3)`, ids.New(), f.users["setter"], f.users["climber"]); err != nil {
		t.Fatal(err)
	}
	done := make(chan int)
	go func() {
		request := httptest.NewRequest("POST", "/api/follows", strings.NewReader(`{"followee":"`+f.users["setter"]+`"}`))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", f.tokens["climber"])
		recorder := httptest.NewRecorder()
		f.handler.ServeHTTP(recorder, request)
		done <- recorder.Code
	}()
	var code int
	select {
	case code = <-done:
	case <-time.After(500 * time.Millisecond):
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		code = <-done
	}
	if code != http.StatusBadRequest {
		t.Fatalf("follow racing a block = %d, want 400", code)
	}
}
