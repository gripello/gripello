package members

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"net"
	"net/http"
	"net/mail"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"

	"gripello/internal/platform"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/tenancy"
)

const invalidInvite = "This invitation is invalid or has expired."

type handlers struct {
	app   *platform.App
	perms *tenancy.Permissions
}

func notFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.ErrNotFound
	}
	return err
}

func pgCode(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}

func (h *handlers) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, h.app.DB, fn)
}

func (h *handlers) listMembers(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	gymID := r.PathValue("gym")
	if !canManageUsers(r.Context(), h.perms, p, gymID) {
		return httpx.ErrForbidden
	}
	params := r.URL.Query()
	query := memberQuery{Search: strings.TrimSpace(params.Get("q")), Role: params.Get("role"), Sort: params.Get("sort"), Page: 1}
	if _, ok := memberSorts[query.Sort]; !ok {
		return httpx.NewError(http.StatusBadRequest, "Unknown sort.").Field("sort", "validation_invalid_sort", "Unknown sort.")
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
	httpx.JSON(w, http.StatusOK, result)
	return nil
}

func (h *handlers) addMembership(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	ctx := r.Context()
	gymID := r.PathValue("gym")
	if !p.PlatformAdmin {
		return httpx.ErrForbidden
	}
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
			return httpx.NewError(http.StatusBadRequest, "The role does not belong to this gym.").Field("role", "validation_invalid_role", "The role does not belong to this gym.")
		}
		if !callerMayAssignRole(ctx, tx, p, assigned) {
			return httpx.NewError(http.StatusForbidden, "You cannot assign a role with permissions you do not hold.")
		}
		_, err = tx.Exec(ctx, `INSERT INTO memberships (id, "user", gym, role) VALUES ($1, $2, $3, $4)`, added.ID, added.User, gymID, assigned.ID)
		switch pgCode(err) {
		case "23505":
			return httpx.NewError(http.StatusConflict, "This person is already a member.")
		case "23503":
			return httpx.NewError(http.StatusBadRequest, "Unknown user.").Field("user", "validation_missing_rel_records", "Unknown user.")
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
	httpx.JSON(w, http.StatusOK, added)
	return nil
}

func (h *handlers) ownMemberships(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	memberships, err := listOwnMemberships(r.Context(), h.app.DB, p.UserID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, memberships)
	return nil
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
			return notFound(err)
		}
		if !canManageUsers(ctx, h.perms, p, m.Gym) {
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
			return httpx.NewError(http.StatusBadRequest, "The role does not belong to this gym.").Field("role", "validation_invalid_role", "The role does not belong to this gym.")
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
	httpx.JSON(w, http.StatusOK, m)
	return nil
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
			return notFound(err)
		}
		leaving := m.User == p.UserID
		if !leaving && !canManageUsers(ctx, h.perms, p, m.Gym) {
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
	w.WriteHeader(http.StatusNoContent)
	return nil
}

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
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	if !p.PlatformAdmin {
		return httpx.ErrForbidden
	}
	return h.writeRoles(w, r, "")
}

func (h *handlers) writeRoles(w http.ResponseWriter, r *http.Request, gymID string) error {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	roles, err := listRoles(r.Context(), h.app.DB, gymID, strings.TrimSpace(r.URL.Query().Get("q")), max(limit, 0))
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, roles)
	return nil
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
		return nil, httpx.NewError(http.StatusBadRequest, "Unknown permission.").Field("permissions", "validation_invalid_permission", "Unknown permission.")
	}
	return permissions, nil
}

