package moderation

import (
	"context"
	"errors"
	"log/slog"
	"maps"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/mail"
)

const (
	permComments = "manage_comments"
	permReports  = "manage_reports"
)

// work is one moderation transaction plus what must happen to files and mail once it commits.
type work struct {
	tx     pgx.Tx
	copied []string
	drop   []string
	after  []func(context.Context)
}

func (m *module) inTx(ctx context.Context, fn func(w *work) error) error {
	w := &work{}
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		w.tx = tx
		return fn(w)
	})
	if err != nil {
		for _, key := range w.copied {
			m.app.Blob.Delete(ctx, key)
		}
		return err
	}
	for _, key := range w.drop {
		if err := m.app.Blob.Delete(ctx, key); err != nil {
			slog.Error("moderation: deleting file failed", "key", key, "error", err)
		}
	}
	for _, f := range w.after {
		f(ctx)
	}
	return nil
}

func (m *module) copyFile(ctx context.Context, w *work, from, to string) error {
	r, err := m.app.Blob.Open(ctx, from)
	if err != nil {
		return err
	}
	defer r.Close()
	if err := m.app.Blob.Put(ctx, to, r); err != nil {
		return err
	}
	w.copied = append(w.copied, to)
	return nil
}

func (m *module) save(ctx context.Context, w *work, it *Item) error {
	saved, err := updateItem(ctx, w.tx, *it)
	if err != nil {
		return err
	}
	*it = saved
	return publishItem(ctx, w.tx, "update", saved)
}

// queue opens or refreshes the case of a piece of content; createOnly leaves an existing case alone.
func (m *module) queue(ctx context.Context, w *work, kindName, contentID string, createOnly bool) (Item, error) {
	c, err := loadContent(ctx, w.tx, kindName, contentID)
	if err != nil {
		return Item{}, err
	}
	it, err := itemOf(ctx, w.tx, kindName, contentID)
	if errors.Is(err, httpx.ErrNotFound) {
		created, inserted, err := insertItem(ctx, w.tx, Item{
			ID: ids.New(), Gym: c.Gym, ContentType: kindName, ContentID: contentID, Author: c.Author, Snapshot: c.Snapshot, State: "unreviewed",
		})
		if err != nil {
			return created, err
		}
		if !inserted {
			return itemOf(ctx, w.tx, kindName, contentID)
		}
		return created, publishItem(ctx, w.tx, "create", created)
	}
	if err != nil || createOnly || it.State == "pending" {
		return it, err
	}
	if it.State == "hidden" {
		if kinds[kindName].fields == nil {
			return it, nil
		}
		// The author put new content in place of hidden content: that needs a fresh decision.
		w.drop = append(w.drop, "moderation_items/"+it.ID)
		it.Files, it.HiddenBy, it.Reason, it.ReviewedBy, it.ReviewedAt = nil, "", "", "", nil
	}
	it.Gym, it.Author, it.Snapshot, it.State = c.Gym, c.Author, c.Snapshot, "unreviewed"
	return it, m.save(ctx, w, &it)
}

func allowed(it Item, action string, platform, gymStaff bool) error {
	ok := false
	switch action {
	case "approve":
		ok = it.State == "unreviewed" || (it.State == "pending" && gymStaff)
	case "reject":
		ok = it.State == "pending" && gymStaff
	case "hide":
		ok = it.State == "unreviewed" || it.State == "approved" || (it.State == "pending" && platform)
	case "restore":
		ok = it.State == "hidden" && (it.HiddenBy != "platform" || platform)
	default:
		return badRequest("Unknown moderation action.")
	}
	if !ok {
		return httpx.NewError(http.StatusForbidden, "This action is not allowed on this item.")
	}
	return nil
}

