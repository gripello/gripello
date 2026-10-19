package routes

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform/ids"
)

func waitForLockWaiter(t *testing.T, db *pgxpool.Pool) {
	t.Helper()
	for range 500 {
		var waiting int
		if err := db.QueryRow(context.Background(), `SELECT COUNT(*) FROM pg_stat_activity
			WHERE datname = current_database() AND wait_event_type = 'Lock'`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting > 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("no request waited for the lock")
}

func TestRouteEditKeepsAConcurrentArchive(t *testing.T) {
	f := newFixture(t)
	id := f.route("")
	ctx := context.Background()
	tx, err := f.app.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE routes SET archived = true, archived_at = now() WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	done := make(chan map[string]any)
	go func() {
		_, route, _ := f.do("setter", "PATCH", "/routes/"+id, `{"name":"Renamed"}`)
		done <- route
	}()
	waitForLockWaiter(t, f.app.DB)
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if route := <-done; route["archived"] != true || route["name"] != "Renamed" {
		t.Fatalf("edit undid the concurrent archive: %v", route)
	}
}

func TestDeleteLocationRacingARouteInsertIsRefused(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	tx, err := f.app.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO routes (id, gym, name, grade, location) VALUES ($1, $2, 'Late', '6a', $3)`,
		ids.New(), f.gymA, f.hallB); err != nil {
		t.Fatal(err)
	}
	done := make(chan int)
	go func() {
		code, _, _ := f.do("admin", "DELETE", "/locations/"+f.hallB, "")
		done <- code
	}()
	waitForLockWaiter(t, f.app.DB)
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if code := <-done; code != http.StatusBadRequest {
		t.Fatalf("delete racing a route insert = %d, want 400", code)
	}
}

type response struct {
	code int
	body map[string]any
}

func (f *fixture) async(user, method, path, body string) <-chan response {
	done := make(chan response, 1)
	go func() {
		code, out, _ := f.do(user, method, path, body)
		done <- response{code, out}
	}()
	return done
}

func (f *fixture) held(sql string, args ...any) pgx.Tx {
	f.t.Helper()
	ctx := context.Background()
	tx, err := f.app.DB.Begin(ctx)
	if err != nil {
		f.t.Fatal(err)
	}
	f.t.Cleanup(func() { tx.Rollback(ctx) })
	if _, err := tx.Exec(ctx, sql, args...); err != nil {
		f.t.Fatal(err)
	}
	return tx
}

func TestWallEditKeepsAConcurrentChange(t *testing.T) {
	f := newFixture(t)
	wall := f.wall(f.hall, "Slab")
	tx := f.held(`UPDATE walls SET sort = 7 WHERE id = $1`, wall)
	done := f.async("admin", "PATCH", "/walls/"+wall, `{"name":"Roof"}`)
	waitForLockWaiter(t, f.app.DB)
	if err := tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	if res := <-done; res.body["sort"] != 7.0 || res.body["name"] != "Roof" {
		t.Fatalf("wall edit undid the concurrent change: %d %v", res.code, res.body)
	}
}

func TestRemovingATraceDeletesTheFileStoredMeanwhile(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	if err := f.app.Blob.Put(ctx, traceKey(f.hall, "late.png"), strings.NewReader("png")); err != nil {
		t.Fatal(err)
	}
	tx := f.held(`UPDATE locations SET map_trace = 'late.png' WHERE id = $1`, f.hall)
	done := f.async("admin", "DELETE", "/locations/"+f.hall+"/map-trace", "")
	waitForLockWaiter(t, f.app.DB)
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if res := <-done; res.code != http.StatusOK {
		t.Fatalf("delete trace = %d %v", res.code, res.body)
	}
	if file, err := f.app.Blob.Open(ctx, traceKey(f.hall, "late.png")); err == nil {
		file.Close()
		t.Fatal("the trace stored meanwhile was left behind")
	}
}

func TestBatchesLockRoutesInIDOrder(t *testing.T) {
	f := newFixture(t)
	low, high := f.route(""), f.route("")
	if low > high {
		low, high = high, low
	}
	tx := f.held(`SELECT 1 FROM routes WHERE id = $1 FOR UPDATE`, low)
	done := f.async("setter", "POST", "/gyms/"+f.gymA+"/routes/archive", `{"ids":["`+high+`","`+low+`"],"archived":true}`)
	waitForLockWaiter(t, f.app.DB)
	if _, err := tx.Exec(context.Background(), `SELECT 1 FROM routes WHERE id = $1 FOR UPDATE`, high); err != nil {
		t.Fatalf("the batch held a route out of order: %v", err)
	}
	if err := tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	if res := <-done; res.code != http.StatusOK {
		t.Fatalf("archive batch = %d %v", res.code, res.body)
	}
}

// answersWhile fails when the request waits for an uncommitted child insert of the row it edits.
func (f *fixture) answersWhile(sql string, args []any, user, method, path, body string) {
	f.t.Helper()
	tx := f.held(sql, args...)
	select {
	case res := <-f.async(user, method, path, body):
		if res.code != http.StatusOK {
			f.t.Fatalf("%s %s = %d %v", method, path, res.code, res.body)
		}
	case <-time.After(3 * time.Second):
		tx.Rollback(context.Background())
		f.t.Fatalf("%s %s waited for an unrelated insert", method, path)
	}
}

func TestEditsDoNotWaitForChildInserts(t *testing.T) {
	f := newFixture(t)
	route := f.route("")
	wall := f.wall(f.hall, "Slab")
	f.answersWhile(`INSERT INTO ratings (id, gym, route_id, rating) VALUES ($1, $2, $3, 4)`, []any{ids.New(), f.gymA, route},
		"setter", "PATCH", "/routes/"+route, `{"name":"Renamed"}`)
	f.answersWhile(`INSERT INTO routes (id, gym, name, grade, location, wall) VALUES ($1, $2, 'New', '6a', $3, $4)`, []any{ids.New(), f.gymA, f.hall, wall},
		"admin", "PATCH", "/locations/"+f.hall, `{"name":"Main hall"}`)
	f.answersWhile(`INSERT INTO routes (id, gym, name, grade, location, wall) VALUES ($1, $2, 'New', '6a', $3, $4)`, []any{ids.New(), f.gymA, f.hall, wall},
		"admin", "PATCH", "/walls/"+wall, `{"name":"Roof"}`)
}

func TestDeleteRouteRacingAReviewNeedsForce(t *testing.T) {
	f := newFixture(t)
	route := f.route("")
	tx := f.held(`INSERT INTO ratings (id, gym, route_id, rating) VALUES ($1, $2, $3, 4)`, ids.New(), f.gymA, route)
	done := f.async("setter", "DELETE", "/routes/"+route, "")
	waitForLockWaiter(t, f.app.DB)
	if err := tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	if res := <-done; res.code != http.StatusConflict {
		t.Fatalf("delete racing a review = %d, want 409", res.code)
	}
}

func TestDeleteWallRacingARouteMoveIsRefused(t *testing.T) {
	f := newFixture(t)
	wall := f.wall(f.hall, "Slab")
	route := f.route("")
	tx := f.held(`UPDATE routes SET wall = $2 WHERE id = $1`, route, wall)
	done := f.async("admin", "DELETE", "/walls/"+wall, "")
	waitForLockWaiter(t, f.app.DB)
	if err := tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	if res := <-done; res.code != http.StatusBadRequest {
		t.Fatalf("wall delete racing a route move = %d, want 400", res.code)
	}
}

func TestWallMoveLocksItsRoutesBeforeTheWall(t *testing.T) {
	f := newFixture(t)
	wall := f.wall(f.hall, "Slab")
	other := f.exec(`INSERT INTO locations (id, gym, name, map) VALUES ($1, $2, 'Side room', $3) RETURNING id`, ids.New(), f.gymA, floorPlanJSON)
	route := f.exec(`INSERT INTO routes (id, gym, name, grade, location, wall) VALUES ($1, $2, 'On wall', '6a', $3, $4) RETURNING id`, ids.New(), f.gymA, f.hall, wall)
	tx := f.held(`SELECT 1 FROM routes WHERE id = $1 FOR NO KEY UPDATE`, route)
	done := f.async("admin", "PATCH", "/walls/"+wall, `{"location":"`+other+`"}`)
	waitForLockWaiter(t, f.app.DB)
	if _, err := tx.Exec(context.Background(), `SELECT 1 FROM walls WHERE id = $1 FOR UPDATE`, wall); err != nil {
		t.Fatalf("the wall move held the wall before its routes: %v", err)
	}
	if err := tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	if res := <-done; res.code != http.StatusOK {
		t.Fatalf("wall move = %d %v", res.code, res.body)
	}
}
