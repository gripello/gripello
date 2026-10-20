package db

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"gripello/internal/platform/httpx"
)

// SlowQuery is the duration above which a query is logged at WARN; 0 disables it.
var SlowQuery = 500 * time.Millisecond

// tracer logs slow and failed queries with their SQL but never their arguments, which hold personal data.
type tracer struct{}

type queryStart struct {
	sql   string
	start time.Time
}

type queryStartKey struct{}

func (tracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	return context.WithValue(ctx, queryStartKey{}, queryStart{data.SQL, time.Now()})
}

func (tracer) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData) {
	q, ok := ctx.Value(queryStartKey{}).(queryStart)
	// goose probes its version table before creating it on a fresh database.
	if !ok || strings.Contains(q.sql, "goose_db_version") {
		return
	}
	took := time.Since(q.start)
	attrs := []any{"req", httpx.RequestID(ctx), "sql", compactSQL(q.sql), "ms", took.Milliseconds()}
	switch {
	case data.Err != nil && !expectedQueryError(data.Err):
		slog.Warn("query failed", append(attrs, "error", data.Err)...)
	case SlowQuery > 0 && took > SlowQuery && !strings.HasPrefix(q.sql, "LISTEN"):
		slog.Warn("slow query", append(attrs, "rows", data.CommandTag.RowsAffected())...)
	}
}

// Constraint violations are mapped to 4xx by the modules; cancelled queries (57014, contexts) are clients that went away.
func expectedQueryError(err error) bool {
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		return strings.HasPrefix(pg.Code, "23") || pg.Code == "57014"
	}
	return errors.Is(err, pgx.ErrNoRows) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

func compactSQL(sql string) string {
	sql = strings.Join(strings.Fields(sql), " ")
	if len(sql) > 500 {
		sql = sql[:500] + "…"
	}
	return sql
}

// IsUnique reports a unique violation on a constraint whose name contains constraint ("" matches any).
func IsUnique(err error, constraint string) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505" && strings.Contains(pg.ConstraintName, constraint)
}

// IsFKViolation includes ON DELETE RESTRICT, which PostgreSQL 18 reports as 23001 instead of 23503.
func IsFKViolation(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && (pg.Code == "23503" || pg.Code == "23001")
}

func NotFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.ErrNotFound
	}
	return err
}
