package platformadmin

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/mail"
	"path"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	gmail "gripello/internal/platform/mail"
)

const (
	defaultPageSize = 50
	maxPageSize     = 200
	maxFileSize     = 5 << 20
	nameMax         = 5000
	reasonMax       = 2000
)

var (
	usernamePattern = regexp.MustCompile(`^[\w][\w.\-]*$`)
	languages       = []string{"", "en", "de", "nl", "fr", "es"}
	fileTypes       = map[string][]string{
		"avatar": {"image/jpeg", "image/png", "image/svg+xml", "image/gif", "image/webp"},
		"banner": {"image/jpeg", "image/png", "image/webp"},
	}
	thumbs = map[string][]string{"avatar": {"100x100"}, "banner": {"1600x400"}}
	// The user's own settings, rights and credentials never change through the platform tools.
	lockedFields = []string{"notification_prefs", "followed_walls", "leaderboard_hidden", "follow_policy", "reviews_anonymous", "ticks_private",
		"platform_admin", "suspended_until", "suspension_reason", "password", "password_hash", "token_key"}
	permanentSuspension = time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC)
	timeLayouts         = []string{time.RFC3339Nano, "2006-01-02 15:04:05.999Z07:00", "2006-01-02 15:04:05.999Z"}
)

const userJSON = `to_jsonb(u) - 'password_hash' - 'token_key' || jsonb_build_object('memberships', COALESCE(
	(SELECT jsonb_agg(jsonb_build_object('id', m.id, 'gym', m.gym, 'role', m.role) ORDER BY m.created) FROM memberships m WHERE m."user" = u.id), '[]'))`

type target struct {
	ID            string
	Email         string
	Firstname     string
	Language      string
	PlatformAdmin bool
}

// loadTarget refuses other platform admins: only they can change themselves.
func (m *module) loadTarget(r *http.Request, allowSelf bool) (target, error) {
	p, _ := auth.From(r.Context())
	var t target
	err := m.app.DB.QueryRow(r.Context(), `SELECT id, email, firstname, language, platform_admin FROM users WHERE id = $1`, r.PathValue("id")).
		Scan(&t.ID, &t.Email, &t.Firstname, &t.Language, &t.PlatformAdmin)
	if err != nil {
		return t, notFoundIfNoRows(err)
	}
	if t.ID == p.UserID && !allowSelf {
		return t, httpx.NewError(http.StatusForbidden, "You can't do this to your own account.")
	}
	if t.PlatformAdmin && t.ID != p.UserID {
		return t, httpx.NewError(http.StatusForbidden, "Platform admins can't change another platform admin.")
	}
	return t, nil
}

func (m *module) listUsers(w http.ResponseWriter, r *http.Request) error {
	params := r.URL.Query()
	where, args := []string{"TRUE"}, []any{}
	if term := strings.TrimSpace(params.Get("q")); term != "" {
		args = append(args, term)
		where = append(where, `(strpos(lower(u.email), lower($1)) > 0 OR strpos(lower(u.username), lower($1)) > 0
			OR strpos(lower(u.firstname), lower($1)) > 0 OR strpos(lower(u.name), lower($1)) > 0)`)
	}
	switch params.Get("filter") {
	case "":
	case "platform_admins":
		where = append(where, "u.platform_admin")
	case "unverified":
		where = append(where, "NOT u.verified")
	case "suspended":
		where = append(where, "u.suspended_until > now()")
	default:
		return httpx.NewError(http.StatusBadRequest, "Unknown filter.")
	}
	page := max(1, atoi(params.Get("page"), 1))
	limit := min(maxPageSize, max(1, atoi(params.Get("limit"), defaultPageSize)))
	paging := ` LIMIT ` + strconv.Itoa(limit) + ` OFFSET ` + strconv.Itoa((page-1)*limit)
	if params.Get("limit") == "0" {
		page, limit, paging = 1, 0, ""
	}
	from := ` FROM users u WHERE ` + strings.Join(where, " AND ")
	var total int
	if err := m.app.DB.QueryRow(r.Context(), `SELECT count(*)`+from, args...).Scan(&total); err != nil {
		return err
	}
	rows, err := m.app.DB.Query(r.Context(), `SELECT `+userJSON+from+` ORDER BY lower(u.email), u.id`+paging, args...)
	if err != nil {
		return err
	}
	items, err := pgx.CollectRows(rows, pgx.RowTo[json.RawMessage])
	if err != nil {
		return err
	}
	if items == nil {
		items = []json.RawMessage{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items, "page": page, "limit": limit, "total": total})
	return nil
}

