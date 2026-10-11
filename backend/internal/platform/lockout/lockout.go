package lockout

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
)

const (
	MaxFailures = 10
	Window      = 15 * time.Minute
	Duration    = 15 * time.Minute
)

var ErrLocked = httpx.NewError(http.StatusTooManyRequests, "Account temporarily locked. Try again later.")

type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func IsLocked(ctx context.Context, q Querier, key string) bool {
	var locked bool
	q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM login_lockouts WHERE key = $1 AND locked_until > now())`, key).Scan(&locked)
	return locked
}

// CountFailure is one upsert, so parallel guesses are all counted; the tenth locks the key.
func CountFailure(ctx context.Context, q Querier, key string) (bool, error) {
	var failures int
	err := q.QueryRow(ctx, `INSERT INTO login_lockouts (id, key, failures, window_start) VALUES ($1, $2, 1, now())
		ON CONFLICT (key) DO UPDATE SET
		  failures = CASE WHEN login_lockouts.window_start IS NULL OR login_lockouts.window_start < now() - $3::interval THEN 1 ELSE login_lockouts.failures + 1 END,
		  window_start = CASE WHEN login_lockouts.window_start IS NULL OR login_lockouts.window_start < now() - $3::interval THEN now() ELSE login_lockouts.window_start END
		RETURNING failures`, ids.New(), key, Window.String()).Scan(&failures)
	if err != nil || failures < MaxFailures {
		return false, err
	}
	_, err = q.Exec(ctx, `UPDATE login_lockouts SET locked_until = now() + $2::interval, failures = 0, window_start = now() WHERE key = $1`,
		key, Duration.String())
	return err == nil, err
}

func Clear(ctx context.Context, q Querier, key string) error {
	_, err := q.Exec(ctx, `DELETE FROM login_lockouts WHERE key = $1`, key)
	return err
}

func Prune(ctx context.Context, q Querier) error {
	_, err := q.Exec(ctx, `DELETE FROM login_lockouts WHERE window_start < now() - $1::interval AND (locked_until IS NULL OR locked_until < now())`, Window.String())
	return err
}
