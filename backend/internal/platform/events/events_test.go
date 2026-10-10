package events

import (
	"context"
	"testing"
	"time"

	"gripello/internal/platform/db"
	"gripello/internal/platform/testkit"
)

func TestPublishReachesListener(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool := testkit.Pool(t)
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	bus := NewBus(pool)
	got := make(chan Event, 1)
	bus.Subscribe("gym_changes:", func(e Event) { got <- e })
	go bus.Run(ctx)
	time.Sleep(200 * time.Millisecond)

	tx, _ := pool.Begin(ctx)
	if err := Publish(ctx, tx, "gym_changes:g1", "route.created", map[string]string{"id": "r1"}, Audience{Public: true}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-got:
		t.Fatal("event delivered before commit")
	case <-time.After(300 * time.Millisecond):
	}
	tx.Commit(ctx)
	select {
	case e := <-got:
		if e.Topic != "gym_changes:g1" || !e.Audience.Public {
			t.Fatalf("got %+v", e)
		}
		since, _ := bus.Since(ctx, e.ID-1, 10)
		if len(since) != 1 || since[0].ID != e.ID {
			t.Fatalf("replay returned %+v", since)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("event not delivered")
	}
}

func TestSubscribeOnceClaimsPerHandler(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool := testkit.Pool(t)
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	first, second := NewBus(pool), NewBus(pool)
	runs := make(chan string, 4)
	for _, bus := range []*Bus{first, second} {
		bus.SubscribeOnce("audit", "audit.write", func(Event) { runs <- "once" })
		bus.Subscribe("audit", func(Event) { runs <- "each" })
		go bus.Run(ctx)
	}
	time.Sleep(200 * time.Millisecond)
	tx, _ := pool.Begin(ctx)
	Publish(ctx, tx, "audit", "x", nil, Audience{})
	tx.Commit(ctx)
	counts := map[string]int{}
	for range 3 {
		select {
		case r := <-runs:
			counts[r]++
		case <-time.After(3 * time.Second):
			t.Fatalf("waiting for handlers, got %v", counts)
		}
	}
	select {
	case r := <-runs:
		t.Fatalf("extra run %q", r)
	case <-time.After(300 * time.Millisecond):
	}
	if counts["once"] != 1 || counts["each"] != 2 {
		t.Fatalf("got %v", counts)
	}
}

func TestSlowerTransactionsEventIsNotSkipped(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool := testkit.Pool(t)
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	seed, _ := pool.Begin(ctx)
	Publish(ctx, seed, "t", "seed", nil, Audience{})
	seed.Commit(ctx)
	bus := NewBus(pool)
	got := make(chan string, 4)
	bus.Subscribe("t", func(e Event) { got <- e.Kind })
	go bus.Run(ctx)
	time.Sleep(200 * time.Millisecond)

	slow, _ := pool.Begin(ctx)
	Publish(ctx, slow, "t", "slow", nil, Audience{})
	fast, _ := pool.Begin(ctx)
	Publish(ctx, fast, "t", "fast", nil, Audience{})
	fast.Commit(ctx)
	time.Sleep(300 * time.Millisecond)
	slow.Commit(ctx)
	for _, want := range []string{"slow", "fast"} {
		select {
		case kind := <-got:
			if kind != want {
				t.Fatalf("got %q, want %q", kind, want)
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("%s not delivered", want)
		}
	}

	rolledBack, _ := pool.Begin(ctx)
	Publish(ctx, rolledBack, "t", "rolled back", nil, Audience{})
	rolledBack.Rollback(ctx)
	after, _ := pool.Begin(ctx)
	Publish(ctx, after, "t", "after gap", nil, Audience{})
	after.Commit(ctx)
	select {
	case kind := <-got:
		if kind != "after gap" {
			t.Fatalf("got %q", kind)
		}
	case <-time.After(gapGrace + 3*time.Second):
		t.Fatal("event behind a permanent gap not delivered")
	}
}

func TestSlowHandlerDoesNotStallOthers(t *testing.T) {
	bus := NewBus(nil)
	release := make(chan struct{})
	defer close(release)
	fast := make(chan struct{}, 1)
	bus.Subscribe("", func(Event) { <-release })
	bus.Subscribe("", func(Event) { fast <- struct{}{} })
	bus.dispatch(Event{ID: 1, Topic: "t"})
	select {
	case <-fast:
	case <-time.After(time.Second):
		t.Fatal("a blocked handler stalled dispatch to the others")
	}
}

func TestFailedOnceHandlerReleasesItsClaimAndRetries(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool := testkit.Pool(t)
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	onceRetryDelay = time.Millisecond
	bus := NewBus(pool)
	runs := make(chan int, 4)
	attempts := 0
	bus.SubscribeOnce("audit", "audit.write", func(Event) {
		attempts++
		runs <- attempts
		if attempts == 1 {
			panic("first attempt fails")
		}
	})
	go bus.Run(ctx)
	time.Sleep(200 * time.Millisecond)
	tx, _ := pool.Begin(ctx)
	Publish(ctx, tx, "audit", "x", nil, Audience{})
	tx.Commit(ctx)
	for want := 1; want <= 2; want++ {
		select {
		case got := <-runs:
			if got != want {
				t.Fatalf("attempt %d, want %d", got, want)
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("attempt %d did not run", want)
		}
	}
	var claims int
	pool.QueryRow(ctx, `SELECT count(*) FROM event_claims WHERE handler = 'audit.write'`).Scan(&claims)
	if claims != 1 {
		t.Fatalf("%d claims after the retry succeeded", claims)
	}
}