func roleNameError(name string) error {
	if name == "" {
		return httpx.NewError(http.StatusBadRequest, "Name is required.").Field("name", "validation_required", "Cannot be blank.")
	}
	if strings.EqualFold(name, adminRoleName) {
		return httpx.NewError(http.StatusBadRequest, "A role with this name already exists.").Field("name", "validation_not_unique", "Value must be unique.")
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
	if !canManageUsers(ctx, h.perms, p, gymID) {
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
	if err := roleNameError(created.Name); err != nil {
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
	switch pgCode(err) {
	case "23505":
		return httpx.NewError(http.StatusBadRequest, "A role with this name already exists.").Field("name", "validation_not_unique", "Value must be unique.")
	case "23503":
		return httpx.ErrNotFound
	}
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, created)
	return nil
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
			return notFound(err)
		}
		if !canManageUsers(ctx, h.perms, p, before.Gym) {
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
	if pgCode(err) == "23505" {
		return httpx.NewError(http.StatusBadRequest, "A role with this name already exists.").Field("name", "validation_not_unique", "Value must be unique.")
	}
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, updated)
	return nil
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
			return notFound(err)
		}
		if !canManageUsers(ctx, h.perms, p, before.Gym) {
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
	httpx.JSON(w, http.StatusOK, updated)
	return nil
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
			return notFound(err)
		}
		if !canManageUsers(ctx, h.perms, p, deleted.Gym) {
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
	// PostgreSQL 18 reports ON DELETE RESTRICT violations as restrict_violation (23001) instead of 23503.
	if code := pgCode(err); code == "23503" || code == "23001" {
		return httpx.NewError(http.StatusConflict, "This role is still assigned to members. Give them another role first.")
	}
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *handlers) reassignHolders(ctx context.Context, tx pgx.Tx, p auth.Principal, from role, targetID string) error {
	to, err := findRole(ctx, tx, targetID)
	if err != nil || to.Gym != from.Gym || to.ID == from.ID {
		return httpx.NewError(http.StatusBadRequest, "The role does not belong to this gym.").Field("reassign_to", "validation_invalid_role", "The role does not belong to this gym.")
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

func (h *handlers) listInvites(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	gymID := r.PathValue("gym")
	if !canManageUsers(r.Context(), h.perms, p, gymID) {
		return httpx.ErrForbidden
	}
	invites, err := listInvites(r.Context(), h.app.DB, gymID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, invites)
	return nil
}

func (h *handlers) inviteMember(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	ctx := r.Context()
	gymID := r.PathValue("gym")
	if !canManageUsers(ctx, h.perms, p, gymID) {
		return httpx.NewError(http.StatusForbidden, "Inviting members requires manage_users.")
	}
	var body struct {
		Email     string `json:"email"`
		Role      string `json:"role"`
		Firstname string `json:"firstname"`
		Name      string `json:"name"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	pending := invite{
		Gym: gymID, Role: body.Role, Email: strings.ToLower(strings.TrimSpace(body.Email)),
		Firstname: strings.TrimSpace(body.Firstname), Name: strings.TrimSpace(body.Name),
		ExpiresAt: time.Now().Add(inviteLifetime),
	}
	if address, err := mail.ParseAddress(pending.Email); err != nil || address.Address != pending.Email {
		return httpx.NewError(http.StatusBadRequest, "Invalid invitation.").Field("email", "validation_is_email", "Must be a valid email address.")
	}
	if len(pending.Firstname) > 100 || len(pending.Name) > 100 {
		return httpx.NewError(http.StatusBadRequest, "Invalid invitation.").Field("name", "validation_length_out_of_range", "Must be at most 100 characters.")
	}
	if userID, ok := userIDByEmail(ctx, h.app.DB, pending.Email); ok && isMember(ctx, h.app.DB, userID, gymID) {
		return httpx.NewError(http.StatusConflict, "This person is already a member.")
	}
	assigned, err := findRole(ctx, h.app.DB, body.Role)
	if err != nil || assigned.Gym != gymID {
		return httpx.NewError(http.StatusBadRequest, "The role does not belong to this gym.").Field("role", "validation_invalid_role", "The role does not belong to this gym.")
	}
	if !callerMayAssignRole(ctx, h.app.DB, p, assigned) {
		return httpx.NewError(http.StatusForbidden, "You cannot assign a role with permissions you do not hold.")
	}
	token := newInviteToken()
	err = h.inTx(ctx, func(tx pgx.Tx) error {
		id, inserted, err := upsertInvite(ctx, tx, ids.New(), pending, hashToken(token))
		if err != nil {
			return err
		}
		action := "updated"
		if inserted {
			action = "created"
		}
		return publishToGym(ctx, tx, p.UserID, gymID, KindInviteChanged, InviteChanged{Action: action, ID: id, Gym: gymID}, nil)
	})
	if err != nil {
		return err
	}
	if err := h.sendInviteMail(ctx, pending, assigned.Name, token); err != nil {
		slog.Error("invites: mail failed", "gym", gymID, "error", err)
	}
	w.WriteHeader(http.StatusAccepted)
	return nil
}

// ponytail: plain English mail until the mail package renders the localized `invite` template.
func (h *handlers) sendInviteMail(ctx context.Context, pending invite, roleName, token string) error {
	if h.app.Mail == nil {
		return nil
	}
	var gymName string
	h.app.DB.QueryRow(ctx, `SELECT name FROM gyms WHERE id = $1`, pending.Gym).Scan(&gymName)
	link := strings.TrimRight(h.app.Cfg.AppURL, "/") + "/auth/invite/" + token
	text := fmt.Sprintf("%s invited you to join its team on Gripello as %s.\n\nAccept the invitation: %s\n", gymName, roleName, link)
	body := fmt.Sprintf(`<p>%s invited you to join its team on Gripello as %s.</p><p><a href="%s">Accept the invitation</a></p>`,
		html.EscapeString(gymName), html.EscapeString(roleName), html.EscapeString(link))
	return h.app.Mail.Send(ctx, pending.Email, "You're invited to join the team", body, text)
}

func (h *handlers) revokeInvite(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	ctx := r.Context()
	err = h.inTx(ctx, func(tx pgx.Tx) error {
		revoked, err := findInviteByID(ctx, tx, r.PathValue("id"))
		if err != nil {
			return notFound(err)
		}
		if !canManageUsers(ctx, h.perms, p, revoked.Gym) {
			return httpx.ErrNotFound
		}
		if _, err := tx.Exec(ctx, `DELETE FROM invites WHERE id = $1`, revoked.ID); err != nil {
			return err
		}
		return publishToGym(ctx, tx, p.UserID, revoked.Gym, KindInviteChanged, InviteChanged{Action: "deleted", ID: revoked.ID, Gym: revoked.Gym}, nil)
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *handlers) showInvite(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	found, err := findInviteByTokenHash(ctx, h.app.DB, hashToken(r.PathValue("token")))
	if err != nil {
		return httpx.NewError(http.StatusNotFound, invalidInvite)
	}
	var gym struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if err := h.app.DB.QueryRow(ctx, `SELECT name, slug FROM gyms WHERE id = $1`, found.Gym).Scan(&gym.Name, &gym.Slug); err != nil {
		return httpx.NewError(http.StatusNotFound, invalidInvite)
	}
	_, hasAccount := userIDByEmail(ctx, h.app.DB, found.Email)
	httpx.JSON(w, http.StatusOK, map[string]any{
		"email":      found.Email,
		"firstname":  found.Firstname,
		"name":       found.Name,
		"gym":        gym,
		"role":       found.RoleName,
		"hasAccount": hasAccount,
	})
	return nil
}

type newAccount struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Username  string `json:"username"`
	Firstname string `json:"firstname"`
	Name      string `json:"name"`
	Verified  bool   `json:"verified"`
	tokenKey  string
	password  string
	sessionID string
}

func newAccountFrom(r *http.Request, accepted invite) (*newAccount, error) {
	var body struct {
		Password        string `json:"password"`
		PasswordConfirm string `json:"passwordConfirm"`
		Firstname       string `json:"firstname"`
		Name            string `json:"name"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return nil, err
	}
	invalid := httpx.NewError(http.StatusBadRequest, "The invitation could not be accepted.")
	if n := len(body.Password); n < 8 || n > 71 {
		invalid.Field("password", "validation_length_out_of_range", "Must be between 8 and 71 characters.")
	}
	if body.PasswordConfirm != body.Password {
		invalid.Field("passwordConfirm", "validation_values_mismatch", "Values don't match.")
	}
	if len(invalid.Data) > 0 {
		return nil, invalid
	}
	account := &newAccount{
		ID: ids.New(), Email: accepted.Email, Username: "users" + ids.New()[:10], Verified: true,
		Firstname: cmp.Or(strings.TrimSpace(body.Firstname), accepted.Firstname),
		Name:      cmp.Or(strings.TrimSpace(body.Name), accepted.Name),
		tokenKey:  ids.New() + ids.New() + ids.New(), password: body.Password,
	}
	return account, nil
}

func (h *handlers) acceptInvite(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	accepted, err := findInviteByTokenHash(ctx, h.app.DB, hashToken(r.PathValue("token")))
	if err != nil {
		return httpx.NewError(http.StatusNotFound, invalidInvite)
	}
	p, signedIn := auth.From(ctx)
	var account *newAccount
	userID := p.UserID
	if signedIn {
		if !strings.EqualFold(userEmail(ctx, h.app.DB, p.UserID), accepted.Email) {
			return httpx.NewError(http.StatusForbidden, "This invitation is for another account.")
		}
	} else {
		if _, exists := userIDByEmail(ctx, h.app.DB, accepted.Email); exists {
			return httpx.NewError(http.StatusConflict, "Sign in to accept this invitation.")
		}
		if account, err = newAccountFrom(r, accepted); err != nil {
			return err
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(account.password), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		account.password = string(hash)
		userID = account.ID
	}
	err = h.inTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM invites WHERE id = $1`, accepted.ID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.NewError(http.StatusNotFound, invalidInvite)
		}
		changed := InviteChanged{Action: "accepted", ID: accepted.ID, Gym: accepted.Gym}
		if account != nil {
			_, err := tx.Exec(ctx, `INSERT INTO users (id, email, verified, password_hash, token_key, username, firstname, name)
				VALUES ($1, $2, true, $3, $4, $5, $6, $7)`,
				account.ID, account.Email, account.password, account.tokenKey, account.Username, account.Firstname, account.Name)
			if pgCode(err) == "23505" {
				return httpx.NewError(http.StatusConflict, "Sign in to accept this invitation.")
			}
			if err != nil {
				return err
			}
			changed.Users = []string{account.ID}
			account.sessionID = ids.New()
			_, err = tx.Exec(ctx, `INSERT INTO sessions (id, "user", method, user_agent, ip, last_seen) VALUES ($1, $2, 'invite', $3, $4, now())`,
				account.sessionID, account.ID, truncateRunes(r.UserAgent(), sessionUserAgentMax), clientIP(r))
			if err != nil {
				return err
			}
		}
		if err := publishToGym(ctx, tx, userID, accepted.Gym, KindInviteChanged, changed, nil); err != nil {
			return err
		}
		if isMember(ctx, tx, userID, accepted.Gym) {
			return nil
		}
		assigned, err := findRole(ctx, tx, accepted.Role)
		if err != nil {
			return err
		}
		membershipID := ids.New()
		_, err = tx.Exec(ctx, `INSERT INTO memberships (id, "user", gym, role) VALUES ($1, $2, $3, $4)`, membershipID, userID, accepted.Gym, assigned.ID)
		if err != nil {
			return err
		}
		return publishToGym(ctx, tx, userID, accepted.Gym, KindMembershipChanged, MembershipChanged{
			Action: "created", ID: membershipID, Gym: accepted.Gym, Users: []string{userID}, Role: assigned.ID,
			Added: assigned.Permissions, Removed: []string{},
		}, []string{userID})
	})
	if err != nil {
		return err
	}
	result := map[string]any{"gym": gymSlug(ctx, h.app.DB, accepted.Gym)}
	if account != nil {
		token, err := h.app.Tokens.Sign(account.ID, account.tokenKey, account.sessionID)
		if err != nil {
			return err
		}
		result["token"] = token
		result["record"] = account
	}
	httpx.JSON(w, http.StatusOK, result)
	return nil
}

// Mirrors authn: nginx sets X-Real-IP / X-Forwarded-For in front of every replica.
func clientIP(r *http.Request) string {
	raw := r.Header.Get("X-Real-IP")
	if raw == "" {
		raw, _, _ = strings.Cut(r.Header.Get("X-Forwarded-For"), ",")
	}
	if raw = strings.TrimSpace(raw); raw == "" {
		raw = r.RemoteAddr
		if host, _, err := net.SplitHostPort(raw); err == nil {
			raw = host
		}
	}
	if ip := net.ParseIP(raw); ip != nil {
		return ip.String()
	}
	return raw
}

func truncateRunes(s string, max int) string {
	if runes := []rune(s); len(runes) > max {
		return string(runes[:max])
	}
	return s
}
