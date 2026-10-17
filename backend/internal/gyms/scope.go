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