func (m *module) getUser(w http.ResponseWriter, r *http.Request) error {
	var record json.RawMessage
	if err := m.app.DB.QueryRow(r.Context(), `SELECT `+userJSON+` FROM users u WHERE id = $1`, r.PathValue("id")).Scan(&record); err != nil {
		return notFoundIfNoRows(err)
	}
	httpx.JSON(w, http.StatusOK, record)
	return nil
}

// changeUser runs mutate in a transaction and sends user.updated (same payload as the account module, plus the actor).
func (m *module) changeUser(ctx context.Context, userID string, mutate func(tx pgx.Tx) error, record *json.RawMessage) error {
	p, _ := auth.From(ctx)
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		var before map[string]json.RawMessage
		if err := tx.QueryRow(ctx, `SELECT to_jsonb(u) - 'password_hash' - 'token_key' FROM users u WHERE id = $1 FOR UPDATE`, userID).Scan(&before); err != nil {
			return notFoundIfNoRows(err)
		}
		if err := mutate(tx); err != nil {
			return err
		}
		var own json.RawMessage
		if err := tx.QueryRow(ctx, `SELECT to_jsonb(u) - 'password_hash' - 'token_key', `+userJSON+` FROM users u WHERE id = $1`, userID).Scan(&own, record); err != nil {
			return err
		}
		var after map[string]json.RawMessage
		json.Unmarshal(own, &after)
		changed := []string{}
		for field, value := range after {
			if field != "updated" && string(before[field]) != string(value) {
				changed = append(changed, field)
			}
		}
		if len(changed) == 0 {
			return nil
		}
		slices.Sort(changed)
		payload := map[string]any{"record": own, "changed": changed, "actor": p.UserID}
		return events.PublishAs(ctx, tx, p.UserID, "user:"+userID, "user.updated", payload, events.Audience{Users: []string{userID}})
	})
}

func (m *module) updateUser(w http.ResponseWriter, r *http.Request) error {
	t, err := m.loadTarget(r, true)
	if err != nil {
		return err
	}
	body, files, err := readBody(w, r)
	if err != nil {
		return err
	}
	for _, field := range lockedFields {
		if _, ok := body[field]; ok {
			return httpx.NewError(http.StatusForbidden, "The field "+field+" can't be changed here.")
		}
	}
	changes, err := m.validate(r.Context(), t.ID, body)
	if err != nil {
		return err
	}
	var uploaded []string
	for field, header := range files {
		file, err := header.Open()
		if err != nil {
			return err
		}
		name, err := m.app.Blob.Upload(r.Context(), "users/"+t.ID+"/"+path.Base(header.Filename), file, fileTypes[field], maxFileSize)
		file.Close()
		if err != nil {
			m.deleteBlobs(r.Context(), t.ID, uploaded)
			return err
		}
		uploaded = append(uploaded, name)
		changes[field] = name
	}
	var previous map[string]string
	var record json.RawMessage
	err = m.changeUser(r.Context(), t.ID, func(tx pgx.Tx) error {
		previous = map[string]string{}
		var avatar, banner string
		if err := tx.QueryRow(r.Context(), `SELECT avatar, banner FROM users WHERE id = $1`, t.ID).Scan(&avatar, &banner); err != nil {
			return err
		}
		previous["avatar"], previous["banner"] = avatar, banner
		if email, ok := changes["email"]; ok && email != t.Email {
			changes["token_key"] = ids.New() + ids.New() + ids.New()
			p, _ := auth.From(r.Context())
			if err := revokeSessions(r.Context(), tx, p.UserID, t.ID); err != nil {
				return err
			}
		}
		return writeColumns(r.Context(), tx, t.ID, changes)
	}, &record)
	if err != nil {
		m.deleteBlobs(r.Context(), t.ID, uploaded)
		return err
	}
	for field := range files {
		m.app.Blob.WarmThumbs("users/"+t.ID+"/"+changes[field].(string), thumbs[field]...)
	}
	if _, rotated := changes["token_key"]; rotated && t.Email != "" {
		content := gmail.Content{Key: "emailChangedByAdmin", Name: t.Firstname, Params: map[string]any{"email": changes["email"]}}
		recipients := []gmail.Recipient{{Address: t.Email, Language: t.Language}}
		if _, err := m.app.MailTemplates.Send(r.Context(), m.app.Mail, m.app.MailTemplates.AppBrand(), content, recipients); err != nil {
			slog.Error("platformadmin: e-mail change notice failed", "user", t.ID, "error", err)
		}
	}
	for field, old := range previous {
		if replaced, ok := changes[field]; ok && old != "" && replaced != old {
			m.deleteBlobs(r.Context(), t.ID, []string{old})
		}
	}
	httpx.JSON(w, http.StatusOK, record)
	return nil
}

