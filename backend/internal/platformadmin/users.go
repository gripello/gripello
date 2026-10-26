package platformadmin

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"path"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/apitime"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/blob"
	"gripello/internal/platform/climbers"
	"gripello/internal/platform/db"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/locales"
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
	fileTypes       = map[string][]string{
		"avatar": {"image/jpeg", "image/png", "image/svg+xml", "image/gif", "image/webp"},
		"banner": {"image/jpeg", "image/png", "image/webp"},
	}
	// The user's own settings, rights and credentials never change through the platform tools.
	lockedFields = []string{"notification_prefs", "followed_walls", "leaderboard_hidden", "follow_policy", "reviews_anonymous", "ticks_private",
		"platform_admin", "suspended_until", "suspension_reason", "password", "password_hash", "token_key"}
	permanentSuspension = time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC)
)

const userJSON = climbers.OwnRecordSQL + ` || jsonb_build_object('memberships', COALESCE(
	(SELECT jsonb_agg(jsonb_build_object('id', m.id, 'gym', m.gym, 'role', m.role) ORDER BY m.created) FROM memberships m WHERE m."user" = u.id), '[]'),
	'mfa_enabled', EXISTS (SELECT 1 FROM mfa_factors f WHERE f."user" = u.id),
	'session_count', (SELECT count(*) FROM sessions s WHERE s."user" = u.id),
	'last_seen', ` + lastSeenSQL + `,
	'locked_until', (SELECT l.locked_until FROM login_lockouts l WHERE l.key = u.id AND l.locked_until > now()))`

const lastSeenSQL = `(SELECT max(greatest(s.last_seen, s.streamed_at)) FROM sessions s WHERE s."user" = u.id)`

const (
	isStaffSQL = `EXISTS (SELECT 1 FROM memberships m WHERE m."user" = u.id)`
	noMfaSQL   = `NOT EXISTS (SELECT 1 FROM mfa_factors f WHERE f."user" = u.id)`
)

var userFilters = map[string]string{
	"platform_admins": `u.platform_admin`,
	"unverified":      `NOT u.verified`,
	"suspended":       `u.suspended_until > now()`,
	"locked":          `EXISTS (SELECT 1 FROM login_lockouts l WHERE l.key = u.id AND l.locked_until > now())`,
	"no_mfa":          noMfaSQL,
	"staff":           isStaffSQL,
	"staff_no_mfa":    isStaffSQL + ` AND ` + noMfaSQL,
	"active":          lastSeenSQL + ` > now() - interval '7 days'`,
	"online":          lastSeenSQL + ` > now() - interval '2 minutes'`,
}

var userSorts = map[string]string{
	"":           `lower(u.email), u.id`,
	"email":      `lower(u.email), u.id`,
	"-email":     `lower(u.email) DESC, u.id`,
	"created":    `u.created, u.id`,
	"-created":   `u.created DESC, u.id`,
	"last_seen":  lastSeenSQL + ` ASC NULLS FIRST, u.id`,
	"-last_seen": lastSeenSQL + ` DESC NULLS LAST, u.id`,
	"status":     statusRankSQL + `, lower(u.email), u.id`,
	"-status":    statusRankSQL + ` DESC, lower(u.email), u.id`,
	"gyms":       gymCountSQL + `, lower(u.email), u.id`,
	"-gyms":      gymCountSQL + ` DESC, lower(u.email), u.id`,
	"mfa":        `NOT ` + noMfaSQL + `, lower(u.email), u.id`,
	"-mfa":       `NOT ` + noMfaSQL + ` DESC, lower(u.email), u.id`,
}

