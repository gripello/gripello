package events

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"gripello/internal/platform/testkit"
)

func TestPublishReachesListener(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool := testkit.Pool(t)
	bus := NewBus(pool)
	got := make(chan Event, 1)
	bus.Subscribe("gym_changes:", func(e Event) { got <- e })
	bus.Start(ctx)
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
		since, _, _ := bus.Since(ctx, e.ID-1, []string{e.Topic}, 10)
		if len(since) != 1 || since[0].ID != e.ID {
			t.Fatalf("replay returned %+v", since)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("event not delivered")
	}
}

func TestStartDeliversEventsPublishedRightAfter(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool := testkit.Pool(t)
	bus := NewBus(pool)
	got := make(chan Event, 1)
	bus.Subscribe("gym_changes:", func(e Event) { got <- e })
	bus.Start(ctx)

	tx, _ := pool.Begin(ctx)
	if err := Publish(ctx, tx, "gym_changes:g1", "route.created", map[string]string{"id": "r1"}, Audience{}); err != nil {
		t.Fatal(err)
	}
	tx.Commit(ctx)
	select {
	case <-got:
	case <-time.After(3 * time.Second):
		t.Fatal("event published right after Start was skipped")
	}
}

func TestSubscribeOnceClaimsPerHandler(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool := testkit.Pool(t)
	first, second := NewBus(pool), NewBus(pool)
	runs := make(chan string, 4)
	for _, bus := range []*Bus{first, second} {
		bus.SubscribeOnce("audit", "audit.write", func(Event) { runs <- "once" })
		bus.Subscribe("audit", func(Event) { runs <- "each" })
		bus.Start(ctx)
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
	seed, _ := pool.Begin(ctx)
	Publish(ctx, seed, "t", "seed", nil, Audience{})
	seed.Commit(ctx)
	bus := NewBus(pool)
	got := make(chan string, 4)
	bus.Subscribe("t", func(e Event) { got <- e.Kind })
	bus.Start(ctx)
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
	bus.Start(ctx)
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

func sweepOften(t *testing.T) {
	every, age := onceSweepEvery, onceSweepMinAge
	onceSweepEvery, onceSweepMinAge = 50*time.Millisecond, 0
	t.Cleanup(func() { onceSweepEvery, onceSweepMinAge = every, age })
}

func TestOnceHandlerGetsEventsCommittedWhileNoBusRan(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool := testkit.Pool(t)
	sweepOften(t)
	tx, _ := pool.Begin(ctx)
	Publish(ctx, tx, "audit", "while down", nil, Audience{})
	tx.Commit(ctx)

	bus := NewBus(pool)
	runs := make(chan string, 4)
	bus.SubscribeOnce("audit", "audit.write", func(e Event) { runs <- "once " + e.Kind })
	bus.Subscribe("audit", func(e Event) { runs <- "each " + e.Kind })
	bus.Start(ctx)
	select {
	case r := <-runs:
		if r != "once while down" {
			t.Fatalf("got %q", r)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("missed event not replayed to the once handler")
	}
	select {
	case r := <-runs:
		t.Fatalf("extra run %q", r)
	case <-time.After(300 * time.Millisecond):
	}
}

func TestOnceHandlerGetsEventSkippedBehindAGap(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool := testkit.Pool(t)
	sweepOften(t)
	seed, _ := pool.Begin(ctx)
	Publish(ctx, seed, "t", "seed", nil, Audience{})
	seed.Commit(ctx)
	bus := NewBus(pool)
	once := make(chan string, 4)
	bus.SubscribeOnce("t", "t.once", func(e Event) { once <- e.Kind })
	bus.Start(ctx)
	if kind := receive(t, once); kind != "seed" {
		t.Fatalf("got %q", kind)
	}

	slow, _ := pool.Begin(ctx)
	Publish(ctx, slow, "t", "slow", nil, Audience{})
	fast, _ := pool.Begin(ctx)
	Publish(ctx, fast, "t", "fast", nil, Audience{})
	fast.Commit(ctx)
	if kind := receive(t, once); kind != "fast" {
		t.Fatalf("got %q", kind)
	}
	slow.Commit(ctx)
	select {
	case kind := <-once:
		if kind != "slow" {
			t.Fatalf("got %q", kind)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("event committed after its gap closed never reached the once handler")
	}
}

func TestSweepReadsOnlyIdsPastTheCursorUntilAFullPass(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool := testkit.Pool(t)
	sweepOften(t)
	bus := NewBus(pool)
	once := make(chan string, 4)
	bus.SubscribeOnce("audit", "audit.write", func(e Event) { once <- e.Kind })
	expect := func(want string) {
		t.Helper()
		select {
		case kind := <-once:
			if kind != want {
				t.Fatalf("got %q, want %q", kind, want)
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("%s not delivered", want)
		}
	}
	publish := func(kind string) {
		tx, _ := pool.Begin(ctx)
		Publish(ctx, tx, "audit", kind, nil, Audience{})
		tx.Commit(ctx)
	}
	var lateID int64
	pool.QueryRow(ctx, `SELECT nextval('events_id_seq')`).Scan(&lateID)
	publish("first")
	cursors := map[chan Event]int64{}
	bus.sweepOnces(ctx, cursors, onceSweepMinAge)
	expect("first")

	pool.Exec(ctx, `INSERT INTO events (id, topic, kind, payload) VALUES ($1, 'audit', 'late', 'null')`, lateID)
	publish("second")
	bus.sweepOnces(ctx, cursors, onceSweepMinAge)
	expect("second")
	select {
	case kind := <-once:
		t.Fatalf("steady-state sweep read %q below its cursor", kind)
	case <-time.After(300 * time.Millisecond):
	}

	bus.sweepOnces(ctx, map[chan Event]int64{}, onceSweepMinAge)
	expect("late")
}

func TestFullPassDeliversAnEventWhoseRetriesAllFailed(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool := testkit.Pool(t)
	sweepOften(t)
	retryDelay, fullEvery := onceRetryDelay, onceFullSweepEvery
	onceRetryDelay, onceFullSweepEvery = time.Millisecond, 500*time.Millisecond
	t.Cleanup(func() { onceRetryDelay, onceFullSweepEvery = retryDelay, fullEvery })
	bus := NewBus(pool)
	var failing atomic.Bool
	failing.Store(true)
	attempts := make(chan struct{}, 8)
	delivered := make(chan struct{}, 1)
	bus.SubscribeOnce("audit", "audit.write", func(Event) {
		if failing.Load() {
			attempts <- struct{}{}
			panic("handler keeps failing")
		}
		delivered <- struct{}{}
	})
	bus.Start(ctx)
	time.Sleep(200 * time.Millisecond)
	tx, _ := pool.Begin(ctx)
	Publish(ctx, tx, "audit", "x", nil, Audience{})
	tx.Commit(ctx)
	for range 3 {
		select {
		case <-attempts:
		case <-time.After(3 * time.Second):
			t.Fatal("handler not attempted three times")
		}
	}
	failing.Store(false)
	select {
	case <-delivered:
	case <-time.After(3 * time.Second):
		t.Fatal("event whose retries failed never redelivered")
	}
}

func TestTopicPrefixRangeMatchesStartsWith(t *testing.T) {
	ctx := context.Background()
	pool := testkit.Pool(t)
	topics := []string{"", "a", "audit", "audit_x", "auditx", "audiu", "gym_changes:g1", "gym:g1", "gymXchanges:g1",
		"gym%changes", "user:ü", "user:" + "\U0010FFFE", "tasks", "tasks:1", "z", "~"}
	for _, prefix := range []string{"", "audit", "gym_changes:", "gym%", "user:", "tasks", "~", "ü"} {
		var mismatches []string
		err := pool.QueryRow(ctx, `SELECT coalesce(array_agg(topic), '{}') FROM unnest($2::text[]) AS topic
			WHERE (`+topicHasPrefix+`) IS DISTINCT FROM starts_with(topic, $1)`, prefix, topics).Scan(&mismatches)
		if err != nil {
			t.Fatal(err)
		}
		if len(mismatches) > 0 {
			t.Errorf("prefix %q: range and starts_with disagree on %q", prefix, mismatches)
		}
	}
}

func receive(t *testing.T, kinds <-chan string) string {
	t.Helper()
	select {
	case kind := <-kinds:
		return kind
	case <-time.After(5 * time.Second):
		t.Fatal("no event reached the handler")
		return ""
	}
}

func TestLagIgnoresTheOutboxBeforeTheBusStarts(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool := testkit.Pool(t)
	pool.Exec(ctx, `INSERT INTO events (topic, kind, payload, audience, created) VALUES ('gym:g1', 'old', '{}', '{}', now() - interval '30 minutes')`)
	bus := NewBus(pool)
	if lag, err := bus.Lag(ctx); err != nil || lag != 0 {
		t.Fatalf("lag before Run = %v, %v; the outbox history is not a backlog", lag, err)
	}
	bus.Start(ctx)
	deadline := time.Now().Add(3 * time.Second)
	for !bus.started.Load() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if lag, err := bus.Lag(ctx); err != nil || lag != 0 {
		t.Errorf("lag after Run = %v, %v", lag, err)
	}
	bus.delivered.Store(0)
	if lag, _ := bus.Lag(ctx); lag < 29*time.Minute {
		t.Errorf("an undelivered 30-minute-old event shows lag %v", lag)
	}
}

func TestEventCommittedAfterTheGapGraceStillReachesPlainHandlers(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool := testkit.Pool(t)
	bus := NewBus(pool)
	got := make(chan string, 4)
	bus.Subscribe("t", func(e Event) { got <- e.Kind })
	bus.Start(ctx)

	slow, _ := pool.Begin(ctx)
	Publish(ctx, slow, "t", "slow", nil, Audience{})
	fast, _ := pool.Begin(ctx)
	Publish(ctx, fast, "t", "fast", nil, Audience{})
	fast.Commit(ctx)
	if kind := receive(t, got); kind != "fast" {
		t.Fatalf("got %q", kind)
	}
	slow.Commit(ctx)
	if kind := receive(t, got); kind != "slow" {
		t.Fatalf("got %q, want the late event", kind)
	}
}

func TestStartOnAnEmptyOutboxReadsTheHeadFromTheSequence(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool := testkit.Pool(t)
	var id int64
	pool.QueryRow(ctx, `INSERT INTO events (topic, kind, payload) VALUES ('t', 'x', 'null') RETURNING id`).Scan(&id)
	pool.Exec(ctx, `DELETE FROM events`)
	bus := NewBus(pool)
	bus.Start(ctx)
	if bus.lastID != id {
		t.Fatalf("head = %d, want %d", bus.lastID, id)
	}
}

func TestDispatchBlockedOnAFullQueueDoesNotBlockSubscribe(t *testing.T) {
	bus := NewBus(nil)
	release := make(chan struct{})
	defer close(release)
	bus.Subscribe("", func(Event) { <-release })
	go func() {
		for i := range handlerBacklog + 2 {
			bus.dispatch(Event{ID: int64(i + 1), Topic: "t"})
		}
	}()
	time.Sleep(100 * time.Millisecond)
	subscribed := make(chan struct{})
	go func() {
		bus.Subscribe("", func(Event) {})
		bus.QueueMax()
		close(subscribed)
	}()
	select {
	case <-subscribed:
	case <-time.After(time.Second):
		t.Fatal("Subscribe waited behind a dispatch stuck on a full queue")
	}
}

func TestShutdownWaitsForRunningOnceHandlersAndClaimsNothingNew(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool := testkit.Pool(t)
	bus := NewBus(pool)
	started, release := make(chan struct{}, 2), make(chan struct{})
	var finished atomic.Int32
	bus.SubscribeOnce("audit", "audit.write", func(Event) {
		started <- struct{}{}
		<-release
		finished.Add(1)
	})
	bus.Start(ctx)
	for range 2 {
		tx, _ := pool.Begin(ctx)
		Publish(ctx, tx, "audit", "x", nil, Audience{})
		tx.Commit(ctx)
	}
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("handler did not start")
	}
	cancel()
	go func() {
		time.Sleep(200 * time.Millisecond)
		close(release)
	}()
	bus.WaitForHandlers(3 * time.Second)
	if finished.Load() != 1 {
		t.Fatalf("%d handlers finished before shutdown returned, want the running one", finished.Load())
	}
	var claims int
	pool.QueryRow(context.Background(), `SELECT count(*) FROM event_claims WHERE handler = 'audit.write'`).Scan(&claims)
	if claims != 1 {
		t.Fatalf("%d claims; the queued event must stay unclaimed for another replica", claims)
	}
}

func TestDispatchAfterShutdownNeverBlocks(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	pool := testkit.Pool(t)
	bus := NewBus(pool)
	bus.SubscribeOnce("audit", "audit.write", func(Event) {})
	bus.Start(ctx)
	cancel()
	bus.WaitForHandlers(time.Second)
	dispatched := make(chan struct{})
	go func() {
		for i := range handlerBacklog + 5 {
			bus.dispatch(Event{ID: int64(i + 1), Topic: "audit"})
		}
		close(dispatched)
	}()
	select {
	case <-dispatched:
	case <-time.After(3 * time.Second):
		t.Fatal("dispatch blocked after shutdown, holding the listener's connection")
	}
}

func TestEventInFlightWhileTheOutboxWasEmptyReachesPlainHandlers(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool := testkit.Pool(t)
	inFlight, _ := pool.Begin(ctx)
	Publish(ctx, inFlight, "t", "in flight", nil, Audience{})
	bus := NewBus(pool)
	got := make(chan string, 2)
	bus.Subscribe("t", func(e Event) { got <- e.Kind })
	bus.Start(ctx)
	inFlight.Commit(ctx)
	if kind := receive(t, got); kind != "in flight" {
		t.Fatalf("got %q", kind)
	}
}

func TestSkippedIdsAreCapped(t *testing.T) {
	bus := NewBus(nil)
	bus.skip(1, 5*maxSkipped)
	if len(bus.skipped) != maxSkipped {
		t.Fatalf("%d skipped ids remembered", len(bus.skipped))
	}
}
