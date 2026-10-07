package hooks

import (
	"errors"
	"io"
	"net/http"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"sync"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/pocketbase/pocketbase/tools/types"
)

const quarantinedFilesKey = "_files"
const pendingKey = "_pending"
const hiddenRetentionDays = 180

type moderatedKind struct {
	collection  string
	authorField string
	// fields lists what is snapshotted and cleared on hide; nil keeps the whole record and deletes it on hide.
	fields []string
	hide   func(record *core.Record)
	queued func(app core.App, record *core.Record, changed []string) bool
}

var moderatedKinds = map[string]moderatedKind{
	"rating": {
		collection:  "ratings",
		authorField: "user",
		queued: func(_ core.App, record *core.Record, changed []string) bool {
			return record.GetString("comment") != "" && slices.Contains(changed, "comment")
		},
	},
	"beta_video": {
		collection:  "beta_videos",
		authorField: "user",
		queued:      func(_ core.App, _ *core.Record, changed []string) bool { return len(changed) > 0 },
	},
	"route": {
		collection: "routes",
		fields:     []string{"name", "comment", "archived"},
		hide:       func(route *core.Record) { route.Set("archived", true) },
		queued:     func(core.App, *core.Record, []string) bool { return false },
	},
	"profile": {
		collection:  "users",
		authorField: "id",
		fields:      []string{"username", "firstname", "name", "avatar", "banner"},
		hide: func(user *core.Record) {
			user.Set("username", "climber_"+user.Id)
			for _, field := range []string{"firstname", "name", "avatar", "banner"} {
				user.Set(field, nil)
			}
		},
		queued: func(_ core.App, _ *core.Record, changed []string) bool { return len(changed) > 0 },
	},
	"competition_entry": {
		collection:  "competition_entries",
		authorField: "user",
		fields:      []string{"display_name", "hidden"},
		hide:        func(entry *core.Record) { entry.Set("hidden", true) },
		queued: func(_ core.App, _ *core.Record, changed []string) bool {
			return slices.Contains(changed, "display_name")
		},
	},
	"task": {
		collection:  "tasks",
		authorField: "reporter",
		fields:      []string{"description", "photo"},
		hide: func(task *core.Record) {
			task.Set("description", "")
			task.Set("photo", nil)
		},
		queued: func(app core.App, task *core.Record, changed []string) bool {
			reporter := task.GetString("reporter")
			climberWrote := reporter == "" || !hasPermission(app, reporter, task.GetString("gym"), "manage_tasks")
			return climberWrote && len(changed) > 0 && (task.GetString("description") != "" || task.GetString("photo") != "")
		},
	},
}

func registerModeration(app core.App) {
	for kindName, kind := range moderatedKinds {
		app.OnRecordCreate(kind.collection).BindFunc(func(e *core.RecordEvent) error {
			if err := e.Next(); err != nil {
				return err
			}
			queueQuietly(e.App, kindName, e.Record, filledFields(kind, e.Record))
			return nil
		})
		app.OnRecordUpdate(kind.collection).BindFunc(func(e *core.RecordEvent) error {
			changed := changedModeratedFields(kind, e.Record)
			if err := e.Next(); err != nil {
				return err
			}
			queueQuietly(e.App, kindName, e.Record, changed)
			return nil
		})
		app.OnRecordAfterDeleteSuccess(kind.collection).BindFunc(func(e *core.RecordEvent) error {
			item := findModerationItem(e.App, kindName, e.Record.Id)
			if item != nil && !isQuarantined(item) {
				if err := e.App.Delete(item); err != nil {
					e.App.Logger().Error("moderation: dropping item failed", "item", item.Id, "error", err)
				}
			}
			// Reports on content that is gone are decided: the content was removed.
			if err := closeReportsOf(e.App, kindName, e.Record.Id, "content_removed", "", "", ""); err != nil {
				e.App.Logger().Error("moderation: closing reports of deleted content failed", "content", e.Record.Id, "error", err)
			}
			return e.Next()
		})
	}

	app.Cron().MustAdd("moderationRetention", "29 3 * * *", func() {
		pruneQuarantine(app)
	})

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.POST("/api/moderation/{id}", moderate).Bind(apis.RequireAuth("users"))
		return se.Next()
	})
}

func moderatedFieldNames(kind moderatedKind, record *core.Record) []string {
	if kind.fields != nil {
		return kind.fields
	}
	names := []string{}
	for _, field := range record.Collection().Fields {
		names = append(names, field.GetName())
	}
	return names
}

