package lockout

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/db"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
)

const (
	MaxFailures = 10
	Window      = 15 * time.Minute
	Duration    = 15 * time.Minute
)

var ErrLocked = httpx.NewError(http.StatusTooManyRequests, "Account temporarily locked. Try again later.")

func IsLocked(ctx context.Context, q db.Querier, key string) bool {
	var locked bool
	q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM login_lockouts WHERE key = $1 AND locked_until > now())`, key).Scan(&locked)
	return locked
}

const windowExpired = `login_lockouts.window_start IS NULL OR login_lockouts.window_start < now() - $3::interval`

// Reserve counts an attempt before its secret is checked, so parallel guesses can't outrun the limit; ErrLocked
// once the key is locked or the open attempts reach it. Release takes it back after a success, Failed keeps it.
func Reserve(ctx context.Context, q db.Querier, key string) error {
	var reserved bool
	err := q.QueryRow(ctx, `INSERT INTO login_lockouts (id, key, failures, window_start) VALUES ($1, $2, 1, now())
		ON CONFLICT (key) DO UPDATE SET
		  failures = CASE WHEN `+windowExpired+` THEN 1 ELSE login_lockouts.failures + 1 END,
		  window_start = CASE WHEN `+windowExpired+` THEN now() ELSE login_lockouts.window_start END
		WHERE (login_lockouts.locked_until IS NULL OR login_lockouts.locked_until <= now())
		  AND (`+windowExpired+` OR login_lockouts.failures < $4)
		RETURNING true`, ids.New(), key, Window.String(), MaxFailures).Scan(&reserved)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrLocked
	}
	return err
}

// Release and Failed outlive the request: a client that hangs up must not leave its attempt open.
func Release(ctx context.Context, q db.Querier, key string) error {
	_, err := q.Exec(context.WithoutCancel(ctx), `UPDATE login_lockouts SET failures = GREATEST(failures - 1, 0) WHERE key = $1`, key)
	return err
}

// Failed turns a reserved attempt into a failure; the one that reaches MaxFailures locks the key.
func Failed(ctx context.Context, q db.Querier, key string) (bool, error) {
	tag, err := q.Exec(context.WithoutCancel(ctx), `UPDATE login_lockouts SET locked_until = now() + $2::interval, failures = 0, window_start = now()
		WHERE key = $1 AND failures >= $3`, key, Duration.String(), MaxFailures)
	return tag.RowsAffected() > 0, err
}

func Clear(ctx context.Context, q db.Querier, key string) error {
	_, err := q.Exec(ctx, `DELETE FROM login_lockouts WHERE key = $1`, key)
	return err
}

func Prune(ctx context.Context, q db.Querier) error {
	_, err := q.Exec(ctx, `DELETE FROM login_lockouts WHERE window_start < now() - $1::interval AND (locked_until IS NULL OR locked_until < now())`, Window.String())
	return err
}
