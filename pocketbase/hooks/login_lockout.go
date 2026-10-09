package hooks

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/pocketbase/pocketbase/tools/types"
)

const (
	lockoutMaxFailures = 10
	lockoutWindow      = 15 * time.Minute
	lockoutDuration    = 15 * time.Minute
)

func registerLoginLockout(app core.App) {
	app.OnRecordAuthWithPasswordRequest("users").BindFunc(func(e *core.RecordAuthWithPasswordRequestEvent) error {
		key := lockoutKey(e.Record, e.Identity)
		if isLockedOut(e.App, key) {
			return errAccountLocked()
		}
		err := e.Next()
		if isCredentialFailure(err) {
			recordLoginFailure(e.RequestEvent, key, e.Record)
		}
		return err
	})

	app.OnRecordConfirmPasswordResetRequest("users").BindFunc(func(e *core.RecordConfirmPasswordResetRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		clearLoginFailures(e.App, e.Record.Id)
		return nil
	})

	app.Cron().MustAdd("loginLockoutCleanup", "41 * * * *", func() {
		_, err := pruneRows(app, "DELETE FROM login_lockouts WHERE window_start < {:cutoff} AND (locked_until = '' OR locked_until < {:now})",
			dbx.Params{"cutoff": cutoff(lockoutWindow), "now": types.NowDateTime().String()})
		if err != nil {
			app.Logger().Error("lockout: cleanup failed", "error", err)
		}
	})
}

func errAccountLocked() error {
	return router.NewApiError(http.StatusTooManyRequests, "Account temporarily locked. Try again later.", nil)
}

func lockoutKey(user *core.Record, identity string) string {
	if user != nil {
		return user.Id
	}
	digest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(identity))))
	return hex.EncodeToString(digest[:])
}

func isCredentialFailure(err error) bool {
	var apiErr *router.ApiError
	return errors.As(err, &apiErr) && apiErr.Status == http.StatusBadRequest
}

func isLockedOut(app core.App, key string) bool {
	record, err := app.FindFirstRecordByData("login_lockouts", "key", key)
	if err != nil {
		return false
	}
	until := record.GetDateTime("locked_until")
	return !until.IsZero() && until.Time().After(time.Now())
}

func recordLoginFailure(e *core.RequestEvent, key string, user *core.Record) {
	locked, err := countLoginFailure(e.App, key)
	if err != nil {
		e.App.Logger().Error("lockout: failed to count failure", "error", err)
		return
	}
	if locked {
		writeAuthEvent(e, nil, user, "account_locked", "unknown:"+key[:8])
	}
}

// Runs on PocketBase's single write connection, so parallel guesses are counted one after another.
func countLoginFailure(app core.App, key string) (locked bool, err error) {
	err = app.RunInTransaction(func(txApp core.App) error {
		record, err := txApp.FindFirstRecordByData("login_lockouts", "key", key)
		if err != nil {
			collection, err := txApp.FindCachedCollectionByNameOrId("login_lockouts")
			if err != nil {
				return err
			}
			record = core.NewRecord(collection)
			record.Set("key", key)
		}
		now := time.Now()
		if start := record.GetDateTime("window_start"); start.IsZero() || now.Sub(start.Time()) > lockoutWindow {
			record.Set("window_start", now)
			record.Set("failures", 0)
		}
		failures := record.GetInt("failures") + 1
		record.Set("failures", failures)
		if failures >= lockoutMaxFailures {
			record.Set("locked_until", now.Add(lockoutDuration))
			record.Set("failures", 0)
			record.Set("window_start", now)
			locked = true
		}
		return txApp.Save(record)
	})
	return locked, err
}

func clearLoginFailures(app core.App, key string) {
	if _, err := app.DB().NewQuery("DELETE FROM login_lockouts WHERE key = {:key}").Bind(dbx.Params{"key": key}).Execute(); err != nil {
		app.Logger().Error("lockout: failed to clear", "error", err)
	}
}

func guardLockout(e *core.RequestEvent, user *core.Record, ok bool) error {
	if ok {
		return nil
	}
	recordLoginFailure(e, user.Id, user)
	return e.BadRequestError("Failed to authenticate.", nil)
}