func filledFields(kind moderatedKind, record *core.Record) []string {
	return slices.DeleteFunc(slices.Clone(moderatedFieldNames(kind, record)), func(field string) bool {
		return isEmptyValue(record.Get(field))
	})
}

func changedModeratedFields(kind moderatedKind, record *core.Record) []string {
	original := record.Original()
	return slices.DeleteFunc(slices.Clone(moderatedFieldNames(kind, record)), func(field string) bool {
		return field == "updated" || reflect.DeepEqual(record.Get(field), original.Get(field))
	})
}

func isEmptyValue(value any) bool {
	switch v := value.(type) {
	case nil:
		return true
	case string:
		return v == ""
	case []string:
		return len(v) == 0
	case bool:
		return !v
	}
	return false
}

func isQuarantined(item *core.Record) bool {
	state := item.GetString("state")
	return state == "hidden" || state == "pending"
}

func findModerationItem(app core.App, kindName, contentID string) *core.Record {
	item, err := app.FindFirstRecordByFilter("moderation_items", "content_type = {:type} && content_id = {:id}",
		dbx.Params{"type": kindName, "id": contentID})
	if err != nil {
		return nil
	}
	return item
}

func moderatedGym(app core.App, kindName string, record *core.Record) string {
	switch kindName {
	case "profile":
		return ""
	case "competition_entry":
		return competitionGym(app, record)
	}
	return record.GetString("gym")
}

func moderatedAuthor(kind moderatedKind, record *core.Record) string {
	if kind.authorField == "" {
		return ""
	}
	return record.GetString(kind.authorField)
}

// Records whose save is part of a moderation decision; their hooks must not reopen the case.
var underModeration sync.Map

func moderating(record *core.Record, save func() error) error {
	underModeration.Store(record.Id, true)
	defer underModeration.Delete(record.Id)
	return save()
}

// Queueing never fails the content save: the content is stored either way.
func queueQuietly(app core.App, kindName string, record *core.Record, changed []string) {
	if _, busy := underModeration.Load(record.Id); busy {
		return
	}
	if err := queueModeration(app, kindName, record, changed); err != nil {
		app.Logger().Error("moderation: queueing failed", "type", kindName, "content", record.Id, "error", err)
	}
}

func queueModeration(app core.App, kindName string, record *core.Record, changed []string) error {
	if !moderatedKinds[kindName].queued(app, record, changed) {
		return nil
	}
	return upsertModerationItem(app, kindName, record)
}

func upsertModerationItem(app core.App, kindName string, record *core.Record) error {
	kind := moderatedKinds[kindName]
	item := findModerationItem(app, kindName, record.Id)
	if item != nil && item.GetString("state") == "pending" {
		return nil
	}
	if item != nil && item.GetString("state") == "hidden" {
		if kind.fields == nil {
			return nil
		}
		// The author put new content in place of hidden content: that needs a fresh decision.
		reopenHidden(item)
	}
	if item == nil {
		collection, err := app.FindCachedCollectionByNameOrId("moderation_items")
		if err != nil {
			return err
		}
		item = core.NewRecord(collection)
		item.Set("content_type", kindName)
		item.Set("content_id", record.Id)
	}
	item.Set("gym", moderatedGym(app, kindName, record))
	item.Set("author", moderatedAuthor(kind, record))
	item.Set("snapshot", snapshotOf(kind, record))
	item.Set("state", "unreviewed")
	return app.Save(item)
}

func reopenHidden(item *core.Record) {
	item.Set("files", nil)
	item.Set("hidden_by", "")
	item.Set("reason", "")
	item.Set("reviewed_by", "")
	item.Set("reviewed_at", "")
}

// The author is kept in moderation_items.author only, so it can't be found by searching snapshots.
func snapshotOf(kind moderatedKind, record *core.Record) map[string]any {
	snapshot := map[string]any{}
	for _, field := range moderatedFieldNames(kind, record) {
		if field != kind.authorField {
			snapshot[field] = record.Get(field)
		}
	}
	return snapshot
}

func fileFieldsOf(kind moderatedKind, record *core.Record) []string {
	names := []string{}
	for _, field := range record.Collection().Fields {
		if field.Type() == core.FieldTypeFile && slices.Contains(moderatedFieldNames(kind, record), field.GetName()) {
			names = append(names, field.GetName())
		}
	}
	return names
}

