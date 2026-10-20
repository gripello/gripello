package members

import (
	"cmp"
	"context"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/db"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/tenancy"
)

func (h *handlers) listRoles(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	gymID := r.PathValue("gym")
	if !canReadRoles(r.Context(), h.app.DB, p, gymID) {
		return httpx.ErrForbidden
	}
	return h.writeRoles(w, r, gymID)
}

func (h *handlers) listAllRoles(w http.ResponseWriter, r *http.Request) error {
	if _, err := auth.RequirePlatformAdmin(r.Context()); err != nil {
		return err
	}
	return h.writeRoles(w, r, "")
}

func (h *handlers) writeRoles(w http.ResponseWriter, r *http.Request, gymID string) error {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	roles, err := listRoles(r.Context(), h.app.DB, gymID, strings.TrimSpace(r.URL.Query().Get("q")), max(limit, 0))
	return httpx.Respond(w, http.StatusOK, roles, err)
}

func (h *handlers) validPermissions(ctx context.Context, permissions []string) ([]string, error) {
	permissions = slices.Compact(slices.Sorted(slices.Values(permissions)))
	if permissions == nil {
		permissions = []string{}
	}
	known, err := knownPermissions(ctx, h.app.DB, permissions)
	if err != nil {
		return nil, err
	}
	if !known {
		return nil, httpx.BadRequest("Unknown permission.").Field("permissions", "validation_invalid_permission", "Unknown permission.")
	}
	return permissions, nil
}

func roleFieldsError(r role) error {
	switch {
	case utf8.RuneCountInString(r.Name) > 50:
		return httpx.BadRequest("Name is too long.").Field("name", "validation_length_out_of_range", "Must be at most 50 characters.")
	case utf8.RuneCountInString(r.Description) > 200:
		return httpx.BadRequest("Description is too long.").Field("description", "validation_length_out_of_range", "Must be at most 200 characters.")
	case utf8.RuneCountInString(r.Color) > 50:
		return httpx.BadRequest("Invalid colour.").Field("color", "validation_length_out_of_range", "Must be at most 50 characters.")
	}
	return nil
}

func roleNameError(name string) error {
	if httpx.Blank(name) {
		return httpx.BadRequest("Name is required.").Field("name", "validation_required", "Cannot be blank.")
	}
	if strings.EqualFold(name, adminRoleName) {
		return httpx.BadRequest("A role with this name already exists.").Field("name", "validation_not_unique", "Value must be unique.")
	}
	return nil
}

