package jobs

import (
	"context"
	"hash/fnv"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/robfig/cron/v3"
)

// Cron runs each job on exactly one replica: the job body only runs while this replica holds the job's advisory lock.
type Cron struct {
	pool *pgxpool.Pool
	cron *cron.Cron
}

func NewCron(pool *pgxpool.Pool) *Cron {
	return &Cron{pool: pool, cron: cron.New()}
}

func (c *Cron) Add(name, spec string, fn func(ctx context.Context) error) {
	key := int64(fnv32(name))
	_, err := c.cron.AddFunc(spec, func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		runLocked(ctx, c.pool, key, func(ctx context.Context) {
			if err := fn(ctx); err != nil {
				slog.Error("cron job failed", "job", name, "error", err)
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
		return
	}
	defer conn.Release()
	var locked bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, key).Scan(&locked); err != nil || !locked {
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

func (c *Cron) Start() { c.cron.Start() }
func (c *Cron) Stop()  { <-c.cron.Stop().Done() }

func fnv32(s string) uint32 {
	h := fnv.New32a()
	h.Write([]byte(s))
	return h.Sum32()
}

// Enqueue coalesces: a pending job with the same kind+key is left as is (the worker reads the latest state anyway).
func Enqueue(ctx context.Context, pool *pgxpool.Pool, kind, key string, payload []byte, delay time.Duration) error {
	_, err := pool.Exec(ctx, `INSERT INTO jobs (kind, key, payload, run_after) VALUES ($1, $2, $3, now() + $4::interval)
		ON CONFLICT (kind, key) DO UPDATE SET run_after = CASE
			WHEN jobs.locked_until > now() THEN EXCLUDED.run_after
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
}

type Worker func(ctx context.Context, job Job) error

// RunQueue polls with SKIP LOCKED so any number of replicas can share the queue without double-running a job.
func RunQueue(ctx context.Context, pool *pgxpool.Pool, workers map[string]Worker, concurrency int) {
	sem := make(chan struct{}, concurrency)
	for ctx.Err() == nil {
		job, ok := claim(ctx, pool)
		if !ok {
			time.Sleep(time.Second)
			continue
		}
		sem <- struct{}{}
		go func() {
			defer func() { <-sem }()
			run(ctx, pool, workers, job)
		}()
	}
}

// lease is how long a claim holds without renewal; a running job renews it every lease/3, so only a dead replica's jobs are taken over.
var lease = 5 * time.Minute

func claim(ctx context.Context, pool *pgxpool.Pool) (Job, bool) {
	var j Job
	err := pool.QueryRow(ctx, `UPDATE jobs SET locked_until = now() + $1::interval, attempts = attempts + 1
		WHERE id = (SELECT id FROM jobs WHERE run_after <= now() AND (locked_until IS NULL OR locked_until < now())
		            ORDER BY run_after FOR UPDATE SKIP LOCKED LIMIT 1)
		RETURNING id, kind, key, payload, run_after`, lease.String()).Scan(&j.ID, &j.Kind, &j.Key, &j.Payload, &j.RunAfter)
	return j, err == nil
}

func run(ctx context.Context, pool *pgxpool.Pool, workers map[string]Worker, job Job) {
	w := workers[job.Kind]
	if w == nil {
		slog.Error("jobs: no worker", "kind", job.Kind)
		pool.Exec(ctx, `DELETE FROM jobs WHERE id = $1`, job.ID)
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
				pool.Exec(ctx, `UPDATE jobs SET locked_until = now() + $2::interval WHERE id = $1`, job.ID, lease.String())
			}
		}
	}()
	err := w(ctx, job)
	close(done)
	<-renewing
	if err != nil {
		slog.Error("job failed", "kind", job.Kind, "key", job.Key, "error", err)
		// ponytail: fixed 1 min retry, no backoff; attempts is there when one is needed
		pool.Exec(ctx, `UPDATE jobs SET run_after = now() + interval '1 minute', locked_until = NULL WHERE id = $1 AND attempts < 5`, job.ID)
		pool.Exec(ctx, `DELETE FROM jobs WHERE id = $1 AND attempts >= 5`, job.ID)
		return
	}
	// An Enqueue that landed while the job ran moved run_after; keep that row so the job runs again.
	pool.Exec(ctx, `DELETE FROM jobs WHERE id = $1 AND run_after = $2`, job.ID, job.RunAfter)
	pool.Exec(ctx, `UPDATE jobs SET locked_until = NULL WHERE id = $1`, job.ID)
}