func copyStoredFile(app core.App, key, name string) (*filesystem.File, error) {
	fsys, err := app.NewFilesystem()
	if err != nil {
		return nil, err
	}
	defer fsys.Close()
	reader, err := fsys.GetReader(key)
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	content, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}
	return filesystem.NewFileFromBytes(content, name)
}

func quarantine(app core.App, item *core.Record, kind moderatedKind, record *core.Record) error {
	snapshot := snapshotOf(kind, record)
	quarantined := map[string][]string{}
	files := []*filesystem.File{}
	for _, field := range fileFieldsOf(kind, record) {
		for _, name := range record.GetStringSlice(field) {
			file, err := copyStoredFile(app, record.BaseFilesPath()+"/"+name, name)
			if err != nil {
				return err
			}
			files = append(files, file)
			quarantined[field] = append(quarantined[field], file.Name)
		}
	}
	snapshot[quarantinedFilesKey] = quarantined
	item.Set("snapshot", snapshot)
	item.Set("files", files)
	return nil
}

func releaseQuarantine(app core.App, item *core.Record, kindName string) (*core.Record, error) {
	kind := moderatedKinds[kindName]
	var snapshot map[string]any
	if err := item.UnmarshalJSONField("snapshot", &snapshot); err != nil {
		return nil, err
	}
	record, err := app.FindRecordById(kind.collection, item.GetString("content_id"))
	if err != nil {
		if kind.fields != nil {
			return nil, apis.NewBadRequestError("The content no longer exists.", nil)
		}
		collection, err := app.FindCachedCollectionByNameOrId(kind.collection)
		if err != nil {
			return nil, err
		}
		record = core.NewRecord(collection)
		record.Id = item.GetString("content_id")
	}
	quarantined, _ := snapshot[quarantinedFilesKey].(map[string]any)
	for field, value := range snapshot {
		if field == quarantinedFilesKey || field == pendingKey || field == "id" || field == "created" || field == "updated" {
			continue
		}
		if _, isFile := quarantined[field]; isFile {
			continue
		}
		record.Set(field, value)
	}
	for field, names := range quarantined {
		files := []*filesystem.File{}
		for _, name := range names.([]any) {
			file, err := copyStoredFile(app, item.BaseFilesPath()+"/"+name.(string), name.(string))
			if err != nil {
				return nil, err
			}
			files = append(files, file)
		}
		record.Set(field, files)
	}
	if kind.fields == nil && kind.authorField != "" {
		record.Set(kind.authorField, item.GetString("author"))
	}
	if err := moderating(record, func() error { return app.Save(record) }); err != nil {
		return nil, apis.NewBadRequestError("The content could not be restored.", err)
	}
	return record, nil
}

type moderationRequest struct {
	Action string `json:"action"`
	Reason string `json:"reason"`
	// decidedReport is the report whose own update triggered this decision; it is saved by that request.
	decidedReport string
}

func moderate(e *core.RequestEvent) error {
	var body moderationRequest
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid moderation request.", err)
	}
	if (body.Action == "hide" || body.Action == "reject") && strings.TrimSpace(body.Reason) == "" {
		return e.BadRequestError("Hiding or declining needs a reason.", nil)
	}
	item, err := e.App.FindRecordById("moderation_items", e.Request.PathValue("id"))
	if err != nil {
		return e.NotFoundError("", nil)
	}
	platform := isPlatformAdmin(e.Auth)
	gymStaff := item.GetString("gym") != "" && hasPermission(e.App, e.Auth.Id, item.GetString("gym"), "manage_comments")
	if !platform && !gymStaff {
		return e.NotFoundError("", nil)
	}
	wasPending := false
	err = e.App.RunInTransaction(func(tx core.App) error {
		// Re-read inside the transaction so two decisions on one case can't both apply.
		fresh, err := tx.FindRecordById("moderation_items", item.Id)
		if err != nil {
			return apis.NewNotFoundError("", nil)
		}
		if err := moderationAllowed(fresh, body.Action, platform, gymStaff); err != nil {
			return err
		}
		wasPending = fresh.GetString("state") == "pending"
		item = fresh
		return applyModeration(tx, fresh, body, platform, e.Auth.Id)
	})
	if err != nil {
		var apiErr *router.ApiError
		if errors.As(err, &apiErr) {
			return apiErr
		}
		return e.InternalServerError("Moderation failed.", err)
	}

	entry := requestAuditEntry(e, "update", "moderation_items")
	entry.RecordID = item.Id
	entry.Gym = item.GetString("gym")
	entry.ChangedFields = []string{"state"}
	writeAuditEntry(e.App, entry)
	notifyAuthor(e.App, item, body.Action, wasPending)

	return e.JSON(http.StatusOK, map[string]string{
		"id": item.Id, "state": item.GetString("state"), "hidden_by": item.GetString("hidden_by"),
	})
}

