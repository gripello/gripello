package gyms

import (
	"context"
	"net/http"
	"testing"
	"time"

	"gripello/internal/platform/ids"
)

func (f *fixture) waitForLockWaiter() {
	f.t.Helper()
	for range 500 {
		var waiting int
		f.scalar(`SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`, &waiting)
		if waiting > 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	f.t.Fatal("no request waited for the lock")
}

func TestDeleteGymWaitsForAConcurrentInsert(t *testing.T) {
	f := newFixture(t)
	gym := f.createGym("racing", "Racing", true)
	hall := ids.New()
	f.exec(`INSERT INTO locations (id, gym, name) VALUES ($1, $2, 'Hall')`, hall, gym)
	ctx := context.Background()
	tx, err := f.app.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO routes (id, gym, name, grade, location) VALUES ($1, $2, 'Late', '6a', $3)`, ids.New(), gym, hall); err != nil {
		t.Fatal(err)
	}
	done := make(chan response)
	go func() { done <- f.send(f.operator, "DELETE", "/gyms/"+gym, nil, "") }()
	f.waitForLockWaiter()
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if res := <-done; res.Status != http.StatusNoContent {
		t.Fatalf("delete racing an insert = %d: %s", res.Status, res.Body)
	}
}

func TestDeleteGymAndAnEntryEditDoNotDeadlock(t *testing.T) {
	f := newFixture(t)
	gym := f.createGym("contest", "Contest", true)
	hall, competition, category, entry := ids.New(), ids.New(), ids.New(), ids.New()
	f.exec(`INSERT INTO locations (id, gym, name) VALUES ($1, $2, 'Hall')`, hall, gym)
	f.exec(`INSERT INTO competitions (id, gym, name, location, status, starts_at, ends_at, scoring_format, discipline)
		VALUES ($1, $2, 'Jam', $3, 'open', now(), now() + interval '1 hour', 'tops', 'boulder')`, competition, gym, hall)
	f.exec(`INSERT INTO competition_categories (id, competition, name) VALUES ($1, $2, 'Open')`, category, competition)
	f.exec(`INSERT INTO competition_entries (id, competition, "user", category, display_name, birth_year, status) VALUES ($1, $2, $3, $4, 'C', 1990, 'registered')`,
		entry, competition, f.user("climber"), category)
	ctx := context.Background()
	tx, err := f.app.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT 1 FROM competitions WHERE id = $1 FOR SHARE`, competition); err != nil {
		t.Fatal(err)
	}
	done := make(chan response)
	go func() { done <- f.send(f.operator, "DELETE", "/gyms/"+gym, nil, "") }()
	f.waitForLockWaiter()
	if _, err := tx.Exec(ctx, `SELECT 1 FROM competition_entries WHERE id = $1 FOR UPDATE`, entry); err != nil {
		t.Fatalf("the entry edit deadlocked with the gym delete: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if res := <-done; res.Status != http.StatusNoContent {
		t.Fatalf("delete gym = %d: %s", res.Status, res.Body)
	}
}
