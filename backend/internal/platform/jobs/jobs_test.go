package jobs

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform/testkit"
)

func TestEnqueueDuringRunKeepsTheJob(t *testing.T) {
	ctx := context.Background()
	pool := testkit.Pool(t)
	if err := Enqueue(ctx, pool, "k", "user1", nil, 0); err != nil {
		t.Fatal(err)
	}
	job, ok := claim(ctx, pool)
	if !ok {
		t.Fatal("nothing claimed")
	}
	workers := map[string]Worker{"k": func(ctx context.Context, j Job) error {
		return Enqueue(ctx, pool, "k", "user1", nil, 0)
	}}
	run(ctx, pool, workers, job)
	var left int
	pool.QueryRow(ctx, `SELECT count(*) FROM jobs WHERE kind = 'k'`).Scan(&left)
	if left != 1 {
		t.Fatalf("re-enqueued job lost, %d rows", left)
	}
	var attempts int
	pool.QueryRow(ctx, `SELECT attempts FROM jobs WHERE kind = 'k'`).Scan(&attempts)
	if attempts != 0 {
		t.Fatalf("a successful run left attempts at %d", attempts)
	}
	again, ok := claim(ctx, pool)
	if !ok || again.ID != job.ID {
		t.Fatal("job should run again")
	}
	run(ctx, pool, map[string]Worker{"k": func(context.Context, Job) error { return nil }}, again)
	pool.QueryRow(ctx, `SELECT count(*) FROM jobs WHERE kind = 'k'`).Scan(&left)
	if left != 0 {
		t.Fatalf("finished job not removed, %d rows", left)
	}
}

func TestRunningJobRenewsItsLease(t *testing.T) {
	ctx := context.Background()
	pool := testkit.Pool(t)
	defer func(previous time.Duration) { lease = previous }(lease)
	lease = 600 * time.Millisecond
	Enqueue(ctx, pool, "slow", "k", nil, 0)
	job, _ := claim(ctx, pool)
	run(ctx, pool, map[string]Worker{"slow": func(ctx context.Context, j Job) error {
		time.Sleep(1500 * time.Millisecond)
		if _, stolen := claim(ctx, pool); stolen {
			t.Error("a job still running was claimed again")
		}
		return nil
	}}, job)
}

func TestCronUnlocksAfterTheJobsContextExpired(t *testing.T) {
	ctx := context.Background()
	pool := testkit.Pool(t)
	const key = 912345
	jobCtx, cancel := context.WithCancel(ctx)
	var held int
	count := func() {
		pool.QueryRow(ctx, `SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid::text = $1`, strconv.Itoa(key)).Scan(&held)
	}
	runLocked(jobCtx, pool, key, func(context.Context) {
		count()
		cancel()
	})
	if held != 1 {
		t.Fatalf("lock not visible while held (%d)", held)
	}
	count()
	if held != 0 {
		t.Fatal("advisory lock leaked after the job's context ended")
	}
}

func TestQueueClaimsOnlyWithAFreeSlot(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool := testkit.Pool(t)
	Enqueue(ctx, pool, "busy", "a", nil, 0)
	Enqueue(ctx, pool, "busy", "b", nil, 0)
	started, release := make(chan struct{}, 2), make(chan struct{})
	go RunQueue(ctx, pool, map[string]Worker{"busy": func(context.Context, Job) error {
		started <- struct{}{}
		<-release
		return nil
	}}, 1)
	<-started
	time.Sleep(1500 * time.Millisecond)
	var claimed int
	pool.QueryRow(ctx, `SELECT count(*) FROM jobs WHERE kind = 'busy' AND locked_until IS NOT NULL`).Scan(&claimed)
	close(release)
	if claimed != 1 {
		t.Fatalf("%d jobs claimed with one worker slot", claimed)
	}
}

func countJobs(t *testing.T, pool *pgxpool.Pool, kind string) int {
	t.Helper()
	var n int
	pool.QueryRow(context.Background(), `SELECT count(*) FROM jobs WHERE kind = $1`, kind).Scan(&n)
	return n
}

func TestEnqueueDuringTheLastFailedAttemptKeepsTheJob(t *testing.T) {
	ctx := context.Background()
	pool := testkit.Pool(t)
	Enqueue(ctx, pool, "k", "a", nil, 0)
	pool.Exec(ctx, `UPDATE jobs SET attempts = $1 - 1`, maxAttempts)
	job, _ := claim(ctx, pool)
	run(ctx, pool, map[string]Worker{"k": func(ctx context.Context, j Job) error {
		Enqueue(ctx, pool, "k", "a", nil, 0)
		return errors.New("fails for good")
	}}, job)
	if countJobs(t, pool, "k") != 1 {
		t.Fatal("an enqueue during the last failed attempt was dropped")
	}
}

