package account

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"mime/multipart"
	"net/http"
	"path"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/blob"
	"gripello/internal/platform/blocklist"
	"gripello/internal/platform/climbers"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/jobs"
	"gripello/internal/platform/locales"
	"gripello/internal/platform/lockout"
	"gripello/internal/platform/password"
)

const (
	maxFileSize          = 5 << 20
	nameMax              = 5000
	notificationPrefsMax = 4000
	followedWallsMax     = 999
)

var (
	usernamePattern = regexp.MustCompile(`^[\w][\w.\-]*$`)
	followPolicies  = []string{"", "approve", "open", "closed"}
	fileTypes       = map[string][]string{
		"avatar": {"image/jpeg", "image/png", "image/svg+xml", "image/gif", "image/webp"},
		"banner": {"image/jpeg", "image/png", "image/webp"},
	}
	// Credentials, verification and suspension change only through their own flows (authn, platform admin).
	serverOwnedFields = []string{"platform_admin", "verified", "email", "suspended_until", "suspension_reason", "password", "password_hash", "token_key"}
	profileFields     = map[string]string{
		"username":           "username",
		"firstname":          "text",
		"name":               "text",
		"email_visibility":   "bool",
		"language":           "language",
		"notification_prefs": "json",
		"followed_walls":     "walls",
		"leaderboard_hidden": "bool",
		"follow_policy":      "policy",
		"reviews_anonymous":  "bool",
		"ticks_private":      "bool",
		"avatar":             "file",
		"banner":             "file",
	}
)

func (m *module) getMe(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	record, err := climbers.OwnRecord(r.Context(), m.db, p.UserID)
	if err == nil && r.URL.Query().Get("include") == "memberships" {
		record, err = withMemberships(r.Context(), m.db, p.UserID, record)
	}
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, record, nil)
}

func (m *module) updateMe(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	body, files, err := httpx.ReadBody(w, r, 2*maxFileSize+1<<20, fileTypes)
	if err != nil {
		return err
	}
	for _, field := range serverOwnedFields {
		if _, ok := body[field]; ok {
			return httpx.NewError(http.StatusForbidden, "The field "+field+" can't be changed here.")
		}
	}
	changes, err := m.validateProfile(r, p.UserID, body)
	if err != nil {
		return err
	}
	return m.saveProfile(w, r, p.UserID, changes, files)
}

func (m *module) validateProfile(r *http.Request, userID string, body map[string]json.RawMessage) (map[string]any, error) {
	ctx := r.Context()
	changes := map[string]any{}
	invalid := httpx.BadRequest("Failed to update record.")
	for field, kind := range profileFields {
		raw, ok := body[field]
		if !ok {
			continue
		}
		fail := func(code, message string) { invalid.Field(field, code, message) }
		switch kind {
		case "username", "text", "language", "policy":
			var s string
			if json.Unmarshal(raw, &s) != nil {
				fail("validation_invalid_value", "Must be a string.")
				continue
			}
			s = strings.TrimSpace(s)
			switch {
			case kind == "username" && (utf8.RuneCountInString(s) < 3 || utf8.RuneCountInString(s) > 150):
				fail("validation_length_out_of_range", "The length must be between 3 and 150.")
			case kind == "username" && !usernamePattern.MatchString(s):
				fail("validation_invalid_format", "Invalid value format.")
			case kind == "text" && utf8.RuneCountInString(s) > nameMax:
				fail("validation_max_text_constraint", fmt.Sprintf("Must be no more than %d character(s).", nameMax))
			case kind == "language" && !locales.Allowed(s), kind == "policy" && !slices.Contains(followPolicies, s):
				fail("validation_invalid_value", "Invalid value "+s+".")
			default:
				if kind == "username" {
					if taken, err := usernameTaken(ctx, m.db, s, userID); err != nil {
						return nil, err
					} else if taken {
						fail("validation_not_unique", "Value must be unique.")
						continue
					}
				}
				changes[field] = s
			}
		case "bool":
			var b bool
			if json.Unmarshal(raw, &b) != nil {
				fail("validation_invalid_value", "Must be true or false.")
				continue
			}
			changes[field] = b
		case "json":
			if len(raw) > notificationPrefsMax {
				fail("validation_json_size_limit", fmt.Sprintf("The maximum allowed JSON size is %d bytes.", notificationPrefsMax))
				continue
			}
			var prefs map[string]map[string]bool
			if string(raw) != "null" && json.Unmarshal(raw, &prefs) != nil {
				fail("validation_invalid_value", "Must map channels to topics and true/false.")
				continue
			}
			if prefs == nil {
				changes[field] = nil
			} else {
				changes[field] = raw
			}
		case "walls":
			walls := []string{}
			if string(raw) != "null" && json.Unmarshal(raw, &walls) != nil {
				fail("validation_invalid_value", "Must be a list of wall ids.")
				continue
			}
			slices.Sort(walls)
			walls = slices.Compact(walls)
			if len(walls) > followedWallsMax {
				fail("validation_too_many_values", fmt.Sprintf("Select no more than %d.", followedWallsMax))
				continue
			}
			existing, err := existingWalls(ctx, m.db, walls)
			if err != nil {
				return nil, err
			}
			changes[field] = existing
		case "file":
			if string(raw) != "null" && string(raw) != `""` {
				fail("validation_invalid_value", "Files can only be uploaded or cleared.")
				continue
			}
			changes[field] = ""
		}
	}
	if err := m.checkProtectedNames(ctx, userID, changes, invalid); err != nil {
		return nil, err
	}
	if len(invalid.Data) > 0 {
		return nil, invalid
	}
	return changes, nil
}

