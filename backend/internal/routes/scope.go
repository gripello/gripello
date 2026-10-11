package routes

import (
	"context"
	"slices"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/tenancy"
)

const (
	permManageRoutes   = "manage_routes"
	permManageSettings = "manage_settings"
	permRunInventory   = "run_inventory"
)

func (m *module) can(ctx context.Context, gym string, permissions ...string) bool {
	p, ok := auth.From(ctx)
	if !ok {
		return false
	}
	for _, permission := range permissions {
		if p.PlatformAdmin && slices.Contains(tenancy.PlatformAdminGrants, permission) {
			return true
		}
		if m.perms.Can(ctx, p.UserID, gym, permission) {
			return true
		}
	}
	return false
}

func (m *module) require(ctx context.Context, gym string, permissions ...string) error {
	if _, err := auth.Require(ctx); err != nil {
		return err
	}
	if !m.can(ctx, gym, permissions...) {
		return httpx.ErrForbidden
	}
	return nil
}
