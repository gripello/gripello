package jobs

import (
	"context"
	"strconv"
	"testing"
	"time"

	"gripello/internal/platform/db"
	"gripello/internal/platform/testkit"
)

func TestEnqueueDuringRunKeepsTheJob(t *testing.T) {
	ctx := context.Background()
	pool := testkit.Pool(t)
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
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
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
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