// checkProtectedNames only looks at names that change, so a name that predates the list doesn't block other edits.
func (m *module) checkProtectedNames(ctx context.Context, userID string, changes map[string]any, invalid *httpx.Error) error {
	if !slices.ContainsFunc([]string{"username", "firstname", "name"}, func(field string) bool { _, ok := changes[field]; return ok }) {
		return nil
	}
	var username, firstname, name string
	if err := m.db.QueryRow(ctx, `SELECT username, firstname, name FROM users WHERE id = $1`, userID).Scan(&username, &firstname, &name); err != nil {
		return err
	}
	next := map[string]string{"username": username, "firstname": firstname, "name": name}
	for field := range next {
		if value, ok := changes[field].(string); ok {
			next[field] = value
		}
	}
	if next["username"] != username {
		if protected, err := blocklist.NameProtected(ctx, m.db, next["username"]); err != nil {
			return err
		} else if protected {
			invalid.Field("username", blocklist.CodeNameProtected, "This name is reserved.")
		}
	}
	if next["firstname"] != firstname || next["name"] != name {
		if protected, err := blocklist.NameProtected(ctx, m.db, next["firstname"]+" "+next["name"]); err != nil {
			return err
		} else if protected {
			invalid.Field("name", blocklist.CodeNameProtected, "This name is reserved.")
		}
	}
	return nil
}

// saveProfile stores uploads first, writes the row with the user.updated event, then drops replaced files.
func (m *module) saveProfile(w http.ResponseWriter, r *http.Request, userID string, changes map[string]any, files map[string]*multipart.FileHeader) error {
	ctx := r.Context()
	var uploaded []string
	for field, header := range files {
		file, err := header.Open()
		if err != nil {
			return err
		}
		name, err := m.blob.Upload(ctx, blobKey(userID, path.Base(header.Filename)), file, fileTypes[field], maxFileSize)
		file.Close()
		if err != nil {
			m.deleteBlobs(r, userID, uploaded)
			return err
		}
		uploaded = append(uploaded, name)
		changes[field] = name
	}
	var previous struct{ avatar, banner string }
	record, err := m.writeProfile(ctx, userID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT avatar, banner FROM users WHERE id = $1`, userID).Scan(&previous.avatar, &previous.banner); err != nil {
			return err
		}
		return updateUser(ctx, tx, userID, changes)
	})
	if err != nil {
		m.deleteBlobs(r, userID, uploaded)
		return err
	}
	for field := range files {
		m.blob.WarmThumbs(blobKey(userID, changes[field].(string)), blob.UserThumbs[field]...)
	}
	for field, old := range map[string]string{"avatar": previous.avatar, "banner": previous.banner} {
		if replaced, ok := changes[field]; ok && old != "" && replaced != old {
			m.deleteBlobs(r, userID, []string{old})
		}
	}
	return httpx.Respond(w, http.StatusOK, record, nil)
}

func (m *module) clearFile(field string) httpx.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		p, err := auth.Require(r.Context())
		if err != nil {
			return err
		}
		return m.saveProfile(w, r, p.UserID, map[string]any{field: ""}, nil)
	}
}

func blobKey(userID, name string) string { return "users/" + userID + "/" + name }

func (m *module) deleteBlobs(r *http.Request, userID string, names []string) {
	for _, name := range names {
		if err := m.blob.Delete(r.Context(), blobKey(userID, name)); err != nil {
			slog.Warn("account: deleting file failed", "user", userID, "file", name, "error", err)
		}
	}
}

// writeProfile locks the row, applies update and publishes user.updated with the fields that really changed.
func (m *module) writeProfile(ctx context.Context, userID string, update func(tx pgx.Tx) error) (record json.RawMessage, err error) {
	err = pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, userID); err != nil {
			return err
		}
		before, err := climbers.OwnRecord(ctx, tx, userID)
		if err != nil {
			return err
		}
		if err := update(tx); err != nil {
			return err
		}
		if record, err = climbers.OwnRecord(ctx, tx, userID); err != nil {
			return err
		}
		if changed := events.ChangedFields(before, record, climbers.DerivedUserFields...); len(changed) > 0 {
			return climbers.PublishUserUpdated(ctx, tx, "", userID, record, changed)
		}
		return nil
	})
	return record, err
}

func (m *module) followWall(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	ctx, wall := r.Context(), r.PathValue("wall")
	if existing, err := existingWalls(ctx, m.db, []string{wall}); err != nil {
		return err
	} else if len(existing) == 0 {
		return httpx.ErrNotFound
	}
	record, err := m.writeProfile(ctx, p.UserID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE users SET followed_walls = array_append(followed_walls, $2) WHERE id = $1 AND NOT ($2 = ANY (followed_walls))`, p.UserID, wall)
		return err
	})
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, record, nil)
}