func TestEnqueueAfterTheLeaseLapsedKeepsTheJob(t *testing.T) {
	ctx := context.Background()
	pool := testkit.Pool(t)
	Enqueue(ctx, pool, "k", "a", nil, 0)
	job, _ := claim(ctx, pool)
	run(ctx, pool, map[string]Worker{"k": func(ctx context.Context, j Job) error {
		pool.Exec(ctx, `UPDATE jobs SET locked_until = now() - interval '1 second'`)
		return Enqueue(ctx, pool, "k", "a", nil, 0)
	}}, job)
	if countJobs(t, pool, "k") != 1 {
		t.Fatal("an enqueue after the lease lapsed was removed with the finished run")
	}
}

func TestQueueFinishesRunningJobsOnShutdown(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	pool := testkit.Pool(t)
	Enqueue(ctx, pool, "k", "a", nil, 0)
	started := make(chan struct{})
	stopped := make(chan struct{})
	go func() {
		RunQueue(ctx, pool, map[string]Worker{"k": func(ctx context.Context, j Job) error {
			close(started)
			time.Sleep(300 * time.Millisecond)
			return ctx.Err()
		}}, 1)
		close(stopped)
	}()
	<-started
	cancel()
	select {
	case <-stopped:
	case <-time.After(stopTimeout + time.Second):
		t.Fatal("RunQueue did not return")
	}
	if countJobs(t, pool, "k") != 0 {
		t.Fatal("a job that finished during shutdown was left to run again")
	}
}

func TestCronSlotRunsOnce(t *testing.T) {
	ctx := context.Background()
	pool := testkit.Pool(t)
	slot := time.Now().Truncate(time.Minute)
	if !claimSlot(ctx, pool, "digest", slot) || claimSlot(ctx, pool, "digest", slot) {
		t.Fatal("a slot must be claimed exactly once")
	}
	if !claimSlot(ctx, pool, "digest", slot.Add(time.Minute)) || !claimSlot(ctx, pool, "other", slot) {
		t.Fatal("the next slot and other jobs are claimed independently")
	}
}

func TestCronStopCancelsRunningJobs(t *testing.T) {
	pool := testkit.Pool(t)
	defer func(previous time.Duration) { stopTimeout = previous }(stopTimeout)
	stopTimeout = 100 * time.Millisecond
	c := NewCron(pool)
	started := make(chan struct{}, 1)
	c.Add("waits", "@every 1s", func(ctx context.Context) error {
		started <- struct{}{}
		<-ctx.Done()
		return ctx.Err()
	})
	c.Start()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("cron job did not start")
	}
	begin := time.Now()
	c.Stop()
	if took := time.Since(begin); took > time.Second {
		t.Fatalf("Stop took %v; running jobs must be cancelled after the grace", took)
	}
}

func TestReEnqueuesOfAJobWithAStaleLeaseDoNotPostponeIt(t *testing.T) {
	ctx := context.Background()
	pool := testkit.Pool(t)
	Enqueue(ctx, pool, "k", "a", nil, 0)
	claim(ctx, pool)
	pool.Exec(ctx, `UPDATE jobs SET locked_until = now() - interval '1 second'`)
	Enqueue(ctx, pool, "k", "a", nil, 10*time.Second)
	Enqueue(ctx, pool, "k", "a", nil, 20*time.Second)
	var postponed bool
	pool.QueryRow(ctx, `SELECT run_after > now() + interval '15 seconds' FROM jobs WHERE kind = 'k'`).Scan(&postponed)
	if postponed {
		t.Fatal("every re-enqueue pushed the job of a dead replica further out")
	}
}

func TestCronJobCancelledByShutdownGivesItsSlotBack(t *testing.T) {
	pool := testkit.Pool(t)
	defer func(previous time.Duration) { stopTimeout = previous }(stopTimeout)
	stopTimeout = 100 * time.Millisecond
	c := NewCron(pool)
	started := make(chan struct{}, 1)
	c.Add("daily", "@every 1s", func(ctx context.Context) error {
		started <- struct{}{}
		<-ctx.Done()
		return ctx.Err()
	})
	c.Start()
	<-started
	c.Stop()
	var claimed int
	pool.QueryRow(context.Background(), `SELECT count(*) FROM cron_runs WHERE name = 'daily'`).Scan(&claimed)
	if claimed != 0 {
		t.Fatal("a run cut short by shutdown kept its slot")
	}
}

func TestJobCutOffByShutdownKeepsItsAttempts(t *testing.T) {
	pool := testkit.Pool(t)
	Enqueue(context.Background(), pool, "k", "a", nil, 0)
	pool.Exec(context.Background(), `UPDATE jobs SET attempts = $1 - 1`, maxAttempts)
	job, _ := claim(context.Background(), pool)
	ctx, cancel := context.WithCancel(context.Background())
	run(ctx, pool, map[string]Worker{"k": func(ctx context.Context, j Job) error {
		cancel()
		return ctx.Err()
	}}, job)
	if countJobs(t, pool, "k") != 1 {
		t.Fatal("a job cut off by shutdown was dropped")
	}
	if again, ok := claim(context.Background(), pool); !ok || again.Attempts != maxAttempts {
		t.Fatalf("the cut-off run counted as an attempt or the job is not claimable again: %+v", again)
	}
}
