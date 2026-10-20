package members

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/blocklist"
	"gripello/internal/platform/db"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	platformmail "gripello/internal/platform/mail"
	"gripello/internal/platform/password"
	"gripello/internal/platform/tenancy"
)

func (h *handlers) listInvites(w http.ResponseWriter, r *http.Request) error {
	gymID := r.PathValue("gym")
	if err := h.perms.Require(r.Context(), gymID, tenancy.PermManageUsers); err != nil {
		return err
	}
	invites, err := listInvites(r.Context(), h.app.DB, gymID)
	return httpx.Respond(w, http.StatusOK, invites, err)
}

func (h *handlers) inviteMember(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	ctx := r.Context()
	gymID := r.PathValue("gym")
	if !h.perms.Has(ctx, gymID, tenancy.PermManageUsers) {
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
		Gym: gymID, Role: body.Role, Email: platformmail.NormalizeAddress(body.Email),
		Firstname: strings.TrimSpace(body.Firstname), Name: strings.TrimSpace(body.Name),
		ExpiresAt: time.Now().Add(inviteLifetime),
	}
	if !platformmail.ValidAddress(pending.Email) {
		return httpx.BadRequest("Invalid invitation.").Field("email", "validation_is_email", "Must be a valid email address.")
	}
	if blocked, err := blocklist.EmailBlocked(ctx, h.app.DB, pending.Email); err != nil {
		return err
	} else if blocked {
		return httpx.BadRequest("Invalid invitation.").Field("email", blocklist.CodeEmailBlocked, "This e-mail address can't be used.")
	}
	if utf8.RuneCountInString(pending.Firstname) > 100 || utf8.RuneCountInString(pending.Name) > 100 {
		return httpx.BadRequest("Invalid invitation.").Field("name", "validation_length_out_of_range", "Must be at most 100 characters.")
	}
	if userID, ok := userIDByEmail(ctx, h.app.DB, pending.Email); ok && isMember(ctx, h.app.DB, userID, gymID) {
		return httpx.NewError(http.StatusConflict, "This person is already a member.")
	}
	assigned, err := findRole(ctx, h.app.DB, body.Role)
	if err != nil || assigned.Gym != gymID {
		return httpx.BadRequest("The role does not belong to this gym.").Field("role", "validation_invalid_role", "The role does not belong to this gym.")
	}
	if !callerMayAssignRole(ctx, h.app.DB, p, assigned) {
		return httpx.NewError(http.StatusForbidden, "You cannot assign a role with permissions you do not hold.")
	}
	token := newInviteToken()
	err = h.inTx(ctx, func(tx pgx.Tx) error {
		if err := lockGym(ctx, tx, gymID); err != nil {
			return err
		}
		var existingRole string
		if err := tx.QueryRow(ctx, `SELECT role FROM invites WHERE gym = $1 AND email = $2`, gymID, pending.Email).Scan(&existingRole); err == nil {
			if !callerMayReplaceInvite(ctx, tx, p, existingRole) {
				return errInviteRoleTooHigh
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		id, inserted, err := upsertInvite(ctx, tx, ids.New(), pending, ids.Hash(token))
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

var errInviteRoleTooHigh = httpx.NewError(http.StatusForbidden, "This invitation is for a role with permissions you do not hold.")

func callerMayReplaceInvite(ctx context.Context, q db.Querier, caller auth.Principal, roleID string) bool {
	invited, err := findRole(ctx, q, roleID)
	return err == nil && callerMayAssignRole(ctx, q, caller, invited)
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
			return db.NotFound(err)
		}
		if !h.perms.Has(ctx, revoked.Gym, tenancy.PermManageUsers) {
			return httpx.ErrNotFound
		}
		if !callerMayReplaceInvite(ctx, tx, p, revoked.Role) {
			return errInviteRoleTooHigh
		}
		if _, err := tx.Exec(ctx, `DELETE FROM invites WHERE id = $1`, revoked.ID); err != nil {
			return err
		}
		return publishToGym(ctx, tx, p.UserID, revoked.Gym, KindInviteChanged, InviteChanged{Action: "deleted", ID: revoked.ID, Gym: revoked.Gym}, nil)
	})
	if err != nil {
		return err
	}
	return httpx.NoContent(w, nil)
}

func (h *handlers) showInvite(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	found, err := findInviteByTokenHash(ctx, h.app.DB, ids.Hash(r.PathValue("token")))
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
	invalid := httpx.BadRequest("The invitation could not be accepted.")
	if password.TooShort(body.Password) {
		invalid.Field("password", "validation_length_out_of_range", fmt.Sprintf("Must be at least %d characters.", password.MinLength))
	}
	if body.PasswordConfirm != body.Password {
		invalid.Field("passwordConfirm", "validation_values_mismatch", "Values don't match.")
	}
	for field, value := range map[string]string{"firstname": body.Firstname, "name": body.Name} {
		if utf8.RuneCountInString(strings.TrimSpace(value)) > 100 {
			invalid.Field(field, "validation_length_out_of_range", "Must be at most 100 characters.")
		}
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

func checkNewAccount(ctx context.Context, q db.Querier, account *newAccount) error {
	if blocked, err := blocklist.EmailBlocked(ctx, q, account.Email); err != nil {
		return err
	} else if blocked {
		return httpx.NewError(http.StatusForbidden, "This e-mail address can't be used.").Field("email", blocklist.CodeEmailBlocked, "This e-mail address can't be used.")
	}
	if protected, err := blocklist.NameProtected(ctx, q, account.Firstname+" "+account.Name); err != nil {
		return err
	} else if protected {
		return httpx.BadRequest("The invitation could not be accepted.").Field("name", blocklist.CodeNameProtected, "This name is reserved.")
	}
	return nil
}

func (h *handlers) acceptInvite(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	accepted, err := findInviteByTokenHash(ctx, h.app.DB, ids.Hash(r.PathValue("token")))
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
		if err := checkNewAccount(ctx, h.app.DB, account); err != nil {
			return err
		}
		hash, err := password.Hash(account.password)
		if err != nil {
			return err
		}
		account.password = hash
		userID = account.ID
	}
	err = h.inTx(ctx, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `DELETE FROM invites WHERE id = $1 AND token_hash = $2 AND expires_at > now() RETURNING role`,
			accepted.ID, ids.Hash(r.PathValue("token"))).Scan(&accepted.Role)
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.NewError(http.StatusNotFound, invalidInvite)
		}
		if err != nil {
			return err
		}
		changed := InviteChanged{Action: "accepted", ID: accepted.ID, Gym: accepted.Gym}
		if account != nil {
			_, err := tx.Exec(ctx, `INSERT INTO users (id, email, verified, password_hash, token_key, username, firstname, name)
				VALUES ($1, $2, true, $3, $4, $5, $6, $7)`,
				account.ID, account.Email, account.password, account.tokenKey, account.Username, account.Firstname, account.Name)
			if db.IsUnique(err, "") {
				return httpx.NewError(http.StatusConflict, "Sign in to accept this invitation.")
			}
			if err != nil {
				return err
			}
			changed.Users = []string{account.ID}
			account.sessionID = ids.New()
			_, err = tx.Exec(ctx, `INSERT INTO sessions (id, "user", method, user_agent, ip, last_seen) VALUES ($1, $2, 'invite', $3, $4, now())`,
				account.sessionID, account.ID, httpx.Truncate(r.UserAgent(), sessionUserAgentMax), httpx.ClientIP(r))
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
	result := map[string]any{"gym": tenancy.GymSlug(ctx, h.app.DB, accepted.Gym)}
	if account != nil {
		token, err := h.app.Tokens.Sign(account.ID, account.tokenKey, account.sessionID)
		if err != nil {
			return err
		}
		result["token"] = token
		result["record"] = account
	}
	return httpx.Respond(w, http.StatusOK, result, nil)
}
