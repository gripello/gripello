package hooks

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"slices"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const defaultAuditRetentionDays = 90

var auditSkippedCollections = []string{"audit_logs", "_mfas", "_otps", "_externalAuths", "_authOrigins"}

var auditIgnoredFields = []string{"updated", "tokenKey"}

type auditEntry struct {
	Actor          string
	ActorLabel     string
	Action         string
	CollectionName string
	RecordID       string
	Gym            string
	ChangedFields  []string
	IP             string
}

func registerAudit(app core.App) {
	app.OnRecordCreateRequest().BindFunc(func(e *core.RecordRequestEvent) error {
		if slices.Contains(auditSkippedCollections, e.Collection.Name) {
			return e.Next()
		}
		entry := requestAuditEntry(e.RequestEvent, "create", e.Collection.Name)
		if err := e.Next(); err != nil {
			return err
		}
		entry.RecordID = e.Record.Id
		entry.Gym = e.Record.GetString("gym")
		writeAuditEntry(e.App, entry)
		return nil
	})

	app.OnRecordUpdateRequest().BindFunc(func(e *core.RecordRequestEvent) error {
		if slices.Contains(auditSkippedCollections, e.Collection.Name) {
			return e.Next()
		}
		entry := requestAuditEntry(e.RequestEvent, "update", e.Collection.Name)
		entry.RecordID = e.Record.Id
		entry.Gym = e.Record.GetString("gym")
		entry.ChangedFields = changedFieldNames(e.Record.Original().FieldsData(), e.Record.FieldsData())
		if err := e.Next(); err != nil {
			return err
		}
		writeAuditEntry(e.App, entry)
		return nil
	})

	app.OnRecordDeleteRequest().BindFunc(func(e *core.RecordRequestEvent) error {
		if slices.Contains(auditSkippedCollections, e.Collection.Name) {
			return e.Next()
		}
		entry := requestAuditEntry(e.RequestEvent, "delete", e.Collection.Name)
		entry.RecordID = e.Record.Id
		entry.Gym = e.Record.GetString("gym")
		if e.Collection.Name == "users" && entry.Actor == e.Record.Id {
			entry.Actor = ""
		}
		if err := e.Next(); err != nil {
			return err
		}
		writeAuditEntry(e.App, entry)
		return nil
	})

	app.OnRecordAuthWithPasswordRequest().BindFunc(func(e *core.RecordAuthWithPasswordRequestEvent) error {
		if err := e.Next(); err != nil {
			writeAuthEvent(e.RequestEvent, e.Collection, e.Record, "login_failed", maskedIdentity(e.Identity))
			return err
		}
		writeAuthEvent(e.RequestEvent, e.Collection, e.Record, "login", e.Identity)
		return nil
	})

	app.OnRecordAuthWithOAuth2Request().BindFunc(func(e *core.RecordAuthWithOAuth2RequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		writeAuthEvent(e.RequestEvent, e.Collection, e.Record, "login", "")
		return nil
	})

	app.OnRecordRequestPasswordResetRequest().BindFunc(func(e *core.RecordRequestPasswordResetRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		writeAuthEvent(e.RequestEvent, e.Collection, e.Record, "password_reset_request", "")
		return nil
	})

	app.OnRecordConfirmPasswordResetRequest().BindFunc(func(e *core.RecordConfirmPasswordResetRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		writeAuthEvent(e.RequestEvent, e.Collection, e.Record, "password_reset", "")
		return nil
	})

	app.OnRecordRequestEmailChangeRequest().BindFunc(func(e *core.RecordRequestEmailChangeRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		writeAuthEvent(e.RequestEvent, e.Collection, e.Record, "email_change_request", "")
		return nil
	})

	app.OnRecordConfirmEmailChangeRequest().BindFunc(func(e *core.RecordConfirmEmailChangeRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		writeAuthEvent(e.RequestEvent, e.Collection, e.Record, "email_change", "")
		return nil
	})

	app.Cron().MustAdd("auditRetention", "17 3 * * *", func() {
		retention := auditRetentionDays(app)
		before := cutoff(days(retention))
		removed, err := pruneRows(app, "DELETE FROM audit_logs WHERE created < {:cutoff}", dbx.Params{"cutoff": before})
		if err != nil {
			app.Logger().Error("audit: retention prune failed", "error", err)
			return
		}
		app.Logger().Info("audit: pruned expired entries", "rows", removed, "cutoff", before, "retentionDays", retention)
	})
}