func (m *module) apply(ctx context.Context, w *work, it *Item, action, reason string, platform bool, reviewer string) error {
	now := time.Now()
	it.ReviewedBy, it.ReviewedAt, it.Reason = reviewer, &now, truncate(reason, 2000)
	if it.Snapshot == nil {
		it.Snapshot = map[string]any{}
	}
	switch action {
	case "approve":
		if it.State == "pending" {
			if err := m.release(ctx, w, it); err != nil {
				return err
			}
			if err := publishTopic(ctx, w.tx, topicBetaCreated, map[string]any{
				"id": it.ContentID, "gym": it.Gym, "route": it.Snapshot["route"], "user": it.Author,
			}); err != nil {
				return err
			}
		}
		it.State = "approved"
		if err := m.save(ctx, w, it); err != nil {
			return err
		}
		return m.closeReports(ctx, w, it.ContentType, it.ContentID, "content_kept", it.Reason, reviewer)

	case "reject":
		if _, err := w.tx.Exec(ctx, `DELETE FROM moderation_items WHERE id = $1`, it.ID); err != nil {
			return err
		}
		w.drop = append(w.drop, "moderation_items/"+it.ID)
		return publishItem(ctx, w.tx, "delete", *it)

	case "hide":
		wasPending := it.State == "pending"
		it.State, it.HiddenBy = "hidden", "gym"
		if platform {
			it.HiddenBy = "platform"
		}
		if wasPending {
			it.Snapshot[pendingKey] = true
			return m.save(ctx, w, it)
		}
		if err := m.quarantine(ctx, w, it); err != nil {
			return err
		}
		if err := m.save(ctx, w, it); err != nil {
			return err
		}
		if err := m.closeReports(ctx, w, it.ContentType, it.ContentID, "content_removed", it.Reason, reviewer); err != nil {
			return err
		}
		return m.hideContent(ctx, w, it)

	case "restore":
		it.HiddenBy = ""
		if it.Snapshot[pendingKey] == true {
			delete(it.Snapshot, pendingKey)
			it.State = "pending"
			return m.save(ctx, w, it)
		}
		if err := m.release(ctx, w, it); err != nil {
			return err
		}
		it.State = "approved"
		if err := m.save(ctx, w, it); err != nil {
			return err
		}
		return publishContentChange(ctx, w.tx, KindContentRestored, *it)
	}
	return nil
}

// quarantine snapshots the content and copies its files into the case; the originals go once the hide commits.
func (m *module) quarantine(ctx context.Context, w *work, it *Item) error {
	k := kinds[it.ContentType]
	c, err := loadContent(ctx, w.tx, it.ContentType, it.ContentID)
	if errors.Is(err, httpx.ErrNotFound) {
		return badRequest("The content no longer exists.")
	}
	if err != nil {
		return err
	}
	quarantined := map[string][]string{}
	names := []string{}
	for _, field := range k.files {
		name, _ := c.Snapshot[field].(string)
		if name == "" {
			continue
		}
		original := k.table + "/" + it.ContentID + "/" + name
		if err := m.copyFile(ctx, w, original, "moderation_items/"+it.ID+"/"+name); err != nil {
			return err
		}
		w.drop = append(w.drop, original)
		quarantined[field] = []string{name}
		names = append(names, name)
	}
	c.Snapshot[filesKey] = quarantined
	it.Snapshot, it.Files = c.Snapshot, names
	return nil
}

func (m *module) hideContent(ctx context.Context, w *work, it *Item) error {
	k := kinds[it.ContentType]
	if k.fields == nil {
		var record map[string]any
		if err := w.tx.QueryRow(ctx, `DELETE FROM `+k.table+` t WHERE t.id = $1 RETURNING to_jsonb(t)`, it.ContentID).Scan(&record); err != nil {
			return err
		}
		w.drop = append(w.drop, k.table+"/"+it.ContentID)
		if err := m.publishGymChange(ctx, w.tx, it.ContentType, "delete", record); err != nil {
			return err
		}
	} else {
		if _, err := w.tx.Exec(ctx, `UPDATE `+k.table+` t SET `+k.hide+`, updated = now() WHERE t.id = $1`, it.ContentID); err != nil {
			return err
		}
		if it.ContentType == "route" {
			if err := m.publishGymChange(ctx, w.tx, "route", "update", map[string]any{"id": it.ContentID, "gym": it.Gym}); err != nil {
				return err
			}
			if err := publishRouteArchived(ctx, w.tx, it.ContentID, it.Gym); err != nil {
				return err
			}
		}
	}
	return publishContentChange(ctx, w.tx, KindContentHidden, *it)
}

