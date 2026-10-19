package jobs

import (
	"context"
	"hash/fnv"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/robfig/cron/v3"
)

// Cron runs each job once per scheduled minute (a cron_runs slot) and only under its advisory lock, so runs never overlap.
type Cron struct {
	pool     *pgxpool.Pool
	cron     *cron.Cron
	ctx      context.Context
	shutdown context.CancelFunc
}

func NewCron(pool *pgxpool.Pool) *Cron {
	ctx, cancel := context.WithCancel(context.Background())
	return &Cron{pool: pool, cron: cron.New(), ctx: ctx, shutdown: cancel}
}

func (c *Cron) Add(name, spec string, fn func(ctx context.Context) error) {
	key := int64(fnv32(name))
	_, err := c.cron.AddFunc(spec, func() {
		slot := time.Now().Truncate(time.Minute)
		ctx, cancel := context.WithTimeout(c.ctx, 10*time.Minute)
		defer cancel()
		runLocked(ctx, c.pool, key, func(ctx context.Context) {
			if !claimSlot(ctx, c.pool, name, slot) {
				return
			}
			start := time.Now()
			err := fn(ctx)
			if c.ctx.Err() != nil {
				unclaimSlot(c.pool, name, slot)
			}
			if err != nil {
				slog.Error("cron job failed", "job", name, "ms", time.Since(start).Milliseconds(), "error", err)
			} else {
				slog.Debug("cron job done", "job", name, "ms", time.Since(start).Milliseconds())
			}
		})
	})
	if err != nil {
		panic("jobs: bad cron spec for " + name + ": " + err.Error())
	}
}

// runLocked unlocks with a fresh context: the job's may have timed out, and a lock left on a pooled connection would block the cron forever.
func runLocked(ctx context.Context, pool *pgxpool.Pool, key int64, fn func(ctx context.Context)) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		slog.Warn("cron: no connection for the lock", "error", err)
		return
	}
	defer conn.Release()
	var locked bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, key).Scan(&locked); err != nil || !locked {
		if err != nil {
			slog.Warn("cron: taking the lock failed", "error", err)
		}
		return
	}
	defer func() {
		unlockCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := conn.Exec(unlockCtx, `SELECT pg_advisory_unlock($1)`, key); err != nil {
			conn.Conn().Close(unlockCtx)
		}
	}()
	fn(ctx)
}

// claimSlot: replica clocks differ by a little, so a short job would otherwise run again on a replica that fires after the first released the lock.
func claimSlot(ctx context.Context, pool *pgxpool.Pool, name string, slot time.Time) bool {
	tag, err := pool.Exec(ctx, `WITH pruned AS (DELETE FROM cron_runs WHERE name = $1 AND slot < $2::timestamptz - interval '1 day')
		INSERT INTO cron_runs (name, slot) VALUES ($1, $2) ON CONFLICT DO NOTHING`, name, slot)
	if err != nil {
		slog.Warn("cron: claiming the slot failed", "job", name, "error", err)
		return false
	}
	return tag.RowsAffected() == 1
}

// unclaimSlot frees the slot of a run shutdown cut short, for a replica whose tick fires later.
func unclaimSlot(pool *pgxpool.Pool, name string, slot time.Time) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pool.Exec(ctx, `DELETE FROM cron_runs WHERE name = $1 AND slot = $2`, name, slot)
}

func (c *Cron) Start() { c.cron.Start() }

// Stop gives running jobs stopTimeout, then cancels them and waits a little longer (docker stop kills after 10 s).
func (c *Cron) Stop() {
	stopped := c.cron.Stop().Done()
	select {
	case <-stopped:
		return
	case <-time.After(stopTimeout):
	}
	c.shutdown()
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		slog.Warn("cron: jobs still running at shutdown")
	}
}

var stopTimeout = 5 * time.Second

func fnv32(s string) uint32 {
	h := fnv.New32a()
	h.Write([]byte(s))
	return h.Sum32()
}

// Enqueue coalesces: a pending job with the same kind+key is left as is (the worker reads the latest state anyway).
func Enqueue(ctx context.Context, pool *pgxpool.Pool, kind, key string, payload []byte, delay time.Duration) error {
	_, err := pool.Exec(ctx, `INSERT INTO jobs (kind, key, payload, run_after) VALUES ($1, $2, $3, now() + $4::interval)
		ON CONFLICT (kind, key) DO UPDATE SET run_after = CASE
			WHEN jobs.locked_until IS NOT NULL AND jobs.run_after <= now() THEN EXCLUDED.run_after
			ELSE LEAST(jobs.run_after, EXCLUDED.run_after) END`,
		kind, key, payload, delay.String())
	return err
}

type Job struct {
	ID       int64
	Kind     string
	Key      string
	Payload  []byte
	RunAfter time.Time
	Attempts int
}

type Worker func(ctx context.Context, job Job) error

