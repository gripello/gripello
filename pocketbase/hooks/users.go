package hooks

import (
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

func registerUserGuards(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.GET("/api/platform/users/email-matches", userEmailMatches).Bind(apis.RequireAuth("users", core.CollectionNameSuperusers))
		return se.Next()
	})

	app.OnRecordDeleteExecute("users").Bind(&hook.Handler[*core.RecordEvent]{
		Priority: 100,
		Func: func(e *core.RecordEvent) error {
			if _, err := e.App.DB().NewQuery("UPDATE audit_logs SET actor = '' WHERE actor = {:id}").
				Bind(dbx.Params{"id": e.Record.Id}).Execute(); err != nil {
				return err
			}
			return e.Next()
		},
	})

	app.OnRecordUpdateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if !e.HasSuperuserAuth() && touchesOtherPlatformAdmin(e.Auth, e.Record.Original()) {
			return apis.NewForbiddenError("Only the superuser can change another platform admin.", nil)
		}
		return e.Next()
	})

	app.OnRecordDeleteRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() {
			return e.Next()
		}
		if touchesOtherPlatformAdmin(e.Auth, e.Record) {
			return apis.NewForbiddenError("Only the superuser can delete another platform admin.", nil)
		}
		if e.Auth != nil && e.Auth.Id == e.Record.Id {
			return e.Next()
		}
		if soleAdmin, err := isSoleGymAdmin(e.App, e.Record.Id); err != nil {
			return err
		} else if soleAdmin {
			return apis.NewBadRequestError("A gym needs at least one admin.", nil)
		}
		return e.Next()
	})
}

func touchesOtherPlatformAdmin(caller, target *core.Record) bool {
	return target.GetBool("platform_admin") && (caller == nil || caller.Id != target.Id)
}

func isSoleGymAdmin(app core.App, userID string) (bool, error) {
	var gyms []string
	err := app.DB().NewQuery(`
		SELECT m.gym FROM memberships m JOIN roles r ON r.id = m.role
		WHERE m.user = {:user} AND r.name = {:admin}
		AND NOT EXISTS (
			SELECT 1 FROM memberships o JOIN roles orole ON orole.id = o.role
			WHERE o.gym = m.gym AND o.user != m.user AND orole.name = {:admin}
		)`).Bind(dbx.Params{"user": userID, "admin": adminRoleName}).Column(&gyms)
	return len(gyms) > 0, err
}

const userEmailMatchLimit = 50

// PocketBase refuses to filter on email for users who hide it, even for managers.
func userEmailMatches(e *core.RequestEvent) error {
	if !e.HasSuperuserAuth() && !isPlatformAdmin(e.Auth) {
		return e.ForbiddenError("Searching users requires platform admin rights.", nil)
	}
	term := strings.TrimSpace(e.Request.URL.Query().Get("q"))
	ids := []string{}
	if term == "" {
		return e.JSON(200, map[string]any{"ids": ids})
	}
	err := e.App.DB().
		Select("id").
		From("users").
		Where(dbx.Like("email", term)).
		Limit(userEmailMatchLimit).
		Column(&ids)
	if err != nil {
		return e.InternalServerError("", err)
	}
	return e.JSON(200, map[string]any{"ids": ids})
}
