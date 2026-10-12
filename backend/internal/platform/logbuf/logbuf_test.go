package logbuf

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"gripello/internal/platform/testkit"
)

func TestRecordsOfEveryReplicaAreShippedAndFilteredByLevel(t *testing.T) {
	pool := testkit.Pool(t)
	ctx := context.Background()
	var out bytes.Buffer
	first, second := New(&out), New(&bytes.Buffer{})
	log := slog.New(first).With("module", "a")
	log.Debug("hidden at info")
	log.Info("started", "port", 8080)
	log.Warn("slow query", "ms", 900)
	slog.New(second).Error("boom", "error", errors.New("535 invalid"))
	first.Flush(ctx, pool, "replica-1")
	second.Flush(ctx, pool, "replica-2")

	got, err := Recent(ctx, pool, slog.LevelWarn, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Message != "boom" || got[0].Replica != "replica-2" || got[0].Attrs["error"] != "535 invalid" ||
		got[1].Message != "slow query" || got[1].Replica != "replica-1" || got[1].Attrs["ms"] != float64(900) || got[1].Attrs["module"] != "a" {
		t.Fatalf("warn+ = %+v", got)
	}
	if all, _ := Recent(ctx, pool, slog.LevelDebug, 100); len(all) != 3 {
		t.Errorf("debug was shipped although the level is info: %+v", all)
	}
	if !strings.Contains(out.String(), "slow query") {
		t.Error("records no longer reach the text output")
	}

	pool.Exec(ctx, `UPDATE server_logs SET time = now() - interval '8 days' WHERE message = 'started'`)
	if err := Prune(ctx, pool, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	if all, _ := Recent(ctx, pool, slog.LevelDebug, 100); len(all) != 2 {
		t.Errorf("after prune = %+v", all)
	}
}

func TestAFailedShipKeepsTheRecords(t *testing.T) {
	pool := testkit.Pool(t)
	ctx := context.Background()
	b := New(&bytes.Buffer{})
	slog.New(b).Error("before the table exists")
	b.Flush(ctx, pool, "replica-1")
	b.Flush(ctx, pool, "replica-1")
	if got, _ := Recent(ctx, pool, slog.LevelDebug, 10); len(got) != 1 {
		t.Errorf("records = %+v", got)
	}
}

func TestBinaryJunkDoesNotBlockShipping(t *testing.T) {
	pool := testkit.Pool(t)
	ctx := context.Background()
	b := New(&bytes.Buffer{})
	slog.New(b).Warn("upload \x00name\xff", "file", "a\x00b\xfe", "parts", []string{"x\x00y", `lit\u0000eral`})
	b.Flush(ctx, pool, "replica-1")
	got, _ := Recent(ctx, pool, slog.LevelDebug, 10)
	parts, _ := got[0].Attrs["parts"].([]any)
	if len(got) != 1 || got[0].Message != "upload name\uFFFD" || got[0].Attrs["file"] != "ab\uFFFD" ||
		len(parts) != 2 || parts[0] != "xy" || parts[1] != `lit\u0000eral` {
		t.Fatalf("records = %+v", got)
	}
	if left := b.queue.take(); len(left) != 0 {
		t.Errorf("%d records stuck in the queue", len(left))
	}
}

func TestTheQueueIsBounded(t *testing.T) {
	b := New(&bytes.Buffer{})
	log := slog.New(b)
	for i := range maxPending + 5 {
		log.Info("line", "n", i)
	}
	if got := b.queue.take(); len(got) != maxPending || got[0].Attrs["n"] != int64(0) {
		t.Errorf("queued %d, first %v", len(got), got[0].Attrs["n"])
	}
}
