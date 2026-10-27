package realtime

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/testkit"
)

func TestSubscriptionsRefuseJunkBeforeWritingTheOutbox(t *testing.T) {
	pool := testkit.Pool(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	bus := events.NewBus(pool)
	h := NewHub(bus, fakePerms{})
	bus.Start(ctx)
	mux := http.NewServeMux()
	mux.Handle("PUT /realtime/{clientId}/subscriptions", httpx.Handler(h.Subscriptions))
	put := func(client, body string) int {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/realtime/"+client+"/subscriptions", bytes.NewBufferString(body)))
		return rec.Code
	}
	var before int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM events WHERE topic = $1`, subscriptionTopic).Scan(&before); err != nil {
		t.Fatal(err)
	}
	tooMany := `{"topics":["` + strings.Repeat(`a","`, MaxTopics) + `a"]}`
	for name, tc := range map[string]struct {
		client, body string
		want         int
	}{
		"bad client id": {"x", `{"topics":["gym:x"]}`, http.StatusNotFound},
		"too many":      {ids.New(), tooMany, http.StatusBadRequest},
		"too long":      {ids.New(), `{"topics":["` + strings.Repeat("t", maxTopicLength+1) + `"]}`, http.StatusBadRequest},
		"empty topic":   {ids.New(), `{"topics":[""]}`, http.StatusBadRequest},
	} {
		if got := put(tc.client, tc.body); got != tc.want {
			t.Errorf("%s: status = %d, want %d", name, got, tc.want)
		}
	}
	var after int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM events WHERE topic = $1`, subscriptionTopic).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if after != before {
		t.Fatalf("refused subscriptions wrote %d events rows", after-before)
	}
	if got := put(ids.New(), `{"topics":["gym:x"]}`); got != http.StatusNoContent {
		t.Fatalf("valid subscription = %d", got)
	}
}
