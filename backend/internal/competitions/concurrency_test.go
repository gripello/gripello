package competitions

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gripello/internal/platform/events"
	"gripello/internal/platform/ids"
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

func (f *fixture) whileStatusChanges(competition, status, user, method, path, body string) int {
	f.t.Helper()
	return f.whileHeld(`UPDATE competitions SET status = $2 WHERE id = $1`, []any{competition, status}, user, method, path, body)
}

// whileHeld sends the request while another transaction holds sql uncommitted, then commits it.
func (f *fixture) whileHeld(sql string, args []any, user, method, path, body string) int {
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
	done := make(chan int)
	go func() {
		request := httptest.NewRequest(method, "/api"+path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", f.tokens[user])
		recorder := httptest.NewRecorder()
		f.handler.ServeHTTP(recorder, request)
		done <- recorder.Code
	}()
	f.waitForLockWaiter()
	if err := tx.Commit(ctx); err != nil {
		f.t.Fatal(err)
	}
	return <-done
}

func TestScoresDoNotLandAfterAConcurrentPublish(t *testing.T) {
	f := newFixture(t)
	id, category, route1, _ := f.competition("")
	entry := f.register("climber", id, category, "")
	score := `{"scores":[{"entry":"` + entry + `","comp_route":"` + route1 + `","top_attempt":1}]}`
	if code := f.whileStatusChanges(id, "published", "judge", "PUT", "/competitions/"+id+"/scores", score); code != http.StatusBadRequest {
		t.Fatalf("score during publish = %d, want 400", code)
	}
}

func TestConcurrentPublishCopiesResultsOnce(t *testing.T) {
	f := newFixture(t)
	id, category, route1, _ := f.competition("")
	entry := f.register("climber", id, category, "")
	f.call("judge", "PUT", "/competitions/"+id+"/scores", `{"scores":[{"entry":"`+entry+`","comp_route":"`+route1+`","top_attempt":1}]}`, http.StatusOK)
	if code := f.whileStatusChanges(id, "published", "manager", "POST", "/competitions/"+id+"/publish", ""); code != http.StatusOK {
		t.Fatalf("publish = %d", code)
	}
	if notes := f.events(events.TopicNotify); len(notes) != 0 {
		t.Fatalf("an already published competition notified again: %v", notes)
	}
}

func TestRegistrationClosingConcurrentlyRefusesTheEntry(t *testing.T) {
	f := newFixture(t)
	id, category, _, _ := f.competition("")
	body := `{"category":"` + category + `","display_name":"climber","birth_year":1990}`
	if code := f.whileStatusChanges(id, "closed", "climber", "POST", "/competitions/"+id+"/entries", body); code != http.StatusBadRequest {
		t.Fatalf("entry while registration closes = %d, want 400", code)
	}
}

func TestEntryCategoryChangeWhileRegistrationClosesIsRefused(t *testing.T) {
	f := newFixture(t)
	id, category, _, _ := f.competition("")
	entry := f.register("climber", id, category, "")
	other := f.call("manager", "POST", "/competitions/"+id+"/categories", `{"name":"Masters"}`, http.StatusCreated)["id"].(string)
	if code := f.whileStatusChanges(id, "closed", "climber", "PATCH", "/competition-entries/"+entry, `{"category":"`+other+`"}`); code != http.StatusBadRequest {
		t.Fatalf("category change while registration closes = %d, want 400", code)
	}
}

func TestCompetitionWritesDoNotWaitForChildInserts(t *testing.T) {
	f := newFixture(t)
	id, category, _, _ := f.competition("")
	for _, request := range []struct{ user, method, path, body string }{
		{"manager", "PATCH", "/competitions/" + id, `{"name":"Renamed"}`},
		{"climber", "POST", "/competitions/" + id + "/entries", `{"category":"` + category + `","display_name":"climber","birth_year":1990}`},
	} {
		ctx := context.Background()
		tx, err := f.app.DB.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO competition_categories (id, competition, name) VALUES ($1, $2, 'Late')`, ids.New(), id); err != nil {
			t.Fatal(err)
		}
		done := make(chan int, 1)
		go func() {
			r := httptest.NewRequest(request.method, "/api"+request.path, strings.NewReader(request.body))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("Authorization", f.tokens[request.user])
			recorder := httptest.NewRecorder()
			f.handler.ServeHTTP(recorder, r)
			done <- recorder.Code
		}()
		select {
		case code := <-done:
			if code >= 300 {
				t.Errorf("%s %s = %d", request.method, request.path, code)
			}
		case <-time.After(3 * time.Second):
			t.Errorf("%s %s waited for a category insert", request.method, request.path)
			tx.Rollback(ctx)
			<-done
		}
		tx.Rollback(ctx)
	}
}