// release puts quarantined content back (recreating whole rows under the same id) and settles the case on it.
func (m *module) release(ctx context.Context, w *work, it *Item) error {
	k := kinds[it.ContentType]
	values := maps.Clone(it.Snapshot)
	delete(values, filesKey)
	delete(values, pendingKey)
	quarantined, _ := it.Snapshot[filesKey].(map[string]any)
	for field, list := range quarantined {
		names, _ := list.([]any)
		for _, n := range names {
			name, _ := n.(string)
			if err := m.copyFile(ctx, w, "moderation_items/"+it.ID+"/"+name, k.table+"/"+it.ContentID+"/"+name); err != nil {
				return err
			}
			values[field] = name
		}
	}
	w.drop = append(w.drop, "moderation_items/"+it.ID)
	if k.fields == nil {
		now := time.Now()
		values["id"], values["created"], values["updated"] = it.ContentID, now, now
		if it.Author != "" {
			values[k.author] = it.Author
		}
		columns := make([]string, 0, len(values))
		for column := range values {
			columns = append(columns, `"`+column+`"`)
		}
		list := strings.Join(columns, ", ")
		if _, err := w.tx.Exec(ctx, `INSERT INTO `+k.table+` (`+list+`) SELECT `+list+` FROM jsonb_populate_record(NULL::`+k.table+`, $1)`, values); err != nil {
			slog.Warn("moderation: restoring content failed", "item", it.ID, "error", err)
			return badRequest("The content could not be restored.")
		}
	} else {
		sets := make([]string, 0, len(k.fields)+1)
		for _, f := range k.fields {
			sets = append(sets, `"`+f+`" = s."`+f+`"`)
		}
		if k.restore != "" {
			sets = append(sets, k.restore)
		}
		tag, err := w.tx.Exec(ctx, `UPDATE `+k.table+` t SET `+strings.Join(sets, ", ")+`, updated = now()
			FROM jsonb_populate_record(NULL::`+k.table+`, $2) s WHERE t.id = $1`, it.ContentID, values)
		if err != nil {
			slog.Warn("moderation: restoring content failed", "item", it.ID, "error", err)
			return badRequest("The content could not be restored.")
		}
		if tag.RowsAffected() == 0 {
			return badRequest("The content no longer exists.")
		}
	}
	fresh, err := loadContent(ctx, w.tx, it.ContentType, it.ContentID)
	if err != nil {
		return err
	}
	it.Snapshot, it.Files = fresh.Snapshot, nil
	return m.publishRestored(ctx, w, it, k)
}

func (m *module) publishRestored(ctx context.Context, w *work, it *Item, k kind) error {
	switch it.ContentType {
	case "route":
		return m.publishGymChange(ctx, w.tx, "route", "update", map[string]any{"id": it.ContentID, "gym": it.Gym})
	case "rating", "beta_video":
		var record map[string]any
		if err := w.tx.QueryRow(ctx, `SELECT to_jsonb(t) FROM `+k.table+` t WHERE t.id = $1`, it.ContentID).Scan(&record); err != nil {
			return err
		}
		return m.publishGymChange(ctx, w.tx, it.ContentType, "create", record)
	}
	return nil
}

