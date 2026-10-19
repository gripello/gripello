package notifications

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gripello/internal/platform/ids"
)

func TestFirstRegistrationsOfOneEndpointDoNotTakeEachOtherOver(t *testing.T) {
	f := newFixture(t, false)
	endpoint := "https://fcm.googleapis.com/fcm/send/race"
	ctx := context.Background()
	tx, err := f.app.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('push:' || $1::text, 0))`, endpoint); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO push_subscriptions (id, "user", endpoint, p256dh, auth) VALUES ($1, $2, $3, 'BKey', 'secret')`,
		ids.New(), f.users["climber"], endpoint); err != nil {
		t.Fatal(err)
	}
	done := make(chan int)
	go func() {
		request := httptest.NewRequest("POST", "/api/me/push-subscriptions", strings.NewReader(`{"endpoint":"`+endpoint+`","p256dh":"BOther","auth":"guess"}`))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", f.tokens["other"])
		recorder := httptest.NewRecorder()
		f.handler.ServeHTTP(recorder, request)
		done <- recorder.Code
	}()
	for tries := 0; f.count(`SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`) == 0; tries++ {
		if tries == 500 {
			t.Fatal("the registration did not wait for the first one")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if code := <-done; code != http.StatusConflict {
		t.Fatalf("second first registration with other keys = %d, want 409", code)
	}
}
