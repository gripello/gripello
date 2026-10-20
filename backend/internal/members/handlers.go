package members

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/db"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/tenancy"
)

const invalidInvite = "This invitation is invalid or has expired."

type handlers struct {
	app   *platform.App
	perms *tenancy.Permissions
}

func (h *handlers) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, h.app.DB, fn)
}

func (h *handlers) listMembers(w http.ResponseWriter, r *http.Request) error {
	gymID := r.PathValue("gym")
	if err := h.perms.Require(r.Context(), gymID, tenancy.PermManageUsers); err != nil {
		return err
	}
	params := r.URL.Query()
	query := memberQuery{Search: strings.TrimSpace(params.Get("q")), Role: params.Get("role"), Sort: params.Get("sort"), Page: 1}
	if _, ok := memberSorts[query.Sort]; !ok {
		return httpx.BadRequest("Unknown sort.").Field("sort", "validation_invalid_sort", "Unknown sort.")
	}
	if page, err := strconv.Atoi(params.Get("page")); err == nil && page > 0 {
		query.Page = page
	}
	if limit, err := strconv.Atoi(params.Get("limit")); err == nil && limit > 0 {
		query.Limit = min(limit, 500)
	}
	members, err := listMembers(r.Context(), h.app.DB, gymID, query)
	if err != nil {
		return err
	}
	result := map[string]any{"items": members, "page": query.Page, "limit": query.Limit}
	if params.Get("total") == "true" {
		if result["total"], err = countMembers(r.Context(), h.app.DB, gymID, query); err != nil {
			return err
		}
	}
	return httpx.Respond(w, http.StatusOK, result, nil)
}

func (h *handlers) addMembership(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.RequirePlatformAdmin(r.Context())
	if err != nil {
		return err
	}
	ctx := r.Context()
	gymID := r.PathValue("gym")
	var body struct {
		User string `json:"user"`
		Role string `json:"role"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	added := membership{ID: ids.New(), User: body.User, Gym: gymID, Role: body.Role}
	err = h.inTx(ctx, func(tx pgx.Tx) error {
		assigned, err := findRole(ctx, tx, body.Role)
		if err != nil || assigned.Gym != gymID {
			return httpx.BadRequest("The role does not belong to this gym.").Field("role", "validation_invalid_role", "The role does not belong to this gym.")
		}
		if !callerMayAssignRole(ctx, tx, p, assigned) {
			return httpx.NewError(http.StatusForbidden, "You cannot assign a role with permissions you do not hold.")
		}
		_, err = tx.Exec(ctx, `INSERT INTO memberships (id, "user", gym, role) VALUES ($1, $2, $3, $4)`, added.ID, added.User, gymID, assigned.ID)
		switch {
		case db.IsUnique(err, ""):
			return httpx.NewError(http.StatusConflict, "This person is already a member.")
		case db.IsFKViolation(err):
			return httpx.BadRequest("Unknown user.").Field("user", "validation_missing_rel_records", "Unknown user.")
		}
		if err != nil {
			return err
		}
		return publishToGym(ctx, tx, p.UserID, gymID, KindMembershipChanged, MembershipChanged{
			Action: "created", ID: added.ID, Gym: gymID, Users: []string{added.User}, Role: assigned.ID,
			Added: assigned.Permissions, Removed: []string{},
		}, []string{added.User})
	})
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, added, nil)
}

func (h *handlers) ownMemberships(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	memberships, err := listOwnMemberships(r.Context(), h.app.DB, p.UserID)
	return httpx.Respond(w, http.StatusOK, memberships, err)
}

func (h *handlers) changeRole(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	var body struct {
		Role string `json:"role"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	ctx := r.Context()
	var m membership
	err = h.inTx(ctx, func(tx pgx.Tx) error {
		if m, err = findMembership(ctx, tx, r.PathValue("id")); err != nil {
			return db.NotFound(err)
		}
		if !h.perms.Has(ctx, m.Gym, tenancy.PermManageUsers) {
			if m.User == p.UserID {
				return httpx.ErrForbidden
			}
			return httpx.ErrNotFound
		}
		if m, err = lockedMembership(ctx, tx, m); err != nil {
			return err
		}
		after, err := findRole(ctx, tx, body.Role)
		if err != nil || after.Gym != m.Gym {
			return httpx.BadRequest("The role does not belong to this gym.").Field("role", "validation_invalid_role", "The role does not belong to this gym.")
		}
		if !callerMayAssignRole(ctx, tx, p, after) {
			return httpx.NewError(http.StatusForbidden, "You cannot assign a role with permissions you do not hold.")
		}
		before, err := findRole(ctx, tx, m.Role)
		if err != nil {
			return err
		}
		if !callerMayAssignRole(ctx, tx, p, before) {
			return httpx.NewError(http.StatusForbidden, "You cannot change the role of a member with permissions you do not hold.")
		}
		if err := keepAnAdmin(ctx, tx, m, before, &after); err != nil {
			return err
		}
		if before.ID == after.ID {
			return nil
		}
		if _, err := tx.Exec(ctx, `UPDATE memberships SET role = $2 WHERE id = $1`, m.ID, after.ID); err != nil {
			return err
		}
		m.Role = after.ID
		return publishToGym(ctx, tx, p.UserID, m.Gym, KindMembershipChanged, MembershipChanged{
			Action: "updated", ID: m.ID, Gym: m.Gym, Users: []string{m.User}, Role: after.ID, PreviousRole: before.ID,
			Added: addedPermissions(before.Permissions, after.Permissions), Removed: addedPermissions(after.Permissions, before.Permissions),
		}, []string{m.User})
	})
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, m, nil)
}

func (h *handlers) deleteMembership(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	ctx := r.Context()
	err = h.inTx(ctx, func(tx pgx.Tx) error {
		m, err := findMembership(ctx, tx, r.PathValue("id"))
		if err != nil {
			return db.NotFound(err)
		}
		leaving := m.User == p.UserID
		if !leaving && !h.perms.Has(ctx, m.Gym, tenancy.PermManageUsers) {
			return httpx.ErrNotFound
		}
		if m, err = lockedMembership(ctx, tx, m); err != nil {
			return err
		}
		before, err := findRole(ctx, tx, m.Role)
		if err != nil {
			return err
		}
		if !leaving && !callerMayAssignRole(ctx, tx, p, before) {
			return httpx.NewError(http.StatusForbidden, "You cannot remove a member with permissions you do not hold.")
		}
		if err := keepAnAdmin(ctx, tx, m, before, nil); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM memberships WHERE id = $1`, m.ID); err != nil {
			return err
		}
		return publishToGym(ctx, tx, p.UserID, m.Gym, KindMembershipChanged, MembershipChanged{
			Action: "deleted", ID: m.ID, Gym: m.Gym, Users: []string{m.User}, PreviousRole: before.ID,
			Added: []string{}, Removed: before.Permissions,
		}, []string{m.User})
	})
	if err != nil {
		return err
	}
	return httpx.NoContent(w, nil)
}