func (h *handlers) createRole(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	ctx := r.Context()
	gymID := r.PathValue("gym")
	if !h.perms.Has(ctx, gymID, tenancy.PermManageUsers) {
		return httpx.ErrForbidden
	}
	var body struct {
		Name        string   `json:"name"`
		Description string   `json:"description"`
		Color       string   `json:"color"`
		Permissions []string `json:"permissions"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	created := role{ID: ids.New(), Gym: gymID, Name: strings.TrimSpace(body.Name), Description: body.Description, Color: body.Color}
	if err := cmp.Or(roleNameError(created.Name), roleFieldsError(created)); err != nil {
		return err
	}
	if created.Permissions, err = h.validPermissions(ctx, body.Permissions); err != nil {
		return err
	}
	if !callerHoldsPermissions(ctx, h.app.DB, p, gymID, created.Permissions) {
		return httpx.NewError(http.StatusForbidden, "You cannot grant permissions you do not hold.")
	}
	err = h.inTx(ctx, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `INSERT INTO roles (id, gym, name, description, permissions, color) VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING created, updated`, created.ID, created.Gym, created.Name, created.Description, created.Permissions, created.Color).
			Scan(&created.Created, &created.Updated)
		if err != nil {
			return err
		}
		return publishToGym(ctx, tx, p.UserID, gymID, KindRoleChanged, RoleChanged{
			Action: "created", ID: created.ID, Gym: gymID, Users: []string{}, Added: created.Permissions, Removed: []string{},
		}, nil)
	})
	switch {
	case db.IsUnique(err, ""):
		return httpx.BadRequest("A role with this name already exists.").Field("name", "validation_not_unique", "Value must be unique.")
	case db.IsFKViolation(err):
		return httpx.ErrNotFound
	}
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, created, nil)
}

func (h *handlers) updateRole(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	var body struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
		Color       *string `json:"color"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	ctx := r.Context()
	var updated role
	err = h.inTx(ctx, func(tx pgx.Tx) error {
		before, err := findRole(ctx, tx, r.PathValue("id"))
		if err != nil {
			return db.NotFound(err)
		}
		if !h.perms.Has(ctx, before.Gym, tenancy.PermManageUsers) {
			return httpx.ErrForbidden
		}
		if !callerMayAssignRole(ctx, tx, p, before) {
			return httpx.NewError(http.StatusForbidden, "You cannot edit a role with permissions you do not hold.")
		}
		updated = before
		if body.Name != nil {
			updated.Name = strings.TrimSpace(*body.Name)
		}
		if body.Description != nil {
			updated.Description = *body.Description
		}
		if body.Color != nil {
			updated.Color = *body.Color
		}
		if updated.Name != before.Name {
			if err := roleNameError(updated.Name); err != nil {
				return err
			}
		}
		if err := roleFieldsError(updated); err != nil {
			return err
		}
		if !adminRoleChangeAllowed(before.Name, updated.Name, before.Permissions, updated.Permissions) {
			return httpx.NewError(http.StatusForbidden, "The admin role cannot be renamed or lose permissions.")
		}
		err = tx.QueryRow(ctx, `UPDATE roles SET name = $2, description = $3, color = $4 WHERE id = $1 RETURNING updated`,
			updated.ID, updated.Name, updated.Description, updated.Color).Scan(&updated.Updated)
		if err != nil {
			return err
		}
		users, err := roleMemberIDs(ctx, tx, updated.ID)
		if err != nil {
			return err
		}
		return publishToGym(ctx, tx, p.UserID, updated.Gym, KindRoleChanged, RoleChanged{
			Action: "updated", ID: updated.ID, Gym: updated.Gym, Users: users, Added: []string{}, Removed: []string{},
		}, users)
	})
	if db.IsUnique(err, "") {
		return httpx.BadRequest("A role with this name already exists.").Field("name", "validation_not_unique", "Value must be unique.")
	}
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, updated, nil)
}