func (m *module) validate(ctx context.Context, userID string, body map[string]json.RawMessage) (map[string]any, error) {
	changes := map[string]any{}
	invalid := httpx.NewError(http.StatusBadRequest, "Failed to update record.")
	text := func(field string) (string, bool) {
		var s string
		if json.Unmarshal(body[field], &s) != nil {
			invalid.Field(field, "validation_invalid_value", "Must be a string.")
			return "", false
		}
		return strings.TrimSpace(s), true
	}
	if _, ok := body["username"]; ok {
		if s, ok := text("username"); ok {
			var taken bool
			if err := m.app.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE lower(username) = lower($1) AND id <> $2)`, s, userID).Scan(&taken); err != nil {
				return nil, err
			}
			switch n := utf8.RuneCountInString(s); {
			case n < 3 || n > 150:
				invalid.Field("username", "validation_length_out_of_range", "The length must be between 3 and 150.")
			case !usernamePattern.MatchString(s):
				invalid.Field("username", "validation_invalid_format", "Invalid value format.")
			case taken:
				invalid.Field("username", "validation_not_unique", "Value must be unique.")
			default:
				changes["username"] = s
			}
		}
	}
	for _, field := range []string{"firstname", "name"} {
		if _, ok := body[field]; ok {
			if s, ok := text(field); ok && utf8.RuneCountInString(s) > nameMax {
				invalid.Field(field, "validation_max_text_constraint", fmt.Sprintf("Must be no more than %d character(s).", nameMax))
			} else if ok {
				changes[field] = s
			}
		}
	}
	if _, ok := body["language"]; ok {
		if s, ok := text("language"); ok && !slices.Contains(languages, s) {
			invalid.Field("language", "validation_invalid_value", "Invalid value "+s+".")
		} else if ok {
			changes["language"] = s
		}
	}
	if _, ok := body["email"]; ok {
		if s, ok := text("email"); ok {
			s = strings.ToLower(s)
			var taken bool
			if err := m.app.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE email = $1 AND id <> $2)`, s, userID).Scan(&taken); err != nil {
				return nil, err
			}
			if address, err := mail.ParseAddress(s); err != nil || address.Address != s {
				invalid.Field("email", "validation_is_email", "Must be a valid email address.")
			} else if taken {
				invalid.Field("email", "validation_not_unique", "Value must be unique.")
			} else {
				changes["email"] = s
			}
		}
	}
	for _, field := range []string{"verified", "email_visibility"} {
		if raw, ok := body[field]; ok {
			var b bool
			if json.Unmarshal(raw, &b) != nil {
				invalid.Field(field, "validation_invalid_value", "Must be true or false.")
			} else {
				changes[field] = b
			}
		}
	}
	for field := range fileTypes {
		if raw, ok := body[field]; ok {
			if string(raw) != "null" && string(raw) != `""` {
				invalid.Field(field, "validation_invalid_value", "Files can only be uploaded or cleared.")
			} else {
				changes[field] = ""
			}
		}
	}
	if len(invalid.Data) > 0 {
		return nil, invalid
	}
	return changes, nil
}