func notifyAuthor(app core.App, item *core.Record, action string, wasPending bool) {
	author, err := app.FindRecordById("users", item.GetString("author"))
	if err != nil {
		return
	}
	message := notification{Users: []*core.Record{author}, Gym: item.GetString("gym"), URL: "/"}
	switch {
	case action == "hide":
		message.Type = "content_hidden"
		message.Params = map[string]any{"reason": truncateRunes(item.GetString("reason"), 140)}
		if err := sendStatementOfReasons(app, []*core.Record{item}, author); err != nil {
			app.Logger().Error("moderation: statement of reasons failed", "item", item.Id, "error", err)
		}
	case action == "approve" && wasPending:
		message.Type = "beta_approved"
		var snapshot map[string]any
		if item.UnmarshalJSONField("snapshot", &snapshot) == nil {
			if route, ok := snapshot["route"].(string); ok {
				message.URL = "/route?id=" + route + "#beta-" + item.GetString("content_id")
			}
		}
	case action == "reject":
		message.Type = "beta_rejected"
		message.Params = map[string]any{"reason": truncateRunes(item.GetString("reason"), 140)}
	default:
		return
	}
	pushNotification(app, message)
}

func moderationAllowed(item *core.Record, action string, platform, gymStaff bool) error {
	state := item.GetString("state")
	allowed := false
	switch action {
	case "approve":
		allowed = state == "unreviewed" || (state == "pending" && gymStaff)
	case "reject":
		allowed = state == "pending" && gymStaff
	case "hide":
		allowed = state == "unreviewed" || state == "approved" || (state == "pending" && platform)
	case "restore":
		allowed = state == "hidden" && (item.GetString("hidden_by") != "platform" || platform)
	default:
		return apis.NewBadRequestError("Unknown moderation action.", nil)
	}
	if !allowed {
		return apis.NewForbiddenError("This action is not allowed on this item.", nil)
	}
	return nil
}

func applyModeration(app core.App, item *core.Record, body moderationRequest, platform bool, reviewer string) error {
	kindName := item.GetString("content_type")
	kind := moderatedKinds[kindName]
	item.Set("reviewed_by", reviewer)
	item.Set("reviewed_at", types.NowDateTime())
	item.Set("reason", truncateRunes(body.Reason, 2000))

	switch body.Action {
	case "approve":
		if item.GetString("state") == "pending" {
			record, err := releaseQuarantine(app, item, kindName)
			if err != nil {
				return err
			}
			settleItem(item, kind, record)
		}
		item.Set("state", "approved")
		if err := app.Save(item); err != nil {
			return err
		}
		return closeReports(app, item, "content_kept", reviewer, body.decidedReport)

	case "reject":
		return app.Delete(item)

	case "hide":
		wasPending := item.GetString("state") == "pending"
		item.Set("state", "hidden")
		item.Set("hidden_by", "gym")
		if platform {
			item.Set("hidden_by", "platform")
		}
		if wasPending {
			var snapshot map[string]any
			if err := item.UnmarshalJSONField("snapshot", &snapshot); err != nil {
				return err
			}
			snapshot[pendingKey] = true
			item.Set("snapshot", snapshot)
			return app.Save(item)
		}
		record, err := app.FindRecordById(kind.collection, item.GetString("content_id"))
		if err != nil {
			return apis.NewBadRequestError("The content no longer exists.", nil)
		}
		if err := quarantine(app, item, kind, record); err != nil {
			return err
		}
		if err := app.Save(item); err != nil {
			return err
		}
		if err := closeReports(app, item, "content_removed", reviewer, body.decidedReport); err != nil {
			return err
		}
		if kind.hide == nil {
			return app.Delete(record)
		}
		kind.hide(record)
		return moderating(record, func() error { return app.Save(record) })

	case "restore":
		var snapshot map[string]any
		if err := item.UnmarshalJSONField("snapshot", &snapshot); err != nil {
			return err
		}
		item.Set("hidden_by", "")
		if snapshot[pendingKey] == true {
			delete(snapshot, pendingKey)
			item.Set("snapshot", snapshot)
			item.Set("state", "pending")
			return app.Save(item)
		}
		record, err := releaseQuarantine(app, item, kindName)
		if err != nil {
			return err
		}
		settleItem(item, kind, record)
		item.Set("state", "approved")
		return app.Save(item)
	}
	return nil
}

