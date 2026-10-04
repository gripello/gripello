package hooks

import (
	"net/http"
	"slices"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
)

const adminRoleName = "admin"

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

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.POST("/api/gyms/{gym}/members", inviteMember).Bind(apis.RequireAuth("users"))
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
	email := strings.TrimSpace(body.Email)
	user, err := e.App.FindAuthRecordByEmail("users", email)
	created := err != nil
	if !created && membershipOf(e.App, user.Id, gymID) != nil {
		return apis.NewApiError(http.StatusConflict, "This person is already a member.", nil)
	}
	collection, err := e.App.FindCachedCollectionByNameOrId("memberships")
	if err != nil {
		return err
	}
	membership := core.NewRecord(collection)
	membership.Set("gym", gymID)
	membership.Set("role", body.Role)
	if err := validateMembership(e.App, e.Auth, membership); err != nil {
		return err
	}
	err = e.App.RunInTransaction(func(txApp core.App) error {
		if created {
			users, err := txApp.FindCachedCollectionByNameOrId("users")
			if err != nil {
				return err
			}
			user = core.NewRecord(users)
			user.SetEmail(email)
			user.SetPassword(security.RandomString(30))
			user.SetVerified(false)
			user.Set("firstname", body.Firstname)
			user.Set("name", body.Name)
			if err := txApp.Save(user); err != nil {
				return err
			}
		}
		membership.Set("user", user.Id)
		return txApp.Save(membership)
	})
	if err != nil {
		return e.BadRequestError("The membership could not be saved.", err)
	}
	if created {
		auditInvite(e, "users", user.Id, gymID)
	}
	auditInvite(e, "memberships", membership.Id, gymID)
	if !created {
		return e.JSON(http.StatusOK, membership)
	}
	if err := sendInviteMail(e.App, user, gymID); err != nil {
		e.App.Logger().Error("memberships: invitation mail failed", "user", user.Id, "error", err)
	}
	return e.JSON(http.StatusCreated, map[string]bool{"created": true})
}

func sendInviteMail(app core.App, user *core.Record, gymID string) error {
	token, err := user.NewPasswordResetToken()
	if err != nil {
		return err
	}
	_, err = sendGymMail(app, mailContent{
		Key:    "invite",
		Gym:    gymID,
		Name:   user.GetString("firstname"),
		Action: "/auth/confirm-password-reset/" + token,
	}, usersAsRecipients([]*core.Record{user}))
	return err
}

func auditInvite(e *core.RequestEvent, collection, recordID, gymID string) {
	entry := requestAuditEntry(e, "create", collection)
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
