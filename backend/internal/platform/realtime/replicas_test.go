package realtime

import (
	"bufio"
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform/db"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/testkit"
)

func publishPublic(t *testing.T, pool *pgxpool.Pool, topic string) int64 {
	t.Helper()
	ctx := context.Background()
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		return events.Publish(ctx, tx, topic, "test", map[string]string{}, events.Audience{Public: true})
	})
	if err != nil {
		t.Fatal(err)
	}
	var id int64
	pool.QueryRow(ctx, `SELECT max(id) FROM events`).Scan(&id)
	return id
}

func TestSubscriptionsReachTheStreamOnAnotherReplica(t *testing.T) {
	pool := testkit.Pool(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	busA, busB := events.NewBus(pool), events.NewBus(pool)
	hubA, hubB := NewHub(busA, fakePerms{}), NewHub(busB, fakePerms{})
	go busA.Run(ctx)
	go busB.Run(ctx)

	before := publishPublic(t, pool, "gym:x")
	missed := publishPublic(t, pool, "gym:x")
	streams := httptest.NewServer(httpx.Handler(hubA.Connect))
	t.Cleanup(streams.Close)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, streams.URL, nil)
	req.Header.Set("Last-Event-ID", strconv.FormatInt(before, 10))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	var mu sync.Mutex
	var clientID string
	var received []string
	go func() {
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			line := scanner.Text()
			mu.Lock()
			if rest, ok := strings.CutPrefix(line, `data:{"clientId":"`); ok {
				clientID = strings.TrimSuffix(rest, `"}`)
			}
			if id, ok := strings.CutPrefix(line, "id:"); ok {
				received = append(received, id)
			}
			mu.Unlock()
		}
	}()
	read := func() (string, []string) {
		mu.Lock()
		defer mu.Unlock()
		return clientID, append([]string(nil), received...)
	}
	waitFor(t, func() bool { id, _ := read(); return id != "" })

	id, _ := read()
	mux := http.NewServeMux()
	mux.Handle("PUT /realtime/{clientId}/subscriptions", httpx.Handler(hubB.Subscriptions))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/realtime/"+id+"/subscriptions", bytes.NewBufferString(`{"topics":["gym:x"]}`)))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("subscribe on the other replica = %d %s", rec.Code, rec.Body)
	}
	live := publishPublic(t, pool, "gym:x")

	want := []string{strconv.FormatInt(missed, 10), strconv.FormatInt(live, 10)}
	waitFor(t, func() bool { _, got := read(); return len(got) >= 2 })
	if _, got := read(); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("stream ids = %v, want %v (replayed once, then live)", got, want)
	}
	if hubB.Clients() != 0 || hubA.Clients() != 1 {
		t.Fatalf("clients A=%d B=%d", hubA.Clients(), hubB.Clients())
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		if cond() {
			return
		}
	}
	t.Fatal("condition not met within 5s")
}
