package metrics

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"gripello/internal/platform/db"
	"gripello/internal/platform/testkit"
)

func TestRecordedRequestsAddUpAcrossReplicas(t *testing.T) {
	pool := testkit.Pool(t)
	ctx := context.Background()
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/gyms/{gym}", func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("gym") == "broken" {
			w.WriteHeader(http.StatusInternalServerError)
		}
	})
	first, second := New(pool), New(pool)
	for _, path := range []string{"/api/gyms/north", "/api/gyms/broken", "/api/nope"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("X-Real-IP", "203.0.113.7")
		first.Middleware(mux).ServeHTTP(httptest.NewRecorder(), req)
	}
	second.Record("GET", "GET /api/gyms/{gym}", http.StatusNotFound, 30*time.Millisecond, "198.51.100.1")
	second.Record("GET", "GET /api/realtime", http.StatusOK, 10*time.Minute, "203.0.113.7")
	for _, rec := range []*Recorder{first, second} {
		if err := rec.Flush(ctx); err != nil {
			t.Fatal(err)
		}
	}

	var total, client, server, samples int64
	if err := pool.QueryRow(ctx, `SELECT total, client_errors, server_errors, b0+b1+b2+b3+b4+b5+b6+b7+b8+b9+b10 FROM request_stats WHERE method = 'GET' AND pattern = '/api/gyms/{gym}'`).
		Scan(&total, &client, &server, &samples); err != nil {
		t.Fatal(err)
	}
	if total != 3 || client != 1 || server != 1 || samples != 3 {
		t.Errorf("gym endpoint = total %d, 4xx %d, 5xx %d, samples %d", total, client, server, samples)
	}
	var unmatched, streamSamples int64
	pool.QueryRow(ctx, `SELECT total FROM request_stats WHERE pattern = 'unmatched'`).Scan(&unmatched)
	pool.QueryRow(ctx, `SELECT b0+b1+b2+b3+b4+b5+b6+b7+b8+b9+b10 FROM request_stats WHERE pattern = '/api/realtime'`).Scan(&streamSamples)
	if unmatched != 1 || streamSamples != 0 {
		t.Errorf("unmatched = %d, realtime latency samples = %d", unmatched, streamSamples)
	}
	var visitors int
	pool.QueryRow(ctx, `SELECT count(*) FROM request_visitors`).Scan(&visitors)
	if visitors != 2 {
		t.Errorf("visitors = %d, want 2 (one IP seen by both replicas)", visitors)
	}

	pool.Exec(ctx, `INSERT INTO visitor_salts (day, salt) VALUES ('2020-01-01', 'old')`)
	if err := Prune(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var salts int
	pool.QueryRow(ctx, `SELECT count(*) FROM visitor_salts`).Scan(&salts)
	if salts != 1 {
		t.Errorf("salts after prune = %d, want only today's", salts)
	}
}

func TestAFailedFlushKeepsTheCounts(t *testing.T) {
	pool := testkit.Pool(t)
	rec := New(pool)
	rec.Record("GET", "GET /api/gyms", http.StatusOK, time.Millisecond, "203.0.113.7")
	if err := rec.Flush(context.Background()); err == nil {
		t.Fatal("flush without the request_stats table succeeded")
	}
	if err := db.Migrate(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	if err := rec.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	var total int
	pool.QueryRow(context.Background(), `SELECT total FROM request_stats WHERE pattern = '/api/gyms'`).Scan(&total)
	if total != 1 {
		t.Errorf("total after retry = %d, want 1", total)
	}
}
