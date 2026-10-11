// Package replicas lets every running server report itself, so the platform overview lists the whole cluster.
package replicas

import (
	"context"
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

type Replica struct {
	Name            string    `json:"name"`
	Version         string    `json:"version"`
	Role            string    `json:"role"`
	Started         time.Time `json:"started"`
	LastSeen        time.Time `json:"last_seen"`
	Online          bool      `json:"online"`
	RealtimeClients int       `json:"realtime_clients"`
	MemoryBytes     int64     `json:"memory_bytes"`
}

// Run reports this replica until ctx ends; a clean shutdown removes its row so scaled-down replicas disappear at once.
func Run(ctx context.Context, pool *pgxpool.Pool, self Replica, realtimeClients func() int) {
	ticker := time.NewTicker(heartbeat)
	defer ticker.Stop()
	for {
		Beat(ctx, pool, self, realtimeClients())
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

func Beat(ctx context.Context, pool *pgxpool.Pool, self Replica, realtimeClients int) error {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	_, err := pool.Exec(ctx, `INSERT INTO replicas (name, version, role, started, last_seen, realtime_clients, memory_bytes)
		VALUES ($1, $2, $3, $4, now(), $5, $6)
		ON CONFLICT (name) DO UPDATE SET version = $2, role = $3, started = $4, last_seen = now(), realtime_clients = $5, memory_bytes = $6`,
		self.Name, self.Version, self.Role, self.Started, realtimeClients, int64(mem.Sys))
	return err
}

func List(ctx context.Context, pool *pgxpool.Pool) ([]Replica, error) {
	rows, err := pool.Query(ctx, `SELECT name, version, role, started, last_seen, last_seen > now() - $1::interval, realtime_clients, memory_bytes
		FROM replicas WHERE last_seen > now() - $2::interval ORDER BY name`, offlineAfter.String(), forgetAfter.String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Replica{}
	for rows.Next() {
		var r Replica
		if err := rows.Scan(&r.Name, &r.Version, &r.Role, &r.Started, &r.LastSeen, &r.Online, &r.RealtimeClients, &r.MemoryBytes); err != nil {
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