// closeReports decides every open report on the content; the reporters get the DSA decision mail.
func (m *module) closeReports(ctx context.Context, w *work, contentType, contentID, decision, reason, reviewer string) error {
	status := "rejected"
	if decision == "content_removed" {
		status = "actioned"
	}
	reports, err := queryReports(ctx, w.tx, `UPDATE reports SET status = $3, decision = $4, decision_reason = $5, decided_at = now(),
		decided_by = NULLIF($6, ''), updated = now() WHERE content_type = $1 AND content_id = $2 AND status = 'open' RETURNING `+reportColumns,
		contentType, contentID, status, decision, reason, reviewer)
	if err != nil {
		return err
	}
	notification := "report_decided_kept"
	if decision == "content_removed" {
		notification = "report_decided_removed"
	}
	for _, report := range reports {
		staff, err := usersWith(ctx, w.tx, report.Gym, permReports)
		if err != nil {
			return err
		}
		staff = slices.DeleteFunc(staff, func(id string) bool { return id == reviewer })
		if err := publishNotify(ctx, w.tx, Notify{
			Type: notification, Users: staff, Gym: report.Gym, URL: gymPath(ctx, w.tx, report.Gym, "/manage/moderation"),
		}); err != nil {
			return err
		}
		w.after = append(w.after, func(ctx context.Context) { m.sendDecision(ctx, report) })
	}
	return nil
}

func (m *module) notifyAuthor(ctx context.Context, w *work, it Item, action string, wasPending bool) error {
	if it.Author == "" {
		return nil
	}
	n := Notify{Users: []string{it.Author}, Gym: it.Gym, URL: "/"}
	switch {
	case action == "hide":
		n.Type, n.Params = "content_hidden", map[string]any{"reason": truncate(it.Reason, 140)}
		w.after = append(w.after, func(ctx context.Context) { m.sendStatement(ctx, it.Author, []Item{it}) })
	case action == "approve" && wasPending:
		n.Type = "beta_approved"
		if route, ok := it.Snapshot["route"].(string); ok {
			n.URL = "/route?id=" + route + "#beta-" + it.ContentID
		}
	case action == "reject":
		n.Type, n.Params = "beta_rejected", map[string]any{"reason": truncate(it.Reason, 140)}
	default:
		return nil
	}
	return publishNotify(ctx, w.tx, n)
}

func publishRouteArchived(ctx context.Context, tx pgx.Tx, route, gym string) error {
	return publishTopic(ctx, tx, topicRouteArchived, map[string]string{"route": route, "gym": gym})
}

func (m *module) brand(ctx context.Context, gym string) mail.Brand {
	t := m.app.MailTemplates
	b := t.AppBrand()
	b.ReplyTo = contactEmail(ctx, m.app.DB, "")
	var name, slug, language, contact string
	if gym == "" || m.app.DB.QueryRow(ctx, `SELECT name, slug, language, contact_email FROM gyms WHERE id = $1`, gym).
		Scan(&name, &slug, &language, &contact) != nil {
		return b
	}
	b.Name, b.Subject, b.Language = name, name, language
	if contact != "" {
		b.ReplyTo = contact
	}
	b.ImprintURL, b.PrivacyURL = t.AppURL+"/"+slug+"/imprint", t.AppURL+"/"+slug+"/privacy"
	return b
}

func (m *module) send(ctx context.Context, gym string, content mail.Content, to []mail.Recipient) bool {
	if m.app.MailTemplates == nil {
		return false
	}
	sent, err := m.app.MailTemplates.Send(ctx, m.app.Mail, m.brand(ctx, gym), content, to)
	if err != nil {
		slog.Error("moderation: mail failed", "mail", content.Key, "error", err)
	}
	return sent
}

