package replicas

import (
	"context"
	"testing"
	"time"

	"gripello/internal/platform/testkit"
)

func TestReplicasReportThemselvesAndGoOfflineWhenSilent(t *testing.T) {
	pool := testkit.Pool(t)
	ctx := context.Background()
	started := time.Now().Add(-time.Hour).Truncate(time.Second)
	for _, name := range []string{"app-1", "app-2", "app-3"} {
		if err := Beat(ctx, pool, Replica{Name: name, Version: "1.4.0", Role: "all", Started: started, RealtimeClients: 3}); err != nil {
			t.Fatal(err)
		}
	}
	pool.Exec(ctx, `UPDATE replicas SET last_seen = now() - interval '5 minutes' WHERE name = 'app-2'`)
	pool.Exec(ctx, `UPDATE replicas SET last_seen = now() - interval '20 minutes' WHERE name = 'app-3'`)
	if list, _ := List(ctx, pool); len(list) != 2 {
		t.Errorf("a replica killed 20 minutes ago is still listed: %+v", list)
	}
	if err := Prune(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var rows int
	pool.QueryRow(ctx, `SELECT count(*) FROM replicas`).Scan(&rows)
	if rows != 2 {
		t.Errorf("prune kept %d rows, want 2", rows)
	}

	got, err := List(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Name != "app-1" || !got[0].Online || got[1].Name != "app-2" || got[1].Online {
		t.Fatalf("replicas = %+v", got)
	}
	if got[0].RealtimeClients != 3 || got[0].MemoryBytes == 0 || got[0].Goroutines == 0 || got[0].HeapBytes == 0 || got[0].DBConnsMax == 0 || !got[0].Started.Equal(started) || got[0].Version != "1.4.0" {
		t.Errorf("app-1 = %+v", got[0])
	}

	ctx2, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		Run(ctx2, pool, Replica{Name: "app-4", Started: started}, Probes{
			RealtimeClients: func() int { return 0 },
			RealtimeDropped: func() int64 { return 7 },
			BusLag:          func(context.Context) (time.Duration, error) { return 1500 * time.Millisecond, nil },
			BusQueueMax:     func() int { return 4 },
		})
		close(done)
	}()
	reported := false
	for deadline := time.Now().Add(5 * time.Second); !reported && time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		list, _ := List(ctx, pool)
		reported = len(list) == 3
		if reported && (list[2].RealtimeDropped != 7 || list[2].BusLagMS != 1500 || list[2].BusQueueMax != 4) {
			t.Errorf("app-4 probes = %+v", list[2])
		}
	}
	cancel()
	<-done
	if !reported {
		t.Fatal("a running replica never reported itself")
	}
	if list, _ := List(ctx, pool); len(list) != 2 {
		t.Errorf("a stopped replica stays listed: %+v", list)
	}
}