// RunQueue polls with SKIP LOCKED so replicas share the queue; after ctx ends running jobs get stopTimeout before they are cancelled.
func RunQueue(ctx context.Context, pool *pgxpool.Pool, workers map[string]Worker, concurrency int) {
	workCtx, cancelWork := context.WithCancel(context.WithoutCancel(ctx))
	defer cancelWork()
	sem := make(chan struct{}, concurrency)
	var running sync.WaitGroup
	defer func() {
		idle := make(chan struct{})
		go func() { running.Wait(); close(idle) }()
		select {
		case <-idle:
		case <-time.After(stopTimeout):
			cancelWork()
			<-idle
		}
	}()
	for ctx.Err() == nil {
		// A free slot first: a claimed job waiting for one would let its unrenewed lease run out.
		select {
		case sem <- struct{}{}:
		case <-ctx.Done():
			return
		}
		job, ok := claim(ctx, pool)
		if !ok {
			<-sem
			select {
			case <-time.After(time.Second):
			case <-ctx.Done():
			}
			continue
		}
		running.Go(func() {
			defer func() { <-sem }()
			run(workCtx, pool, workers, job)
		})
	}
}

// lease is how long a claim holds without renewal; a running job renews it every lease/3, so only a dead replica's jobs are taken over.
var lease = 5 * time.Minute

const maxAttempts = 5

func claim(ctx context.Context, pool *pgxpool.Pool) (Job, bool) {
	var j Job
	err := pool.QueryRow(ctx, `UPDATE jobs SET locked_until = now() + $1::interval, attempts = attempts + 1
		WHERE id = (SELECT id FROM jobs WHERE run_after <= now() AND (locked_until IS NULL OR locked_until < now())
		            ORDER BY run_after FOR UPDATE SKIP LOCKED LIMIT 1)
		RETURNING id, kind, key, payload, run_after, attempts`, lease.String()).Scan(&j.ID, &j.Kind, &j.Key, &j.Payload, &j.RunAfter, &j.Attempts)
	if err != nil && err != pgx.ErrNoRows && ctx.Err() == nil {
		slog.Warn("jobs: claiming failed", "error", err)
	}
	return j, err == nil
}

func run(ctx context.Context, pool *pgxpool.Pool, workers map[string]Worker, job Job) {
	// The bookkeeping outlives a cancelled job: a finished job left claimed would rerun once its lease ends.
	exec := func(sql string, args ...any) {
		bookCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		if _, err := pool.Exec(bookCtx, sql, args...); err != nil {
			slog.Warn("jobs: updating the job failed", "kind", job.Kind, "key", job.Key, "error", err)
		}
	}
	// An Enqueue that landed while the job ran moved run_after; keep that row so the job runs again.
	finish := func() {
		exec(`DELETE FROM jobs WHERE id = $1 AND run_after = $2`, job.ID, job.RunAfter)
		exec(`UPDATE jobs SET locked_until = NULL, attempts = 0 WHERE id = $1`, job.ID)
	}
	w := workers[job.Kind]
	if w == nil {
		slog.Error("jobs: no worker", "kind", job.Kind)
		exec(`DELETE FROM jobs WHERE id = $1`, job.ID)
		return
	}
	done, renewing := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(renewing)
		ticker := time.NewTicker(lease / 3)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				if _, err := pool.Exec(ctx, `UPDATE jobs SET locked_until = now() + $2::interval WHERE id = $1`, job.ID, lease.String()); err != nil {
					slog.Warn("jobs: renewing the lease failed, another replica may take the job over", "kind", job.Kind, "key", job.Key, "error", err)
				}
			}
		}
	}()
	start := time.Now()
	err := w(ctx, job)
	took := time.Since(start)
	close(done)
	<-renewing
	attrs := []any{"kind", job.Kind, "key", job.Key, "attempt", job.Attempts, "ms", took.Milliseconds(), "waited_ms", start.Sub(job.RunAfter).Milliseconds()}
	if err != nil && ctx.Err() != nil {
		slog.Warn("job cut off by shutdown, handed back", attrs...)
		exec(`UPDATE jobs SET locked_until = NULL, attempts = attempts - 1 WHERE id = $1`, job.ID)
		return
	}
	if err != nil {
		if job.Attempts >= maxAttempts {
			slog.Error("job failed for good, dropped", append(attrs, "error", err)...)
			finish()
			return
		}
		slog.Warn("job failed, retrying in a minute", append(attrs, "error", err)...)
		// ponytail: fixed 1 min retry, no backoff; attempts is there when one is needed
		exec(`UPDATE jobs SET run_after = now() + interval '1 minute', locked_until = NULL WHERE id = $1`, job.ID)
		return
	}
	if took > lease/2 {
		slog.Warn("job slow, close to its lease", attrs...)
	} else {
		slog.Debug("job done", attrs...)
	}
	finish()
}