// writeColumns only ever receives keys chosen by validate, never request keys.
func writeColumns(ctx context.Context, tx pgx.Tx, id string, changes map[string]any) error {
	if len(changes) == 0 {
		return nil
	}
	columns := make([]string, 0, len(changes))
	for column := range changes {
		columns = append(columns, column)
	}
	slices.Sort(columns)
	sets := make([]string, len(columns))
	args := []any{id}
	for i, column := range columns {
		args = append(args, changes[column])
		sets[i] = column + " = $" + strconv.Itoa(len(args))
	}
	_, err := tx.Exec(ctx, `UPDATE users SET `+strings.Join(sets, ", ")+` WHERE id = $1`, args...)
	return err
}

func readBody(w http.ResponseWriter, r *http.Request) (map[string]json.RawMessage, map[string]*multipart.FileHeader, error) {
	body := map[string]json.RawMessage{}
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		return body, nil, httpx.Decode(r, &body)
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2*maxFileSize+1<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		return nil, nil, httpx.NewError(http.StatusBadRequest, "Invalid multipart body.")
	}
	if payload := r.FormValue("@jsonPayload"); payload != "" {
		if err := json.Unmarshal([]byte(payload), &body); err != nil {
			return nil, nil, httpx.NewError(http.StatusBadRequest, "Invalid JSON body.")
		}
	}
	files := map[string]*multipart.FileHeader{}
	for name, headers := range r.MultipartForm.File {
		if _, ok := fileTypes[name]; ok && len(headers) > 0 {
			files[name] = headers[0]
		}
	}
	return body, files, nil
}

func (m *module) deleteBlobs(ctx context.Context, userID string, names []string) {
	for _, name := range names {
		m.deleteKey(ctx, "users/"+userID+"/"+name)
	}
}

func (m *module) deleteKey(ctx context.Context, key string) {
	if err := m.app.Blob.Delete(ctx, key); err != nil {
		slog.Warn("platformadmin: deleting file failed", "key", key, "error", err)
	}
}

