package hooks

import (
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
	"github.com/pocketbase/pocketbase/tools/types"
)

const (
	adminRoleName     = "admin"
	inviteTokenLength = 40
	inviteLifetime    = 7 * 24 * time.Hour
)

func registerMemberships(app core.App) {
	guard := func(e *core.RecordRequestEvent) error {
		if !e.HasSuperuserAuth() {
			if err := validateMembership(e.App, e.Auth, e.Record); err != nil {
				return err
			}
		}
		return e.Next()
	}
	app.OnRecordCreateRequest("memberships").BindFunc(guard)
	app.OnRecordUpdateRequest("memberships").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() {
			return e.Next()
		}
		if err := validateMembership(e.App, e.Auth, e.Record); err != nil {
			return err
		}
		if !callerMayAssignRole(e.App, e.Auth, e.Record.Original().GetString("role")) {
			return apis.NewForbiddenError("You cannot change the role of a member with permissions you do not hold.", nil)
		}
		if err := keepAnAdmin(e.App, e.Record, false); err != nil {
			return err
		}
		return e.Next()
	})
	app.OnRecordDeleteRequest("memberships").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() {
			return e.Next()
		}
		leaving := e.Auth != nil && e.Auth.Id == e.Record.GetString("user")
		if !leaving && !callerMayAssignRole(e.App, e.Auth, e.Record.GetString("role")) {
			return apis.NewForbiddenError("You cannot remove a member with permissions you do not hold.", nil)
		}
		if err := keepAnAdmin(e.App, e.Record, true); err != nil {
			return err
		}
		return e.Next()
	})

	app.Cron().MustAdd("inviteRetention", "29 3 * * *", func() {
		if _, err := pruneRows(app, "DELETE FROM invites WHERE expires_at < {:now}", dbx.Params{"now": types.NowDateTime().String()}); err != nil {
			app.Logger().Error("invites: prune failed", "error", err)
		}
	})

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.POST("/api/gyms/{gym}/members", inviteMember).Bind(apis.RequireAuth("users"))
		se.Router.GET("/api/invites/{token}", showInvite)
		se.Router.POST("/api/invites/{token}/accept", acceptInvite)
		return se.Next()
	})
}