func settleItem(item *core.Record, kind moderatedKind, record *core.Record) {
	item.Set("snapshot", snapshotOf(kind, record))
	item.Set("files", nil)
}

func countReport(app core.App, report *core.Record) {
	kindName := report.GetString("content_type")
	kind, moderated := moderatedKinds[kindName]
	if !moderated {
		return
	}
	record, err := app.FindRecordById(kind.collection, report.GetString("content_id"))
	if err != nil {
		return
	}
	if hidden := findModerationItem(app, kindName, record.Id); hidden != nil && hidden.GetString("state") == "hidden" {
		// Already hidden: the reporter gets that decision instead of a case nobody can act on.
		if err := closeReportsOf(app, kindName, record.Id, "content_removed", hidden.GetString("reason"), "", ""); err != nil {
			app.Logger().Error("moderation: closing report on hidden content failed", "report", report.Id, "error", err)
		}
		return
	}
	if err := upsertModerationItem(app, kindName, record); err != nil {
		app.Logger().Error("moderation: queueing reported content failed", "report", report.Id, "error", err)
		return
	}
	item := findModerationItem(app, kindName, record.Id)
	if item == nil {
		return
	}
	item.Set("reports_count", item.GetInt("reports_count")+1)
	if err := app.Save(item); err != nil {
		app.Logger().Error("moderation: counting report failed", "report", report.Id, "error", err)
	}
}

func sendStatementOfReasons(app core.App, items []*core.Record, author *core.Record) error {
	if !app.Settings().SMTP.Enabled {
		app.Logger().Warn("moderation: SMTP disabled, statement of reasons not sent", "author", author.Id)
		return nil
	}
	first := items[0]
	content := mailDetail{Label: "content", ValueKey: "moderation.types." + first.GetString("content_type")}
	references := []string{}
	gym := first.GetString("gym")
	for _, item := range items {
		references = append(references, item.Id)
		if item.GetString("gym") != gym {
			gym = ""
		}
	}
	if len(items) > 1 {
		content = mailDetail{Label: "content", Value: strconv.Itoa(len(items))}
	}
	details := []mailDetail{content, {Label: "reference", Value: truncateRunes(strings.Join(references, ", "), 1000)}}
	if reason := first.GetString("reason"); reason != "" {
		details = append(details, mailDetail{Label: "reasoning", Value: reason})
	}
	_, err := sendGymMail(app, mailContent{
		Key:     "contentHidden",
		Gym:     gym,
		Name:    author.GetString("firstname"),
		Details: details,
		Outro:   []string{"mails.reportDecision.redress"},
	}, []mailRecipient{{Address: author.Email(), Language: author.GetString("language")}})
	return err
}

func pruneQuarantine(app core.App) {
	expired, err := app.FindRecordsByFilter("moderation_items", "state = 'hidden' && reviewed_at < {:cutoff}", "", 500, 0,
		dbx.Params{"cutoff": cutoff(days(hiddenRetentionDays))})
	if err != nil {
		app.Logger().Error("moderation: loading expired quarantine failed", "error", err)
		return
	}
	for _, item := range expired {
		if err := app.Delete(item); err != nil {
			app.Logger().Error("moderation: pruning quarantine failed", "item", item.Id, "error", err)
		}
	}
	app.Logger().Info("moderation: pruned expired quarantine", "rows", len(expired))
}

func closeReports(app core.App, item *core.Record, decision, reviewer, decidedReport string) error {
	return closeReportsOf(app, item.GetString("content_type"), item.GetString("content_id"), decision, item.GetString("reason"), reviewer, decidedReport)
}

func closeReportsOf(app core.App, contentType, contentID, decision, reason, reviewer, decidedReport string) error {
	reports, err := app.FindAllRecords("reports", dbx.HashExp{
		"content_type": contentType, "content_id": contentID, "status": "open",
	})
	if err != nil {
		return err
	}
	status := "rejected"
	if decision == "content_removed" {
		status = "actioned"
	}
	for _, report := range reports {
		if report.Id == decidedReport {
			continue
		}
		report.Set("status", status)
		report.Set("decision", decision)
		report.Set("decision_reason", reason)
		report.Set("decided_at", types.NowDateTime())
		report.Set("decided_by", reviewer)
		if err := app.Save(report); err != nil {
			return err
		}
	}
	return nil
}