func (m *module) deleteUser(w http.ResponseWriter, r *http.Request) error {
	t, err := m.loadTarget(r, true)
	if err != nil {
		return err
	}
	ctx := r.Context()
	var soleAdmin bool
	err = m.app.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM memberships m JOIN roles r ON r.id = m.role
		WHERE m."user" = $1 AND r.name = 'admin'
		AND NOT EXISTS (SELECT 1 FROM memberships o JOIN roles orole ON orole.id = o.role
		                WHERE o.gym = m.gym AND o."user" <> m."user" AND orole.name = 'admin'))`, t.ID).Scan(&soleAdmin)
	if err != nil {
		return err
	}
	if soleAdmin {
		return httpx.NewError(http.StatusBadRequest, "A gym needs at least one admin.")
	}
	p, _ := auth.From(ctx)
	var keys []string
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT 'beta_videos/' || id FROM beta_videos WHERE "user" = $1 AND file <> ''
			UNION ALL SELECT 'moderation_items/' || id FROM moderation_items WHERE author = $1 AND cardinality(files) > 0`, t.ID)
		if err != nil {
			return err
		}
		if keys, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
			return err
		}
		if err := revokeSessions(ctx, tx, p.UserID, t.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM users WHERE id = $1`, t.ID); err != nil {
			return err
		}
		return events.PublishAs(ctx, tx, p.UserID, "user:"+t.ID, "user.deleted", map[string]string{"id": t.ID, "actor": p.UserID}, events.Audience{Users: []string{t.ID}})
	})
	if err != nil {
		return err
	}
	for _, key := range append(keys, "users/"+t.ID) {
		m.deleteKey(ctx, key)
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// revokeSessions deletes the session rows and tells every replica to drop their realtime connections.
func revokeSessions(ctx context.Context, tx pgx.Tx, actor, userID string) error {
	rows, err := tx.Query(ctx, `DELETE FROM sessions WHERE "user" = $1 RETURNING id`, userID)
	if err != nil {
		return err
	}
	sessions, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	for _, id := range sessions {
		payload := map[string]string{"session": id, "user": userID}
		if err := events.PublishAs(ctx, tx, actor, "session.revoked", "session.revoked", payload, events.Audience{Users: []string{userID}}); err != nil {
			return err
		}
	}
	return nil
}

func (m *module) suspend(w http.ResponseWriter, r *http.Request) error {
	t, err := m.loadTarget(r, false)
	if err != nil {
		return err
	}
	var body struct {
		Until     string `json:"until"`
		Permanent bool   `json:"permanent"`
		Reason    string `json:"reason"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	until, ok := permanentSuspension, true
	if !body.Permanent {
		until, ok = parseTime(body.Until)
	}
	if !ok || !until.After(time.Now()) {
		return httpx.NewError(http.StatusBadRequest, "A suspension needs an end date in the future.").
			Field("until", "validation_invalid_date", "Must be a date in the future.")
	}
	reason := strings.TrimSpace(body.Reason)
	if runes := []rune(reason); len(runes) > reasonMax {
		reason = string(runes[:reasonMax])
	}
	var record json.RawMessage
	err = m.changeUser(r.Context(), t.ID, func(tx pgx.Tx) error {
		_, err := tx.Exec(r.Context(), `UPDATE users SET suspended_until = $2, suspension_reason = $3, token_key = $4 WHERE id = $1`,
			t.ID, until, reason, ids.New()+ids.New()+ids.New())
		if err != nil {
			return err
		}
		p, _ := auth.From(r.Context())
		return revokeSessions(r.Context(), tx, p.UserID, t.ID)
	}, &record)
	if err != nil {
		return err
	}
	if t.Email != "" {
		if err := m.sendSuspensionMail(r.Context(), t, until, reason); err != nil {
			slog.Error("platformadmin: suspension mail failed", "user", t.ID, "error", err)
		}
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (m *module) sendSuspensionMail(ctx context.Context, t target, until time.Time, reason string) error {
	details := []gmail.Detail{{Label: "until", Value: until.UTC().Format("2006-01-02 15:04 MST")}}
	if !until.Before(permanentSuspension) {
		details[0] = gmail.Detail{Label: "until", ValueKey: "platform.users.permanent"}
	}
	if reason != "" {
		details = append(details, gmail.Detail{Label: "reasoning", Value: reason})
	}
	content := gmail.Content{Key: "accountSuspended", Name: t.Firstname, Details: details, Outro: []string{"mails.reportDecision.redress"}}
	_, err := m.app.MailTemplates.Send(ctx, m.app.Mail, m.app.MailTemplates.AppBrand(), content, []gmail.Recipient{{Address: t.Email, Language: t.Language}})
	return err
}

func (m *module) liftSuspension(w http.ResponseWriter, r *http.Request) error {
	t, err := m.loadTarget(r, false)
	if err != nil {
		return err
	}
	var record json.RawMessage
	err = m.changeUser(r.Context(), t.ID, func(tx pgx.Tx) error {
		_, err := tx.Exec(r.Context(), `UPDATE users SET suspended_until = NULL, suspension_reason = '' WHERE id = $1`, t.ID)
		return err
	}, &record)
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func parseTime(value string) (time.Time, bool) {
	for _, layout := range timeLayouts {
		if at, err := time.Parse(layout, value); err == nil {
			return at, true
		}
	}
	return time.Time{}, false
}

func atoi(value string, fallback int) int {
	if n, err := strconv.Atoi(value); err == nil {
		return n
	}
	return fallback
}