func inviteMember(e *core.RequestEvent) error {
	gymID := e.Request.PathValue("gym")
	if !isPlatformAdmin(e.Auth) && !hasPermission(e.App, e.Auth.Id, gymID, "manage_users") {
		return e.ForbiddenError("Inviting members requires manage_users.", nil)
	}
	var body struct {
		Email     string `json:"email"`
		Role      string `json:"role"`
		Firstname string `json:"firstname"`
		Name      string `json:"name"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid invitation.", err)
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	if user, err := e.App.FindAuthRecordByEmail("users", email); err == nil && membershipOf(e.App, user.Id, gymID) != nil {
		return apis.NewApiError(http.StatusConflict, "This person is already a member.", nil)
	}
	memberships, err := e.App.FindCachedCollectionByNameOrId("memberships")
	if err != nil {
		return err
	}
	membership := core.NewRecord(memberships)
	membership.Set("gym", gymID)
	membership.Set("role", body.Role)
	if err := validateMembership(e.App, e.Auth, membership); err != nil {
		return err
	}
	auditAction := "update"
	invite, err := e.App.FindFirstRecordByFilter("invites", "gym = {:gym} && email = {:email}", dbx.Params{"gym": gymID, "email": email})
	if err != nil {
		auditAction = "create"
		collection, err := e.App.FindCachedCollectionByNameOrId("invites")
		if err != nil {
			return err
		}
		invite = core.NewRecord(collection)
		invite.Set("gym", gymID)
		invite.Set("email", email)
	}
	token := security.RandomString(inviteTokenLength)
	invite.Set("role", body.Role)
	invite.Set("firstname", body.Firstname)
	invite.Set("name", body.Name)
	invite.Set("token_hash", security.SHA256(token))
	invite.Set("expires_at", types.NowDateTime().Add(inviteLifetime))
	if err := e.App.Save(invite); err != nil {
		return e.BadRequestError("The invitation could not be saved.", err)
	}
	auditInvite(e, auditAction, "invites", invite.Id, gymID)
	if err := sendInviteMail(e.App, invite, token); err != nil {
		e.App.Logger().Error("invites: mail failed", "invite", invite.Id, "error", err)
	}
	return e.NoContent(http.StatusAccepted)
}

func findInvite(app core.App, token string) (*core.Record, error) {
	return app.FindFirstRecordByFilter("invites", "token_hash = {:hash} && expires_at > @now", dbx.Params{"hash": security.SHA256(token)})
}

func showInvite(e *core.RequestEvent) error {
	invite, err := findInvite(e.App, e.Request.PathValue("token"))
	if err != nil {
		return e.NotFoundError("This invitation is invalid or has expired.", nil)
	}
	gym, gymErr := e.App.FindRecordById("gyms", invite.GetString("gym"))
	role, roleErr := e.App.FindRecordById("roles", invite.GetString("role"))
	if gymErr != nil || roleErr != nil {
		return e.NotFoundError("This invitation is invalid or has expired.", nil)
	}
	_, accountErr := e.App.FindAuthRecordByEmail("users", invite.GetString("email"))
	return e.JSON(http.StatusOK, map[string]any{
		"email":      invite.GetString("email"),
		"firstname":  invite.GetString("firstname"),
		"name":       invite.GetString("name"),
		"gym":        map[string]string{"name": gym.GetString("name"), "slug": gym.GetString("slug")},
		"role":       role.GetString("name"),
		"hasAccount": accountErr == nil,
	})
}

func acceptInvite(e *core.RequestEvent) error {
	invite, err := findInvite(e.App, e.Request.PathValue("token"))
	if err != nil {
		return e.NotFoundError("This invitation is invalid or has expired.", nil)
	}
	email := invite.GetString("email")
	user := e.Auth
	if user != nil && !strings.EqualFold(user.Email(), email) {
		return e.ForbiddenError("This invitation is for another account.", nil)
	}
	if user == nil {
		if _, err := e.App.FindAuthRecordByEmail("users", email); err == nil {
			return apis.NewApiError(http.StatusConflict, "Sign in to accept this invitation.", nil)
		}
		var body struct {
			Password        string `json:"password"`
			PasswordConfirm string `json:"passwordConfirm"`
			Firstname       string `json:"firstname"`
			Name            string `json:"name"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("Invalid request.", err)
		}
		users, err := e.App.FindCachedCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		user = core.NewRecord(users)
		user.SetEmail(email)
		user.SetPassword(body.Password)
		user.Set("passwordConfirm", body.PasswordConfirm)
		user.SetVerified(true)
		user.Set("firstname", body.Firstname)
		user.Set("name", body.Name)
	}
	gymID := invite.GetString("gym")
	created := user.IsNew()
	var membership *core.Record
	err = e.App.RunInTransaction(func(txApp core.App) error {
		if created {
			if err := txApp.Save(user); err != nil {
				return err
			}
		}
		if membershipOf(txApp, user.Id, gymID) == nil {
			memberships, err := txApp.FindCachedCollectionByNameOrId("memberships")
			if err != nil {
				return err
			}
			membership = core.NewRecord(memberships)
			membership.Set("user", user.Id)
			membership.Set("gym", gymID)
			membership.Set("role", invite.GetString("role"))
			if err := txApp.Save(membership); err != nil {
				return err
			}
		}
		return txApp.Delete(invite)
	})
	if err != nil {
		return e.BadRequestError("The invitation could not be accepted.", err)
	}
	if created {
		auditInvite(e, "create", "users", user.Id, gymID)
	}
	if membership != nil {
		auditInvite(e, "create", "memberships", membership.Id, gymID)
	}
	result := map[string]string{"gym": ""}
	if gym, err := e.App.FindRecordById("gyms", gymID); err == nil {
		result["gym"] = gym.GetString("slug")
	}
	if created {
		return apis.RecordAuthResponse(e, user, core.MFAMethodPassword, result)
	}
	return e.JSON(http.StatusOK, result)
}

