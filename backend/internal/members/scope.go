package members

import (
	"context"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/db"
)

func canReadRoles(ctx context.Context, q db.Querier, p auth.Principal, gymID string) bool {
	return p.PlatformAdmin || isMember(ctx, q, p.UserID, gymID)
}
