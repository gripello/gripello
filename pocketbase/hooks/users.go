package hooks

import (
	"github.com/pocketbase/pocketbase/tools/types"
	"net/http"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

func registerUserGuards(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.GET("/api/platform/users/email-matches", userEmailMatches).Bind(apis.RequireAuth("users", core.CollectionNameSuperusers))
		se.Router.POST("/api/platform/users/{id}/suspension", suspendUser).Bind(apis.RequireAuth("users", core.CollectionNameSuperusers))
		se.Router.DELETE("/api/platform/users/{id}/suspension", liftSuspension).Bind(apis.RequireAuth("users", core.CollectionNameSuperusers))
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

	app.OnRecordAuthRequest("users").BindFunc(func(e *core.RecordAuthRequestEvent) error {
		if isSuspended(e.Record) {
			return apis.NewForbiddenError("This account is suspended.", nil)
		}
		return e.Next()
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

// Lifetime suspensions are stored as the last representable day instead of a separate flag.
var permanentSuspension, _ = types.ParseDateTime("9999-12-31 00:00:00.000Z")

func isSuspended(user *core.Record) bool {
	until := user.GetDateTime("suspended_until")
	return !until.IsZero() && until.After(types.NowDateTime())
}

func suspensionTarget(e *core.RequestEvent) (*core.Record, error) {
	if !e.HasSuperuserAuth() && !isPlatformAdmin(e.Auth) {
		return nil, e.ForbiddenError("Suspending users requires platform admin rights.", nil)
	}
	user, err := e.App.FindRecordById("users", e.Request.PathValue("id"))
	if err != nil {
		return nil, e.NotFoundError("", nil)
	}
	if !e.HasSuperuserAuth() && (user.Id == e.Auth.Id || user.GetBool("platform_admin")) {
		return nil, e.ForbiddenError("Only the superuser can suspend a platform admin.", nil)
	}
	return user, nil
}

func suspendUser(e *core.RequestEvent) error {
	user, err := suspensionTarget(e)
	if err != nil {
		return err
	}
	var body struct {
		Until     types.DateTime `json:"until"`
		Permanent bool           `json:"permanent"`
		Reason    string         `json:"reason"`
	}
	err = e.BindBody(&body)
	if body.Permanent {
		body.Until = permanentSuspension
	}
	if err != nil || !body.Until.After(types.NowDateTime()) {
		return e.BadRequestError("A suspension needs an end date in the future.", err)
	}
	user.Set("suspended_until", body.Until)
	user.Set("suspension_reason", truncateRunes(strings.TrimSpace(body.Reason), 2000))
	user.RefreshTokenKey()
	if err := e.App.Save(user); err != nil {
		return e.BadRequestError("The suspension could not be saved.", err)
	}
	auditSuspension(e, user)
	if err := sendSuspensionMail(e.App, user); err != nil {
		e.App.Logger().Error("users: suspension mail failed", "user", user.Id, "error", err)
	}
	return e.NoContent(http.StatusNoContent)
}

func liftSuspension(e *core.RequestEvent) error {
	user, err := suspensionTarget(e)
	if err != nil {
		return err
	}
	user.Set("suspended_until", "")
	user.Set("suspension_reason", "")
	if err := e.App.Save(user); err != nil {
		return e.BadRequestError("The suspension could not be lifted.", err)
	}
	auditSuspension(e, user)
	return e.NoContent(http.StatusNoContent)
}

func auditSuspension(e *core.RequestEvent, user *core.Record) {
	entry := requestAuditEntry(e, "update", "users")
	entry.RecordID = user.Id
	entry.ChangedFields = []string{"suspended_until", "suspension_reason"}
	writeAuditEntry(e.App, entry)
}

func sendSuspensionMail(app core.App, user *core.Record) error {
	if !app.Settings().SMTP.Enabled {
		app.Logger().Warn("users: SMTP disabled, suspension notice not sent", "user", user.Id)
		return nil
	}
	until := user.GetDateTime("suspended_until")
	details := []mailDetail{{Label: "until", Value: until.Time().Format("2006-01-02 15:04 MST")}}
	if !until.Before(permanentSuspension) {
		details[0] = mailDetail{Label: "until", ValueKey: "platform.users.permanent"}
	}
	if reason := user.GetString("suspension_reason"); reason != "" {
		details = append(details, mailDetail{Label: "reasoning", Value: reason})
	}
	_, err := sendGymMail(app, mailContent{
		Key:     "accountSuspended",
		Name:    user.GetString("firstname"),
		Details: details,
		Outro:   []string{"mails.reportDecision.redress"},
	}, []mailRecipient{{Address: user.Email(), Language: user.GetString("language")}})
	return err
}