func requestAuditEntry(e *core.RequestEvent, action string, collectionName string) auditEntry {
	entry := auditEntry{Action: action, CollectionName: collectionName, IP: e.RealIP()}
	label := ""
	if e.Auth != nil {
		label = firstNonEmpty(e.Auth.GetString("email"), e.Auth.GetString("username"), e.Auth.Id)
	}
	if e.HasSuperuserAuth() {
		entry.ActorLabel = "superuser"
		if label != "" {
			entry.ActorLabel = "superuser:" + label
		}
		return entry
	}
	entry.ActorLabel = label
	if e.Auth != nil {
		entry.Actor = e.Auth.Id
	}
	return entry
}

func writeAuthEvent(e *core.RequestEvent, collection *core.Collection, record *core.Record, action string, fallbackLabel string) {
	collectionName := "users"
	if record != nil {
		collectionName = record.Collection().Name
	} else if collection != nil {
		collectionName = collection.Name
	}

	label := fallbackLabel
	recordID := ""
	if record != nil {
		label = firstNonEmpty(record.GetString("email"), record.GetString("username"), fallbackLabel)
		recordID = record.Id
	}

	entry := auditEntry{
		ActorLabel:     label,
		Action:         action,
		CollectionName: collectionName,
		RecordID:       recordID,
		IP:             e.RealIP(),
	}
	if collectionName == "users" {
		entry.Actor = recordID
	} else if label != "" {
		entry.ActorLabel = "superuser:" + label
	} else {
		entry.ActorLabel = "superuser"
	}

	writeAuditEntry(e.App, entry)
}

func writeAuditEntry(app core.App, entry auditEntry) {
	collection, err := app.FindCollectionByNameOrId("audit_logs")
	if err != nil {
		app.Logger().Error("audit: failed to write entry", "action", entry.Action, "collection", entry.CollectionName, "error", err)
		return
	}

	record := core.NewRecord(collection)
	record.Set("actor", entry.Actor)
	record.Set("actor_label", truncateRunes(entry.ActorLabel, 255))
	record.Set("action", entry.Action)
	record.Set("collection_name", entry.CollectionName)
	record.Set("record_id", entry.RecordID)
	record.Set("gym", entry.Gym)
	record.Set("changed_fields", entry.ChangedFields)
	record.Set("ip", entry.IP)

	if err := app.Save(record); err != nil {
		app.Logger().Error("audit: failed to write entry", "action", entry.Action, "collection", entry.CollectionName, "error", err)
	}
}

func changedFieldNames(before map[string]any, after map[string]any) []string {
	changed := []string{}
	for key, value := range after {
		if slices.Contains(auditIgnoredFields, key) {
			continue
		}
		beforeJSON, _ := json.Marshal(before[key])
		afterJSON, _ := json.Marshal(value)
		if string(beforeJSON) != string(afterJSON) {
			changed = append(changed, key)
		}
	}
	slices.Sort(changed)
	return changed
}

func auditRetentionDays(app core.App) int {
	settings, err := app.FindRecordById("settings", platformSettingsID)
	if err != nil {
		return defaultAuditRetentionDays
	}
	retention := settings.GetFloat("audit_retention_days")
	if retention < 1 || retention > 3650 {
		return defaultAuditRetentionDays
	}
	return int(retention)
}

func maskedIdentity(identity string) string {
	digest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(identity))))
	return "unknown:" + hex.EncodeToString(digest[:4])
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}