const (
	statusRankSQL = `(CASE WHEN u.suspended_until > now() THEN 0 WHEN EXISTS (SELECT 1 FROM login_lockouts l WHERE l.key = u.id AND l.locked_until > now()) THEN 1 WHEN NOT u.verified THEN 2 WHEN u.platform_admin THEN 3 ELSE 4 END)`
	gymCountSQL   = `(SELECT count(*) FROM memberships m WHERE m."user" = u.id)`
)

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
		return t, db.NotFound(err)
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
		args = append(args, db.WordPatterns(term))
		where = append(where, `NOT EXISTS (SELECT 1 FROM unnest($1::text[]) w
			WHERE NOT (u.email ILIKE w OR u.username ILIKE w OR u.firstname ILIKE w OR u.name ILIKE w))`)
	}
	if filter := params.Get("filter"); filter != "" {
		cond, ok := userFilters[filter]
		if !ok {
			return httpx.BadRequest("Unknown filter.")
		}
		where = append(where, cond)
	}
	if gym := params.Get("gym"); gym != "" {
		args = append(args, gym)
		where = append(where, fmt.Sprintf(`EXISTS (SELECT 1 FROM memberships m WHERE m."user" = u.id AND m.gym = $%d)`, len(args)))
	}
	order, ok := userSorts[params.Get("sort")]
	if !ok {
		return httpx.BadRequest("Unknown sort.")
	}
	page := httpx.Page(r, defaultPageSize, maxPageSize)
	paging := page.SQL()
	if params.Get("limit") == "0" {
		page, paging = httpx.Paging{Page: 1}, ""
	}
	from := ` FROM users u WHERE ` + strings.Join(where, " AND ")
	var total int
	if err := m.app.DB.QueryRow(r.Context(), `SELECT count(*)`+from, args...).Scan(&total); err != nil {
		return err
	}
	rows, err := m.app.DB.Query(r.Context(), `SELECT `+userJSON+from+` ORDER BY `+order+paging, args...)
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
	return httpx.Respond(w, http.StatusOK, httpx.PageOf[json.RawMessage]{Items: items, Page: page.Page, Limit: page.Limit, Total: &total}, nil)
}

func (m *module) userSummary(w http.ResponseWriter, r *http.Request) error {
	var summary json.RawMessage
	err := m.app.DB.QueryRow(r.Context(), `SELECT jsonb_build_object(
		'total', count(*),
		'new_7d', count(*) FILTER (WHERE u.created > now() - interval '7 days'),
		'active_7d', count(*) FILTER (WHERE `+userFilters["active"]+`),
		'online', count(*) FILTER (WHERE `+userFilters["online"]+`),
		'unverified', count(*) FILTER (WHERE `+userFilters["unverified"]+`),
		'unverified_old', count(*) FILTER (WHERE `+userFilters["unverified"]+` AND u.created < now() - interval '48 hours'),
		'suspended', count(*) FILTER (WHERE `+userFilters["suspended"]+`),
		'locked', count(*) FILTER (WHERE `+userFilters["locked"]+`),
		'platform_admins', count(*) FILTER (WHERE `+userFilters["platform_admins"]+`),
		'staff', count(*) FILTER (WHERE `+userFilters["staff"]+`),
		'staff_no_mfa', count(*) FILTER (WHERE `+userFilters["staff_no_mfa"]+`)) FROM users u`).Scan(&summary)
	return httpx.Respond(w, http.StatusOK, summary, err)
}

func (m *module) getUser(w http.ResponseWriter, r *http.Request) error {
	var record json.RawMessage
	if err := m.app.DB.QueryRow(r.Context(), `SELECT `+userJSON+` || jsonb_build_object(
		'ticks_count', (SELECT count(*) FROM ticks t WHERE t."user" = u.id),
		'ratings_count', (SELECT count(*) FROM ratings ra WHERE ra."user" = u.id)) FROM users u WHERE id = $1`, r.PathValue("id")).Scan(&record); err != nil {
		return db.NotFound(err)
	}
	return httpx.Respond(w, http.StatusOK, record, nil)
}

// changeUser runs mutate on a locked user row and publishes the change; lockFirst runs before that lock,
// so callers that lock several users can take them in one fixed order.
func (m *module) changeUser(ctx context.Context, userID string, mutate func(tx pgx.Tx) error, record *json.RawMessage, lockFirst ...func(tx pgx.Tx) error) error {
	p, _ := auth.From(ctx)
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		for _, lock := range lockFirst {
			if err := lock(tx); err != nil {
				return err
			}
		}
		var before map[string]json.RawMessage
		if err := tx.QueryRow(ctx, `SELECT `+climbers.OwnRecordSQL+` FROM users u WHERE id = $1 FOR UPDATE`, userID).Scan(&before); err != nil {
			return db.NotFound(err)
		}
		if err := mutate(tx); err != nil {
			return err
		}
		var own json.RawMessage
		if err := tx.QueryRow(ctx, `SELECT `+climbers.OwnRecordSQL+`, `+userJSON+` FROM users u WHERE id = $1`, userID).Scan(&own, record); err != nil {
			return err
		}
		changed := events.ChangedFields(before, own, climbers.DerivedUserFields...)
		if len(changed) == 0 {
			return nil
		}
		return climbers.PublishUserUpdated(ctx, tx, p.UserID, userID, own, changed)
	})
}

