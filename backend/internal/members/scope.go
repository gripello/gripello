package members

import (
	"context"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/tenancy"
)

func canManageUsers(ctx context.Context, perms *tenancy.Permissions, p auth.Principal, gymID string) bool {
	return p.PlatformAdmin || perms.Can(ctx, p.UserID, gymID, "manage_users")
}

func canReadRoles(ctx context.Context, q querier, p auth.Principal, gymID string) bool {
	return p.PlatformAdmin || isMember(ctx, q, p.UserID, gymID)
}
