package members

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"slices"
	"time"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/httpx"
)

const (
	adminRoleName       = "admin"
	inviteTokenLength   = 40
	inviteLifetime      = 7 * 24 * time.Hour
	sessionUserAgentMax = 300
	tokenAlphabet       = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
)

func callerMayAssignRole(ctx context.Context, q querier, caller auth.Principal, r role) bool {
	if caller.PlatformAdmin {
		return true
	}
	callerRole, ok := memberRole(ctx, q, caller.UserID, r.Gym)
	if !ok {
		return false
	}
	if r.Name == adminRoleName && callerRole.Name != adminRoleName {
		return false
	}
	return isSubset(r.Permissions, callerRole.Permissions)
}

func callerHoldsPermissions(ctx context.Context, q querier, caller auth.Principal, gymID string, permissions []string) bool {
	if caller.PlatformAdmin {
		return true
	}
	callerRole, _ := memberRole(ctx, q, caller.UserID, gymID)
	return isSubset(permissions, callerRole.Permissions)
}

func keepAnAdmin(ctx context.Context, q querier, m membership, before role, after *role) error {
	if before.Name != adminRoleName || (after != nil && after.Name == adminRoleName) {
		return nil
	}
	others, err := otherAdminCount(ctx, q, m.Gym, m.ID)
	if err != nil {
		return err
	}
	if others == 0 {
		return httpx.NewError(http.StatusBadRequest, "A gym needs at least one admin.")
	}
	return nil
}

func adminRoleChangeAllowed(nameBefore, nameAfter string, permissionsBefore, permissionsAfter []string) bool {
	if nameBefore != adminRoleName {
		return true
	}
	return nameAfter == adminRoleName && isSubset(permissionsBefore, permissionsAfter)
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

func newInviteToken() string {
	b := make([]byte, inviteTokenLength)
	rand.Read(b)
	for i := range b {
		b[i] = tokenAlphabet[int(b[i])%len(tokenAlphabet)]
	}
	return string(b)
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