func (m *module) updateUser(w http.ResponseWriter, r *http.Request) error {
	t, err := m.loadTarget(r, true)
	if err != nil {
		return err
	}
	body, files, err := httpx.ReadBody(w, r, 2*maxFileSize+1<<20, fileTypes)
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
	if email, ok := changes["email"]; ok && email != t.Email {
		if p, _ := auth.From(r.Context()); t.ID == p.UserID {
			return httpx.NewError(http.StatusForbidden, "Change your own e-mail on the account page.").
				Field("email", "validation_own_email", "Change your own e-mail on the account page.")
		}
		if err := auth.RequireCallerReauth(r.Context(), m.app.DB); err != nil {
			return err
		}
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
		m.app.Blob.WarmThumbs("users/"+t.ID+"/"+changes[field].(string), blob.UserThumbs[field]...)
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
	return httpx.Respond(w, http.StatusOK, record, nil)
}

func (m *module) validate(ctx context.Context, userID string, body map[string]json.RawMessage) (map[string]any, error) {
	changes := map[string]any{}
	invalid := httpx.BadRequest("Failed to update record.")
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
		if s, ok := text("language"); ok && !locales.Allowed(s) {
			invalid.Field("language", "validation_invalid_value", "Invalid value "+s+".")
		} else if ok {
			changes["language"] = s
		}
	}
	if _, ok := body["email"]; ok {
		if s, ok := text("email"); ok {
			s = gmail.NormalizeAddress(s)
			var taken bool
			if err := m.app.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE email = $1 AND id <> $2)`, s, userID).Scan(&taken); err != nil {
				return nil, err
			}
			if !gmail.ValidAddress(s) {
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
	t, err := m.loadTarget(r, false)
	if err != nil {
		return err
	}
	if err := auth.RequireCallerReauth(r.Context(), m.app.DB); err != nil {
		return err
	}
	ctx := r.Context()
	p, _ := auth.From(ctx)
	var keys []string
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		// Locked like membership changes lock them, so two deletes can't each leave the other as the last admin.
		if _, err := tx.Exec(ctx, `SELECT 1 FROM gyms WHERE id IN (SELECT gym FROM memberships WHERE "user" = $1) ORDER BY id FOR UPDATE`, t.ID); err != nil {
			return err
		}
		var soleAdmin bool
		err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM memberships m JOIN roles r ON r.id = m.role
			WHERE m."user" = $1 AND r.name = 'admin'
			AND NOT EXISTS (SELECT 1 FROM memberships o JOIN roles orole ON orole.id = o.role
			                WHERE o.gym = m.gym AND o."user" <> m."user" AND orole.name = 'admin'))`, t.ID).Scan(&soleAdmin)
		if err != nil {
			return err
		}
		if soleAdmin {
			return httpx.BadRequest("A gym needs at least one admin.")
		}
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
		announceRemoved, err := climbers.AnnounceDeletion(ctx, tx, p.UserID, t.ID)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM users WHERE id = $1`, t.ID); err != nil {
			return err
		}
		if err := announceRemoved(); err != nil {
			return err
		}
		return events.PublishAs(ctx, tx, p.UserID, "user:"+t.ID, "user.deleted", map[string]string{"id": t.ID}, events.Audience{Users: []string{t.ID}})
	})
	if err != nil {
		return err
	}
	for _, key := range append(keys, "users/"+t.ID) {
		m.deleteKey(ctx, key)
	}
	return httpx.NoContent(w, nil)
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
	if err := auth.RequireCallerReauth(r.Context(), m.app.DB); err != nil {
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
		var err error
		until, err = apitime.Parse(body.Until)
		ok = err == nil
	}
	if !ok || !until.After(time.Now()) {
		return httpx.BadRequest("A suspension needs an end date in the future.").
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
	return httpx.NoContent(w, nil)
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
	return httpx.NoContent(w, nil)
}