// sendStatement is the DSA statement of reasons to the author of hidden content.
func (m *module) sendStatement(ctx context.Context, authorID string, items []Item) {
	var email, firstname, language string
	if m.app.DB.QueryRow(ctx, `SELECT email, firstname, language FROM users WHERE id = $1`, authorID).Scan(&email, &firstname, &language) != nil || email == "" {
		return
	}
	first := items[0]
	detail := mail.Detail{Label: "content", ValueKey: "moderation.types." + first.ContentType}
	if len(items) > 1 {
		detail = mail.Detail{Label: "content", Value: strconv.Itoa(len(items))}
	}
	gym := first.Gym
	references := make([]string, len(items))
	for i, it := range items {
		references[i] = it.ID
		if it.Gym != gym {
			gym = ""
		}
	}
	details := []mail.Detail{detail, {Label: "reference", Value: truncate(strings.Join(references, ", "), 1000)}}
	if first.Reason != "" {
		details = append(details, mail.Detail{Label: "reasoning", Value: first.Reason})
	}
	m.send(ctx, gym, mail.Content{Key: "contentHidden", Name: firstname, Details: details, Outro: []string{"mails.reportDecision.redress"}},
		[]mail.Recipient{{Address: email, Language: language}})
}

func reasonDetail(report Report) mail.Detail {
	return mail.Detail{Label: "reason", ValueKey: "reports.reasons." + report.Reason, Value: report.Reason}
}

func notifier(report Report) []mail.Recipient {
	return []mail.Recipient{{Address: report.NotifierEmail, Language: report.Language}}
}

// sendReceipt is the Art. 16(4) receipt to the notifier plus the alert to the gym's report handlers.
func (m *module) sendReceipt(ctx context.Context, report Report) {
	receipt := mail.Content{Key: "reportReceipt", Details: []mail.Detail{reasonDetail(report), {Label: "reference", Value: report.ID}}}
	if m.send(ctx, report.Gym, receipt, notifier(report)) {
		m.app.DB.Exec(ctx, `UPDATE reports SET receipt_sent = true WHERE id = $1`, report.ID)
	}
	var to []mail.Recipient
	rows, err := m.app.DB.Query(ctx, `SELECT email, language FROM users WHERE email <> '' AND id IN (
		SELECT m."user" FROM memberships m JOIN roles r ON r.id = m.role WHERE m.gym = $1 AND $2 = ANY (r.permissions))`, report.Gym, permReports)
	if err == nil {
		to, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (mail.Recipient, error) {
			var r mail.Recipient
			return r, row.Scan(&r.Address, &r.Language)
		})
	}
	if err != nil {
		slog.Error("moderation: loading report handlers failed", "report", report.ID, "error", err)
	}
	contentURL := mail.AbsoluteURL(m.app.MailTemplates.AppURL, report.ContentURL)
	alert := mail.Content{
		Key: "reportAlert",
		Details: []mail.Detail{
			reasonDetail(report),
			{Label: "content", Value: contentURL, Link: contentURL},
			{Label: "explanation", Value: report.Explanation},
			{Label: "snapshot", Value: report.ContentSnapshot},
		},
		Action: gymPath(ctx, m.app.DB, report.Gym, "/manage/moderation"),
	}
	// The contact address is whatever manage_settings typed in; the notifier's identity stays with the report handlers.
	if contact := contactEmail(ctx, m.app.DB, report.Gym); contact != "" &&
		!slices.ContainsFunc(to, func(r mail.Recipient) bool { return strings.EqualFold(r.Address, contact) }) {
		m.send(ctx, report.Gym, alert, []mail.Recipient{{Address: contact}})
	}
	alert.Details = append(alert.Details, mail.Detail{Label: "reportedBy", Value: report.NotifierName + " (" + report.NotifierEmail + ")"})
	m.send(ctx, report.Gym, alert, to)
}