func sendInviteMail(app core.App, invite *core.Record, token string) error {
	role, err := app.FindRecordById("roles", invite.GetString("role"))
	if err != nil {
		return err
	}
	_, err = sendGymMail(app, mailContent{
		Key:    "invite",
		Gym:    invite.GetString("gym"),
		Name:   invite.GetString("firstname"),
		Params: map[string]any{"role": role.GetString("name")},
		Action: "/auth/invite/" + token,
	}, []mailRecipient{{Address: invite.GetString("email")}})
	return err
}

func auditInvite(e *core.RequestEvent, action, collection, recordID, gymID string) {
	entry := requestAuditEntry(e, action, collection)
	entry.RecordID = recordID
	entry.Gym = gymID
	writeAuditEntry(e.App, entry)
}

func validateMembership(app core.App, caller *core.Record, membership *core.Record) error {
	if !membership.IsNew() {
		original := membership.Original()
		if original.GetString("user") != membership.GetString("user") || original.GetString("gym") != membership.GetString("gym") {
			return apis.NewBadRequestError("Only the role of a membership can change.", nil)
		}
	}
	role, err := app.FindRecordById("roles", membership.GetString("role"))
	if err != nil || role.GetString("gym") != membership.GetString("gym") {
		return apis.NewBadRequestError("The role does not belong to this gym.", nil)
	}
	if !callerMayAssignRole(app, caller, role.Id) {
		return apis.NewForbiddenError("You cannot assign a role with permissions you do not hold.", nil)
	}
	return nil
}

func keepAnAdmin(app core.App, membership *core.Record, removing bool) error {
	original := membership.Original()
	if !isAdminRole(app, original.GetString("role")) {
		return nil
	}
	if !removing && isAdminRole(app, membership.GetString("role")) {
		return nil
	}
	others, err := app.CountRecords("memberships", dbx.And(
		dbx.HashExp{"gym": original.GetString("gym")},
		dbx.Not(dbx.HashExp{"id": membership.Id}),
		dbx.NewExp("[[role]] IN (SELECT [[id]] FROM {{roles}} WHERE [[name]] = {:admin})", dbx.Params{"admin": adminRoleName}),
	))
	if err != nil {
		return err
	}
	if others == 0 {
		return apis.NewBadRequestError("A gym needs at least one admin.", nil)
	}
	return nil
}

func isAdminRole(app core.App, roleID string) bool {
	role, err := app.FindRecordById("roles", roleID)
	return err == nil && role.GetString("name") == adminRoleName
}

func membershipOf(app core.App, userID, gymID string) *core.Record {
	if userID == "" || gymID == "" {
		return nil
	}
	membership, err := app.FindFirstRecordByFilter("memberships", "user = {:user} && gym = {:gym}", dbx.Params{"user": userID, "gym": gymID})
	if err != nil {
		return nil
	}
	return membership
}

func memberRole(app core.App, userID, gymID string) *core.Record {
	membership := membershipOf(app, userID, gymID)
	if membership == nil {
		return nil
	}
	role, err := app.FindRecordById("roles", membership.GetString("role"))
	if err != nil {
		return nil
	}
	return role
}

func hasPermission(app core.App, userID, gymID, permission string) bool {
	if userID == "" || gymID == "" {
		return false
	}
	found, err := app.FindRecordsByFilter(
		"memberships",
		"user = {:user} && gym = {:gym} && role.permissions.name ?= {:permission}",
		"",
		1,
		0,
		dbx.Params{"user": userID, "gym": gymID, "permission": permission},
	)
	return err == nil && len(found) > 0
}

