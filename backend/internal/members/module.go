package members

import (
	"context"

	"gripello/internal/platform"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/tenancy"
)

func Register(app *platform.App) {
	h := &handlers{app: app, perms: tenancy.New(app.DB)}
	routes := map[string]httpx.Handler{
		"GET /gyms/{gym}/members":      h.listMembers,
		"POST /gyms/{gym}/members":     h.inviteMember,
		"POST /gyms/{gym}/memberships": h.addMembership,
		"GET /platform/roles":          h.listAllRoles,
		"GET /me/memberships":          h.ownMemberships,
		"POST /memberships/{id}/role":  h.changeRole,
		"DELETE /memberships/{id}":     h.deleteMembership,
		"GET /gyms/{gym}/roles":        h.listRoles,
		"POST /gyms/{gym}/roles":       h.createRole,
		"PATCH /roles/{id}":            h.updateRole,
		"PUT /roles/{id}/permissions":  h.setRolePermissions,
		"DELETE /roles/{id}":           h.deleteRole,
		"GET /gyms/{gym}/invites":      h.listInvites,
		"DELETE /invites/{id}":         h.revokeInvite,
		"GET /invites/{token}":         h.showInvite,
		"POST /invites/{token}/accept": h.acceptInvite,
	}
	for pattern, handler := range routes {
		app.Handle(pattern, handler)
	}
	app.Cron.Add("inviteRetention", "29 3 * * *", func(ctx context.Context) error {
		return pruneExpiredInvites(ctx, app.DB)
	})
}