// sendDecision is the Art. 16(5) notice of the decision to the notifier.
func (m *module) sendDecision(ctx context.Context, report Report) {
	outcome := "mails.reportDecision.kept"
	if report.Decision == "content_removed" {
		outcome = "mails.reportDecision.removed"
	}
	details := []mail.Detail{{Label: "reference", Value: report.ID}}
	if report.DecisionReason != "" {
		details = append(details, mail.Detail{Label: "reasoning", Value: report.DecisionReason})
	}
	outro := []string{"mails.reportDecision.redress"}
	contact := contactEmail(ctx, m.app.DB, report.Gym)
	if contact != "" {
		outro = append(outro, "mails.reportDecision.redressContact")
	}
	content := mail.Content{
		Key: "reportDecision", Name: report.NotifierName, Params: map[string]any{"email": contact},
		Lines: []string{outcome}, Details: details, Outro: outro,
	}
	if m.send(ctx, report.Gym, content, notifier(report)) {
		m.app.DB.Exec(ctx, `UPDATE reports SET notified_at = now() WHERE id = $1`, report.ID)
	}
}

// dropContent follows a deletion by the owner: the open case goes, and reports on content that is gone are decided.
func (m *module) dropContent(ctx context.Context, kindName, contentID string) error {
	return m.inTx(ctx, func(w *work) error {
		it, err := itemOf(ctx, w.tx, kindName, contentID)
		// Our own hide also announces a deletion; content that is back (or never left) is not gone. Checked after the lock.
		if _, err := loadContent(ctx, w.tx, kindName, contentID); !errors.Is(err, httpx.ErrNotFound) {
			return err
		}
		if err == nil && !it.quarantined() {
			if _, err := w.tx.Exec(ctx, `DELETE FROM moderation_items WHERE id = $1`, it.ID); err != nil {
				return err
			}
			if err := publishItem(ctx, w.tx, "delete", it); err != nil {
				return err
			}
		} else if err != nil && !errors.Is(err, httpx.ErrNotFound) {
			return err
		}
		return m.closeReports(ctx, w, kindName, contentID, "content_removed", "", "")
	})
}

// rehide is the safety net behind the owning modules' guards: content they let show again while its case is hidden goes back.
func (m *module) rehide(ctx context.Context, kindName, contentID string) error {
	k := kinds[kindName]
	return m.inTx(ctx, func(w *work) error {
		it, err := itemOf(ctx, w.tx, kindName, contentID)
		if errors.Is(err, httpx.ErrNotFound) {
			return nil
		}
		if err != nil || it.State != "hidden" {
			return err
		}
		var current map[string]any
		err = w.tx.QueryRow(ctx, `SELECT to_jsonb(t) FROM `+k.table+` t WHERE t.id = $1 AND `+k.exposed+` FOR UPDATE`, contentID).Scan(&current)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		for _, field := range k.files {
			if name, _ := current[field].(string); name != "" {
				w.drop = append(w.drop, k.table+"/"+contentID+"/"+name)
			}
		}
		return m.hideContent(ctx, w, &it)
	})
}

// dropOrphans settles the cases of content a cascade took away (a deleted route takes its reviews, betas and tasks).
func (m *module) dropOrphans(ctx context.Context, gym string) error {
	for kindName, k := range kinds {
		if k.gym != "t.gym" {
			continue
		}
		rows, err := m.app.DB.Query(ctx, `SELECT content_id FROM moderation_items i WHERE i.gym = $1 AND i.content_type = $2
			AND NOT EXISTS (SELECT 1 FROM `+k.table+` t WHERE t.id = i.content_id)`, gym, kindName)
		if err != nil {
			return err
		}
		orphans, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		for _, id := range orphans {
			if err := m.dropContent(ctx, kindName, id); err != nil {
				return err
			}
		}
	}
	return nil
}

func (m *module) pruneQuarantine(ctx context.Context) error {
	rows, err := m.app.DB.Query(ctx, `DELETE FROM moderation_items WHERE id IN (SELECT id FROM moderation_items
		WHERE state = 'hidden' AND reviewed_at < now() - make_interval(days => $1) LIMIT 500) RETURNING id`, hiddenRetentionDays)
	if err != nil {
		return err
	}
	pruned, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	for _, id := range pruned {
		m.app.Blob.Delete(ctx, "moderation_items/"+id)
	}
	slog.Info("moderation: pruned expired quarantine", "rows", len(pruned))
	return nil
}

const hiddenRetentionDays = 180