func usersByPermission(app core.App, gymID, permission string) []*core.Record {
	memberships, err := app.FindRecordsByFilter(
		"memberships",
		"gym = {:gym} && role.permissions.name ?= {:permission}",
		"",
		200,
		0,
		dbx.Params{"gym": gymID, "permission": permission},
	)
	if err != nil {
		app.Logger().Error("memberships: failed to resolve users by permission", "gym", gymID, "permission", permission, "error", err)
		return nil
	}
	ids := make([]string, 0, len(memberships))
	for _, membership := range memberships {
		ids = append(ids, membership.GetString("user"))
	}
	if len(ids) == 0 {
		return nil
	}
	users, err := app.FindRecordsByIds("users", ids)
	if err != nil {
		app.Logger().Error("memberships: failed to load users", "gym", gymID, "error", err)
		return nil
	}
	return users
}

func callerPermissionIDs(app core.App, caller *core.Record, gymID string) []string {
	if caller == nil {
		return nil
	}
	role := memberRole(app, caller.Id, gymID)
	if role == nil {
		return nil
	}
	return role.GetStringSlice("permissions")
}

func isPlatformAdmin(auth *core.Record) bool {
	return auth != nil && auth.Collection().Name == "users" && auth.GetBool("platform_admin")
}

func callerMayAssignRole(app core.App, caller *core.Record, roleID string) bool {
	if caller == nil {
		return false
	}
	role, err := app.FindRecordById("roles", roleID)
	if err != nil {
		return false
	}
	if isPlatformAdmin(caller) {
		return true
	}
	callerRole := memberRole(app, caller.Id, role.GetString("gym"))
	if callerRole == nil {
		return false
	}
	if role.GetString("name") == adminRoleName && callerRole.GetString("name") != adminRoleName {
		return false
	}
	return isSubset(role.GetStringSlice("permissions"), callerRole.GetStringSlice("permissions"))
}

func registerAdminRoleGuard(app core.App) {
	app.OnRecordCreateRequest("roles").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() || isPlatformAdmin(e.Auth) {
			return e.Next()
		}
		if !isSubset(e.Record.GetStringSlice("permissions"), callerPermissionIDs(e.App, e.Auth, e.Record.GetString("gym"))) {
			return apis.NewForbiddenError("You cannot grant permissions you do not hold.", nil)
		}
		return e.Next()
	})

	app.OnRecordUpdateRequest("roles").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() || isPlatformAdmin(e.Auth) {
			return e.Next()
		}
		original := e.Record.Original()
		if !adminRoleChangeAllowed(original.GetString("name"), e.Record.GetString("name"), original.GetStringSlice("permissions"), e.Record.GetStringSlice("permissions")) {
			return apis.NewForbiddenError("The admin role cannot be renamed or lose permissions.", nil)
		}
		before, after := original.GetStringSlice("permissions"), e.Record.GetStringSlice("permissions")
		changed := append(addedPermissions(before, after), addedPermissions(after, before)...)
		if !isSubset(changed, callerPermissionIDs(e.App, e.Auth, original.GetString("gym"))) {
			return apis.NewForbiddenError("You cannot grant or revoke permissions you do not hold.", nil)
		}
		return e.Next()
	})

	app.OnRecordDeleteRequest("roles").BindFunc(func(e *core.RecordRequestEvent) error {
		if !roleDeletable(e.Record.GetString("name"), e.HasSuperuserAuth()) {
			return apis.NewForbiddenError("The admin role cannot be deleted.", nil)
		}
		return e.Next()
	})
}

func roleDeletable(name string, superuser bool) bool {
	return superuser || name != adminRoleName
}

func addedPermissions(before, after []string) []string {
	return slices.DeleteFunc(slices.Clone(after), func(permission string) bool {
		return slices.Contains(before, permission)
	})
}

func isSubset(subset, superset []string) bool {
	return !slices.ContainsFunc(subset, func(item string) bool {
		return !slices.Contains(superset, item)
	})
}

func adminRoleChangeAllowed(nameBefore, nameAfter string, permissionsBefore, permissionsAfter []string) bool {
	if nameBefore != adminRoleName {
		return true
	}
	if nameAfter != adminRoleName {
		return false
	}
	return isSubset(permissionsBefore, permissionsAfter)
}
