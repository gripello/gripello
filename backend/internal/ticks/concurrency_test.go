package ticks

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func (f *fixture) waitForLockWaiter() {
	f.t.Helper()
	for range 500 {
		if f.exec(`SELECT COUNT(*)::text FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`) != "0" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	f.t.Fatal("no request waited for the lock")
}

func TestTickEditKeepsAConcurrentDateChange(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	route := f.boulder(f.hallA, "6A", 15.7)
	tick := f.tick("climber", route, "top", time.Now())
	ctx := context.Background()
	tx, err := f.app.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE ticks SET date = '2026-01-01T12:00:00Z' WHERE id = $1`, tick.ID); err != nil {
		t.Fatal(err)
	}
	done := make(chan string)
	go func() {
		request := httptest.NewRequest("PATCH", "/api/ticks/"+tick.ID, strings.NewReader(`{"note":"later"}`))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", f.tokens["climber"])
		recorder := httptest.NewRecorder()
		f.handler.ServeHTTP(recorder, request)
		done <- recorder.Body.String()
	}()
	f.waitForLockWaiter()
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var updated Tick
	if body := <-done; json.Unmarshal([]byte(body), &updated) != nil || updated.Note != "later" ||
		!updated.Date.Equal(time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)) {
		t.Fatalf("edit undid the concurrent date change: %s", body)
	}
	changed := f.outbox(TopicTickChanged)
	var last TickChanged
	json.Unmarshal(changed[len(changed)-1].Payload, &last)
	if !last.Date.Equal(updated.Date) {
		t.Fatalf("tick.changed names %v, want the stored day", last.Date)
	}
}

func TestTickDeleteNamesTheDayItHadMeanwhile(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	route := f.boulder(f.hallA, "6A", 15.7)
	tick := f.tick("climber", route, "top", time.Now())
	ctx := context.Background()
	tx, err := f.app.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE ticks SET date = '2026-01-01T12:00:00Z' WHERE id = $1`, tick.ID); err != nil {
		t.Fatal(err)
	}
	done := make(chan int)
	go func() {
		request := httptest.NewRequest("DELETE", "/api/ticks/"+tick.ID, nil)
		request.Header.Set("Authorization", f.tokens["climber"])
		recorder := httptest.NewRecorder()
		f.handler.ServeHTTP(recorder, request)
		done <- recorder.Code
	}()
	f.waitForLockWaiter()
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if code := <-done; code != 204 {
		t.Fatalf("delete = %d", code)
	}
	changed := f.outbox(TopicTickChanged)
	var last TickChanged
	json.Unmarshal(changed[len(changed)-1].Payload, &last)
	if !last.Date.Equal(time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)) {
		t.Fatalf("tick.changed names %v, want the day the tick had when deleted", last.Date)
	}
}