func (m *module) unfollowWall(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	ctx := r.Context()
	record, err := m.writeProfile(ctx, p.UserID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE users SET followed_walls = array_remove(followed_walls, $2) WHERE id = $1`, p.UserID, r.PathValue("wall"))
		return err
	})
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, record, nil)
}

func (m *module) deleteMe(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	ctx := r.Context()
	var hash string
	if err := m.db.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1`, p.UserID).Scan(&hash); err != nil {
		return err
	}
	if hash == "" {
		if lockout.IsLocked(ctx, m.db, p.UserID) {
			return lockout.ErrLocked
		}
		return httpx.BadRequest("Set a password first.").Field("password", "password_required", "Set a password first.")
	}
	if err := lockout.Reserve(ctx, m.db, p.UserID); err != nil {
		return err
	}
	if !password.Matches(hash, body.Password) {
		if _, err := lockout.Failed(ctx, m.db, p.UserID); err != nil {
			return err
		}
		return httpx.BadRequest("Failed to validate.").Field("password", "validation_invalid_password", "Missing or invalid password.")
	}
	if err := lockout.Release(ctx, m.db, p.UserID); err != nil {
		return err
	}
	var betas, moderated []string
	err = pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT 1 FROM gyms WHERE id IN (SELECT gym FROM memberships WHERE "user" = $1) ORDER BY id FOR UPDATE`, p.UserID); err != nil {
			return err
		}
		gyms, err := soleAdminOf(ctx, tx, p.UserID)
		if err != nil {
			return err
		}
		if len(gyms) > 0 {
			return httpx.BadRequest("A gym needs at least one admin.").Field("gym", "validation_last_admin", "A gym needs at least one admin.")
		}
		sessions, err := idsOf(ctx, tx, `SELECT id FROM sessions WHERE "user" = $1`, p.UserID)
		if err != nil {
			return err
		}
		if betas, err = idsOf(ctx, tx, `SELECT id FROM beta_videos WHERE "user" = $1 AND file <> ''`, p.UserID); err != nil {
			return err
		}
		if moderated, err = idsOf(ctx, tx, `SELECT id FROM moderation_items WHERE author = $1 AND cardinality(files) > 0`, p.UserID); err != nil {
			return err
		}
		announceRemoved, err := climbers.AnnounceDeletion(ctx, tx, p.UserID, p.UserID)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM users WHERE id = $1`, p.UserID); err != nil {
			return err
		}
		if err := announceRemoved(); err != nil {
			return err
		}
		if err := publishSessionsRevoked(ctx, tx, p.UserID, sessions); err != nil {
			return err
		}
		return events.PublishAs(ctx, tx, p.UserID, userTopic(p.UserID), KindUserDeleted, UserDeleted{ID: p.UserID}, events.Audience{Users: []string{p.UserID}})
	})
	if err != nil {
		return err
	}
	keys := []string{"users/" + p.UserID}
	for _, id := range betas {
		keys = append(keys, "beta_videos/"+id)
	}
	for _, id := range moderated {
		keys = append(keys, "moderation_items/"+id)
	}
	for _, key := range keys {
		if err := m.blob.Delete(ctx, key); err != nil {
			slog.Warn("account: deleting files of a deleted account failed", "key", key, "error", err)
		}
	}
	return httpx.NoContent(w, nil)
}

func (m *module) contributions(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	reviews, betas, err := ownContributions(r.Context(), m.db, p.UserID)
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, map[string]any{"reviews": reviews, "betas": betas}, nil)
}

func (m *module) requestExport(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	if !m.exportLimit.allow(p.UserID, time.Now()) {
		w.Header().Set("Retry-After", "3600")
		return httpx.NewError(http.StatusTooManyRequests, "Too many requests.")
	}
	if err := jobs.Enqueue(r.Context(), m.db, exportJob, p.UserID, nil, 0); err != nil {
		return err
	}
	w.WriteHeader(http.StatusAccepted)
	return nil
}
