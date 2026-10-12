// Package replicas lets every running server report itself, so the platform overview lists the whole cluster.
package replicas

import (
	"context"
	"log/slog"
	"runtime"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	heartbeat = 30 * time.Second
	// Missing three heartbeats marks a replica offline; a killed one (no clean stop) is dropped after forgetAfter,
	// so rollouts that rename every pod don't pile up.
	offlineAfter = 3 * heartbeat
	forgetAfter  = 15 * time.Minute
)

// Counters named "per heartbeat" (db_waits, db_wait_ms, realtime_dropped) cover the last 30 s, so they show the load now.
type Replica struct {
	Name            string    `json:"name"`
	Version         string    `json:"version"`
	Role            string    `json:"role"`
	Started         time.Time `json:"started"`
	LastSeen        time.Time `json:"last_seen"`
	Online          bool      `json:"online"`
	RealtimeClients int       `json:"realtime_clients"`
	MemoryBytes     int64     `json:"memory_bytes"`
	Goroutines      int       `json:"goroutines"`
	HeapBytes       int64     `json:"heap_bytes"`
	GCPauseMS       float64   `json:"gc_pause_ms"`
	DBConnsInUse    int       `json:"db_conns_in_use"`
	DBConnsMax      int       `json:"db_conns_max"`
	DBWaits         int       `json:"db_waits"`
	DBWaitMS        float64   `json:"db_wait_ms"`
	RealtimeDropped int       `json:"realtime_dropped"`
	BusLagMS        float64   `json:"bus_lag_ms"`
	BusQueueMax     int       `json:"bus_queue_max"`
}

// Probes reads this replica's live numbers; the counters are totals since start, Run turns them into per-heartbeat deltas.
type Probes struct {
	RealtimeClients func() int
	RealtimeDropped func() int64
	BusLag          func(context.Context) (time.Duration, error)
	BusQueueMax     func() int
}

// Run reports this replica until ctx ends; a clean shutdown removes its row so scaled-down replicas disappear at once.
func Run(ctx context.Context, pool *pgxpool.Pool, self Replica, probes Probes) {
	ticker := time.NewTicker(heartbeat)
	defer ticker.Stop()
	var last counters
	for {
		now := sample(pool, probes)
		r := self
		r.RealtimeClients = probes.RealtimeClients()
		r.BusQueueMax = probes.BusQueueMax()
		if lag, err := probes.BusLag(ctx); err == nil {
			r.BusLagMS = float64(lag.Microseconds()) / 1000
		}
		r.DBWaits = int(now.waits - last.waits)
		r.DBWaitMS = float64((now.waitTime - last.waitTime).Microseconds()) / 1000
		r.RealtimeDropped = int(now.dropped - last.dropped)
		last = now
		if err := Beat(ctx, pool, r); err != nil && ctx.Err() == nil {
			slog.Warn("replicas: heartbeat failed", "error", err)
		}
		warnIfStrained(r)
		select {
		case <-ticker.C:
		case <-ctx.Done():
			gone, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			pool.Exec(gone, `DELETE FROM replicas WHERE name = $1`, self.Name)
			return
		}
	}
}

type counters struct {
	waits, dropped int64
	waitTime       time.Duration
}

func sample(pool *pgxpool.Pool, probes Probes) counters {
	stat := pool.Stat()
	return counters{waits: stat.EmptyAcquireCount(), waitTime: stat.EmptyAcquireWaitTime(), dropped: probes.RealtimeDropped()}
}

// warnIfStrained puts capacity problems into the server log, where issue alerts pick them up.
func warnIfStrained(r Replica) {
	if r.DBWaitMS > 1000 {
		slog.Warn("replicas: requests waited for a database connection", "waits", r.DBWaits, "wait_ms", r.DBWaitMS, "max_conns", r.DBConnsMax)
	}
	if r.RealtimeDropped > 0 {
		slog.Warn("replicas: realtime events dropped for slow clients", "dropped", r.RealtimeDropped)
	}
	if r.BusLagMS > 10_000 {
		slog.Warn("replicas: event bus is behind", "lag_ms", r.BusLagMS, "queue_max", r.BusQueueMax)
	}
}

// Beat writes r with this process's runtime and pool numbers.
func Beat(ctx context.Context, pool *pgxpool.Pool, r Replica) error {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	stat := pool.Stat()
	r.MemoryBytes, r.HeapBytes, r.Goroutines = int64(mem.Sys), int64(mem.HeapInuse), runtime.NumGoroutine()
	r.GCPauseMS = float64(mem.PauseNs[(mem.NumGC+255)%256]) / 1e6
	r.DBConnsInUse, r.DBConnsMax = int(stat.AcquiredConns()), int(stat.MaxConns())
	_, err := pool.Exec(ctx, `INSERT INTO replicas (name, version, role, started, last_seen, realtime_clients, memory_bytes,
			goroutines, heap_bytes, gc_pause_ms, db_conns_in_use, db_conns_max, db_waits, db_wait_ms, realtime_dropped, bus_lag_ms, bus_queue_max)
		VALUES ($1, $2, $3, $4, now(), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
		ON CONFLICT (name) DO UPDATE SET version = $2, role = $3, started = $4, last_seen = now(), realtime_clients = $5, memory_bytes = $6,
			goroutines = $7, heap_bytes = $8, gc_pause_ms = $9, db_conns_in_use = $10, db_conns_max = $11, db_waits = $12,
			db_wait_ms = $13, realtime_dropped = $14, bus_lag_ms = $15, bus_queue_max = $16`,
		r.Name, r.Version, r.Role, r.Started, r.RealtimeClients, r.MemoryBytes, r.Goroutines, r.HeapBytes, r.GCPauseMS,
		r.DBConnsInUse, r.DBConnsMax, r.DBWaits, r.DBWaitMS, r.RealtimeDropped, r.BusLagMS, r.BusQueueMax)
	return err
}

func List(ctx context.Context, pool *pgxpool.Pool) ([]Replica, error) {
	rows, err := pool.Query(ctx, `SELECT name, version, role, started, last_seen, last_seen > now() - $1::interval, realtime_clients, memory_bytes,
			goroutines, heap_bytes, gc_pause_ms, db_conns_in_use, db_conns_max, db_waits, db_wait_ms, realtime_dropped, bus_lag_ms, bus_queue_max
		FROM replicas WHERE last_seen > now() - $2::interval ORDER BY name`, offlineAfter.String(), forgetAfter.String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Replica{}
	for rows.Next() {
		var r Replica
		if err := rows.Scan(&r.Name, &r.Version, &r.Role, &r.Started, &r.LastSeen, &r.Online, &r.RealtimeClients, &r.MemoryBytes,
			&r.Goroutines, &r.HeapBytes, &r.GCPauseMS, &r.DBConnsInUse, &r.DBConnsMax, &r.DBWaits, &r.DBWaitMS, &r.RealtimeDropped,
			&r.BusLagMS, &r.BusQueueMax); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func Prune(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `DELETE FROM replicas WHERE last_seen < now() - $1::interval`, forgetAfter.String())
	return err
}
