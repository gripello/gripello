package logbuf

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

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
	got := b.queue.take()
	if len(got) != maxPending+1 || got[0].Attrs["n"] != int64(0) {
		t.Fatalf("queued %d, first %v", len(got), got[0].Attrs["n"])
	}
	if last := got[maxPending]; last.Message != "logbuf: queue full, records dropped" || last.Attrs["dropped"] != 5 || last.Fingerprint == "" {
		t.Errorf("the overflow is not reported: %+v", last)
	}
	if again := b.queue.take(); len(again) != 0 {
		t.Errorf("the drop was reported twice: %+v", again)
	}
}

func TestPostgresErrorsAreLoggedWithoutTheValuesTheyQuote(t *testing.T) {
	var out bytes.Buffer
	buf := New(&out)
	pg := &pgconn.PgError{Code: "23505", Message: `duplicate key value violates unique constraint "users_email_key"`,
		Detail: "Key (email)=(ada@example.com) already exists.", TableName: "users", ConstraintName: "users_email_key"}
	slog.New(buf).Error("request failed", "error", fmt.Errorf("register: %w", pg))
	slog.New(buf.WithAttrs([]slog.Attr{slog.Any("cause", pg)})).Warn("query failed")
	entries := buf.queue.take()
	if got := entries[0].Attrs["error"]; got != "register: postgres 23505 table=users constraint=users_email_key" {
		t.Errorf("error attr = %q", got)
	}
	if strings.Contains(out.String(), "ada@example.com") || strings.Contains(fmt.Sprint(entries), "ada@example.com") {
		t.Errorf("the e-mail reached the log: %s %v", out.String(), entries)
	}
}

func TestFingerprintsSeparateQueriesPanicsAndTopicsButNotIDs(t *testing.T) {
	slow := func(sql string) string {
		return Fingerprint(slog.LevelWarn, "slow query", map[string]any{"sql": sql})
	}
	if slow("SELECT * FROM routes WHERE id = 'a1b2c3'") != slow("SELECT * FROM routes WHERE id = 'z9y8x7'") {
		t.Error("the same query with other values became two issues")
	}
	if slow("SELECT * FROM routes") == slow("SELECT * FROM ticks") {
		t.Error("different slow queries share one issue")
	}
	panicked := func(topic, panic string) string {
		return Fingerprint(slog.LevelError, "events: handler panicked", map[string]any{"topic": topic, "panic": panic})
	}
	if panicked("gym:g1", "nil map") == panicked("notify", "nil map") || panicked("notify", "nil map") == panicked("notify", "index out of range") {
		t.Error("handler panics of other topics or causes share one issue")
	}
	if Fingerprint(slog.LevelInfo, "started", nil) != "" {
		t.Error("info records got a fingerprint")
	}
}

func TestAnErrorStormStoresSamplesAndOneWeightedSummary(t *testing.T) {
	pool := testkit.Pool(t)
	ctx := context.Background()
	buf := New(io.Discard)
	minute := time.Now().Truncate(time.Minute)
	storm := Entry{Level: "ERROR", Message: "request failed", Attrs: map[string]any{"route": "GET /api/x"}, Weight: 1}
	storm.Fingerprint = Fingerprint(slog.LevelError, storm.Message, storm.Attrs)
	other := Entry{Time: minute, Level: "ERROR", Message: "job failed for good, dropped", Weight: 1}
	other.Fingerprint = Fingerprint(slog.LevelError, other.Message, nil)
	for i := range 1000 {
		storm.Time = minute.Add(time.Duration(i) * time.Millisecond)
		buf.queue.add(storm)
	}
	buf.queue.add(other)
	buf.Flush(ctx, pool, "app-1")

	var rows, weight int
	pool.QueryRow(ctx, `SELECT count(*), sum(weight) FROM server_logs WHERE fingerprint = $1`, storm.Fingerprint).Scan(&rows, &weight)
	if rows != samplesPerMinute+1 || weight != 1000 {
		t.Errorf("storm stored %d rows with weight %d, want %d rows with weight 1000", rows, weight, samplesPerMinute+1)
	}
	issues, err := Issues(ctx, pool, time.Hour, 10)
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, issue := range issues {
		counts[issue.Fingerprint] = issue.Count
	}
	if counts[storm.Fingerprint] != 1000 || counts[other.Fingerprint] != 1 {
		t.Errorf("issue counts = %v; another issue must not be sampled by the storm", counts)
	}
}

func TestLongStacksAreCut(t *testing.T) {
	buf := New(io.Discard)
	slog.New(buf).Error("request panicked", "stack", strings.Repeat("x", 3*maxStack))
	if stack := buf.queue.take()[0].Attrs["stack"].(string); len(stack) > maxStack+len("…") {
		t.Errorf("stack kept %d bytes", len(stack))
	}
}

func TestOutOfOrderRecordsDoNotResetTheSamplingWindow(t *testing.T) {
	q := &queue{}
	minute := time.Now().Truncate(time.Minute)
	e := Entry{Level: "ERROR", Message: "boom", Fingerprint: "fp", Weight: 1}
	for i := range 2 * samplesPerMinute {
		// Alternate between the end of one minute and the start of the next, as concurrent loggers can.
		e.Time = minute.Add(time.Duration(i%2*2-1) * time.Millisecond)
		q.add(e)
	}
	if kept := len(q.pending); kept > samplesPerMinute+1 {
		t.Errorf("kept %d records across a jittering boundary, want at most %d", kept, samplesPerMinute+1)
	}
}
