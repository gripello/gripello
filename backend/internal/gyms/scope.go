package gyms

import (
	"context"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/tenancy"
)

func requirePlatformAdmin(ctx context.Context) (auth.Principal, error) {
	p, err := auth.Require(ctx)
	if err != nil {
		return p, err
	}
	if !p.PlatformAdmin {
		return p, httpx.ErrForbidden
	}
	return p, nil
}

func canManageGym(ctx context.Context, perms *tenancy.Permissions, p auth.Principal, gymID string) bool {
	return p.PlatformAdmin || perms.Can(ctx, p.UserID, gymID, "manage_settings")
}

// Inactive gyms stay hidden from navigation; only their managers and platform admins see them.
func canSeeGym(ctx context.Context, perms *tenancy.Permissions, gymID string, active bool) bool {
	if active {
		return true
	}
	p, ok := auth.From(ctx)
	return ok && canManageGym(ctx, perms, p, gymID)
}