func (h *handlers) setRolePermissions(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	var body struct {
		Permissions []string `json:"permissions"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	ctx := r.Context()
	permissions, err := h.validPermissions(ctx, body.Permissions)
	if err != nil {
		return err
	}
	var updated role
	err = h.inTx(ctx, func(tx pgx.Tx) error {
		before, err := findRole(ctx, tx, r.PathValue("id"))
		if err != nil {
			return db.NotFound(err)
		}
		if !h.perms.Has(ctx, before.Gym, tenancy.PermManageUsers) {
			return httpx.ErrForbidden
		}
		if !adminRoleChangeAllowed(before.Name, before.Name, before.Permissions, permissions) {
			return httpx.NewError(http.StatusForbidden, "The admin role cannot be renamed or lose permissions.")
		}
		added, removed := addedPermissions(before.Permissions, permissions), addedPermissions(permissions, before.Permissions)
		if !callerHoldsPermissions(ctx, tx, p, before.Gym, append(slices.Clone(added), removed...)) {
			return httpx.NewError(http.StatusForbidden, "You cannot grant or revoke permissions you do not hold.")
		}
		updated = before
		updated.Permissions = permissions
		err = tx.QueryRow(ctx, `UPDATE roles SET permissions = $2 WHERE id = $1 RETURNING updated`, updated.ID, permissions).Scan(&updated.Updated)
		if err != nil {
			return err
		}
		users, err := roleMemberIDs(ctx, tx, updated.ID)
		if err != nil {
			return err
		}
		return publishToGym(ctx, tx, p.UserID, updated.Gym, KindRoleChanged, RoleChanged{
			Action: "updated", ID: updated.ID, Gym: updated.Gym, Users: users, Added: added, Removed: removed,
		}, users)
	})
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, updated, nil)
}

func (h *handlers) deleteRole(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	ctx := r.Context()
	err = h.inTx(ctx, func(tx pgx.Tx) error {
		deleted, err := findRole(ctx, tx, r.PathValue("id"))
		if err != nil {
			return db.NotFound(err)
		}
		if !h.perms.Has(ctx, deleted.Gym, tenancy.PermManageUsers) {
			return httpx.ErrForbidden
		}
		if deleted.Name == adminRoleName {
			return httpx.NewError(http.StatusForbidden, "The admin role cannot be deleted.")
		}
		if !callerMayAssignRole(ctx, tx, p, deleted) {
			return httpx.NewError(http.StatusForbidden, "You cannot delete a role with permissions you do not hold.")
		}
		if target := r.URL.Query().Get("reassign_to"); target != "" {
			if err := h.reassignHolders(ctx, tx, p, deleted, target); err != nil {
				return err
			}
		}
		rows, err := tx.Query(ctx, `DELETE FROM invites WHERE role = $1 RETURNING id`, deleted.ID)
		if err != nil {
			return err
		}
		invites, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM roles WHERE id = $1`, deleted.ID); err != nil {
			return err
		}
		for _, id := range invites {
			if err := publishToGym(ctx, tx, p.UserID, deleted.Gym, KindInviteChanged, InviteChanged{Action: "deleted", ID: id, Gym: deleted.Gym}, nil); err != nil {
				return err
			}
		}
		return publishToGym(ctx, tx, p.UserID, deleted.Gym, KindRoleChanged, RoleChanged{
			Action: "deleted", ID: deleted.ID, Gym: deleted.Gym, Users: []string{}, Added: []string{}, Removed: deleted.Permissions,
		}, nil)
	})
	if db.IsFKViolation(err) {
		return httpx.NewError(http.StatusConflict, "This role is still assigned to members. Give them another role first.")
	}
	if err != nil {
		return err
	}
	return httpx.NoContent(w, nil)
}

func (h *handlers) reassignHolders(ctx context.Context, tx pgx.Tx, p auth.Principal, from role, targetID string) error {
	to, err := findRole(ctx, tx, targetID)
	if err != nil || to.Gym != from.Gym || to.ID == from.ID {
		return httpx.BadRequest("The role does not belong to this gym.").Field("reassign_to", "validation_invalid_role", "The role does not belong to this gym.")
	}
	if !callerMayAssignRole(ctx, tx, p, from) || !callerMayAssignRole(ctx, tx, p, to) {
		return httpx.NewError(http.StatusForbidden, "You cannot assign a role with permissions you do not hold.")
	}
	rows, err := tx.Query(ctx, `UPDATE memberships SET role = $2 WHERE role = $1 RETURNING id, "user"`, from.ID, to.ID)
	if err != nil {
		return err
	}
	moved, err := pgx.CollectRows(rows, pgx.RowToStructByPos[struct{ ID, User string }])
	if err != nil {
		return err
	}
	added, removed := addedPermissions(from.Permissions, to.Permissions), addedPermissions(to.Permissions, from.Permissions)
	for _, m := range moved {
		err := publishToGym(ctx, tx, p.UserID, from.Gym, KindMembershipChanged, MembershipChanged{
			Action: "updated", ID: m.ID, Gym: from.Gym, Users: []string{m.User}, Role: to.ID, PreviousRole: from.ID,
			Added: added, Removed: removed,
		}, []string{m.User})
		if err != nil {
			return err
		}
	}
	return nil
}
