package hooks

import (
	"net/http"

	"github.com/pocketbase/dbx"
	"net/url"
	"slices"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

func registerReports(app core.App) {
	app.OnRecordCreateRequest("reports").BindFunc(func(e *core.RecordRequestEvent) error {
		e.Record.Set("status", "open")
		e.Record.Set("decision", "")
		e.Record.Set("decision_reason", "")
		e.Record.Set("decided_at", "")
		e.Record.Set("decided_by", "")
		e.Record.Set("receipt_sent", false)
		e.Record.Set("notified_at", "")
		if !reportedContentExists(e.App, e.Record) {
			return apis.NewBadRequestError("The reported content does not exist.", nil)
		}
		e.Record.Set("content_snapshot", truncateRunes(reportedContentSnapshot(e.App, e.Record), 5000))
		e.Record.Set("content_url", reportedContentURL(e.App, e.Record))
		return e.Next()
	})

	app.OnRecordUpdateRequest("reports").BindFunc(func(e *core.RecordRequestEvent) error {
		if !e.HasSuperuserAuth() {
			original := e.Record.Original()
			if original.GetString("status") != "open" {
				return apis.NewBadRequestError("This report has already been decided.", nil)
			}
			keepServerOwnedReportFields(e.Record, original)
			if e.Record.GetString("status") != "open" {
				e.Record.Set("decided_at", types.NowDateTime())
				e.Record.Set("decided_by", e.Auth.Id)
			}
		}
		removing := e.Record.GetString("decision") == "content_removed" &&
			e.Record.Original().GetString("decision") != "content_removed"
		if removing && reportedContentExists(e.App, e.Record) {
			var hidden *core.Record
			app := e.App
			err := app.RunInTransaction(func(tx core.App) error {
				item, err := hideReportedContent(tx, e, e.Record)
				if err != nil {
					return err
				}
				hidden = item
				e.App = tx
				return e.Next()
			})
			if err == nil && hidden != nil {
				entry := requestAuditEntry(e.RequestEvent, "update", "moderation_items")
				entry.RecordID = hidden.Id
				entry.Gym = hidden.GetString("gym")
				entry.ChangedFields = []string{"state"}
				writeAuditEntry(app, entry)
				notifyAuthor(app, hidden, "hide", false)
			}
			return err
		}
		return e.Next()
	})

	app.OnRecordAfterCreateSuccess("reports").BindFunc(func(e *core.RecordEvent) error {
		pushNotification(e.App, notification{
			Users:  usersByPermission(e.App, e.Record.GetString("gym"), "manage_reports"),
			Gym:    e.Record.GetString("gym"),
			Type:   "report_filed",
			Params: map[string]any{"snippet": truncateRunes(e.Record.GetString("content_snapshot"), 140)},
			URL:    gymPath(e.App, e.Record.GetString("gym"), "/manage/moderation"),
		})

		if e.Record.GetString("reason") != "other" {
			pushNotification(e.App, notification{
				Users:  platformAdmins(e.App),
				Gym:    e.Record.GetString("gym"),
				Type:   "report_filed_platform",
				Params: map[string]any{"snippet": truncateRunes(e.Record.GetString("content_snapshot"), 140)},
				URL:    "/platform/moderation",
			})
		}

		if err := sendReportReceipt(e.App, e.Record); err != nil {
			e.App.Logger().Error("reports: receipt/alert mail failed", "report", e.Record.Id, "error", err)
		}
		countReport(e.App, e.Record)
		return e.Next()
	})

	app.OnRecordAfterUpdateSuccess("reports").BindFunc(func(e *core.RecordEvent) error {
		notifyReportDecided(e.App, e.Record)

		if err := sendReportDecision(e.App, e.Record); err != nil {
			e.App.Logger().Error("reports: decision mail failed", "report", e.Record.Id, "error", err)
		}
		return e.Next()
	})

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.GET("/api/mail-status", func(e *core.RequestEvent) error {
			return e.JSON(http.StatusOK, map[string]bool{"configured": e.App.Settings().SMTP.Enabled})
		}).Bind(apis.RequireAuth())
		return se.Next()
	})
}

func hideReportedContent(app core.App, e *core.RecordRequestEvent, report *core.Record) (*core.Record, error) {
	kindName := report.GetString("content_type")
	kind, moderated := moderatedKinds[kindName]
	if !moderated {
		return nil, apis.NewBadRequestError("The reported content still exists. Delete it before recording its removal.", nil)
	}
	record, err := app.FindRecordById(kind.collection, report.GetString("content_id"))
	if err != nil {
		return nil, err
	}
	item := findModerationItem(app, kindName, record.Id)
	if item != nil && item.GetString("state") == "hidden" {
		return nil, nil
	}
	if err := upsertModerationItem(app, kindName, record); err != nil {
		return nil, err
	}
	item = findModerationItem(app, kindName, record.Id)
	if item == nil {
		return nil, apis.NewBadRequestError("The reported content could not be hidden.", nil)
	}
	platform := e.HasSuperuserAuth() || isPlatformAdmin(e.Auth)
	reviewer := ""
	if e.Auth != nil && e.Auth.Collection().Name == "users" {
		reviewer = e.Auth.Id
	}
	gymStaff := reviewer != "" && item.GetString("gym") != "" && hasPermission(app, reviewer, item.GetString("gym"), "manage_comments")
	if !platform && !gymStaff {
		return nil, apis.NewForbiddenError("Removing this content requires manage_comments.", nil)
	}
	if err := moderationAllowed(item, "hide", platform, gymStaff); err != nil {
		return nil, err
	}
	if err := applyModeration(app, item, moderationRequest{Action: "hide", Reason: report.GetString("decision_reason"), decidedReport: report.Id}, platform, reviewer); err != nil {
		return nil, err
	}
	return item, nil
}

func platformAdmins(app core.App) []*core.Record {
	admins, err := app.FindAllRecords("users", dbx.HashExp{"platform_admin": true})
	if err != nil {
		app.Logger().Error("reports: loading platform admins failed", "error", err)
	}
	return admins
}

var moderatorReportFields = []string{"status", "decision", "decision_reason"}

func keepServerOwnedReportFields(report *core.Record, original *core.Record) {
	for _, field := range report.Collection().Fields {
		if name := field.GetName(); !slices.Contains(moderatorReportFields, name) {
			report.Set(name, original.Get(name))
		}
	}
}

func reportedContentCollection(report *core.Record) string {
	switch report.GetString("content_type") {
	case "route":
		return "routes"
	case "beta_video":
		return "beta_videos"
	case "profile":
		return "users"
	}
	return "ratings"
}

func reportedContentExists(app core.App, report *core.Record) bool {
	_, err := app.FindRecordById(reportedContentCollection(report), report.GetString("content_id"))
	return err == nil
}

func reportedContentSnapshot(app core.App, report *core.Record) string {
	contentID := report.GetString("content_id")
	if report.GetString("content_type") == "profile" {
		user, err := app.FindRecordById("users", contentID)
		if err != nil {
			return ""
		}
		return strings.Join(slices.DeleteFunc(
			[]string{user.GetString("username"), user.GetString("firstname"), user.GetString("name")},
			func(part string) bool { return part == "" },
		), " - ")
	}
	if report.GetString("content_type") == "beta_video" {
		video, err := app.FindRecordById("beta_videos", contentID)
		if err != nil {
			return ""
		}
		return video.GetString("url") + video.GetString("file")
	}
	if report.GetString("content_type") == "route" {
		route, err := app.FindRecordById("routes", contentID)
		if err != nil {
			return ""
		}
		parts := slices.DeleteFunc(
			[]string{route.GetString("name"), route.GetString("comment")},
			func(part string) bool { return part == "" },
		)
		return strings.Join(parts, " - ")
	}
	rating, err := app.FindRecordById("ratings", contentID)
	if err != nil {
		return ""
	}
	return rating.GetString("comment")
}

func reportedContentURL(app core.App, report *core.Record) string {
	contentID := report.GetString("content_id")
	if report.GetString("content_type") == "route" {
		return "/route?id=" + url.QueryEscape(contentID)
	}
	if report.GetString("content_type") == "profile" {
		return "/climber?id=" + url.QueryEscape(contentID)
	}
	if report.GetString("content_type") == "beta_video" {
		video, err := app.FindRecordById("beta_videos", contentID)
		if err != nil {
			return "/"
		}
		return "/route?id=" + url.QueryEscape(video.GetString("route")) + "#beta-" + url.QueryEscape(contentID)
	}
	rating, err := app.FindRecordById("ratings", contentID)
	if err != nil {
		return "/"
	}
	return "/route?id=" + url.QueryEscape(rating.GetString("route_id")) + "#comment-" + url.QueryEscape(contentID)
}

func notifyReportDecided(app core.App, report *core.Record) {
	if !isReportDecisionTransition(report) {
		return
	}

	decider := ""
	if decidedBy := report.GetStringSlice("decided_by"); len(decidedBy) > 0 {
		decider = decidedBy[0]
	}
	recipients := slices.DeleteFunc(usersByPermission(app, report.GetString("gym"), "manage_reports"), func(user *core.Record) bool {
		return user.Id == decider
	})

	notificationType := "report_decided_kept"
	if report.GetString("decision") == "content_removed" {
		notificationType = "report_decided_removed"
	}

	pushNotification(app, notification{Users: recipients, Gym: report.GetString("gym"), Type: notificationType, URL: gymPath(app, report.GetString("gym"), "/manage/moderation")})
}

func sendReportReceipt(app core.App, report *core.Record) error {
	if !app.Settings().SMTP.Enabled {
		app.Logger().Warn("reports: SMTP disabled, Art. 16(4) receipt not sent", "report", report.Id)
		return nil
	}

	receiptSent, err := sendGymMail(app, reportReceiptMail(report), []mailRecipient{reportNotifier(report)})
	if err != nil {
		return err
	}
	if receiptSent {
		stored, err := app.FindRecordById("reports", report.Id)
		if err != nil {
			return err
		}
		stored.Set("receipt_sent", true)
		if err := app.Save(stored); err != nil {
			return err
		}
	}

	_, err = sendGymMail(app, reportAlertMail(app, report), reportAlertRecipients(app, report))
	return err
}

func reportNotifier(report *core.Record) mailRecipient {
	return mailRecipient{Address: report.GetString("notifier_email"), Language: report.GetString("language")}
}

func reportReceiptMail(report *core.Record) mailContent {
	return mailContent{
		Key: "reportReceipt",
		Gym: report.GetString("gym"),
		Details: []mailDetail{
			{Label: "reason", ValueKey: "reports.reasons." + report.GetString("reason"), Value: report.GetString("reason")},
			{Label: "reference", Value: report.Id},
		},
	}
}

func reportAlertMail(app core.App, report *core.Record) mailContent {
	contentURL := absoluteURL(appURL(app), report.GetString("content_url"))
	return mailContent{
		Key: "reportAlert",
		Gym: report.GetString("gym"),
		Details: []mailDetail{
			{Label: "reason", ValueKey: "reports.reasons." + report.GetString("reason"), Value: report.GetString("reason")},
			{Label: "content", Value: contentURL, Link: contentURL},
			{Label: "explanation", Value: report.GetString("explanation")},
			{Label: "snapshot", Value: report.GetString("content_snapshot")},
			{Label: "reportedBy", Value: report.GetString("notifier_name") + " (" + report.GetString("notifier_email") + ")"},
		},
		Action: gymPath(app, report.GetString("gym"), "/manage/moderation"),
	}
}

func sendReportDecision(app core.App, report *core.Record) error {
	if !isReportDecisionMailPending(report) {
		return nil
	}
	if !app.Settings().SMTP.Enabled {
		app.Logger().Warn("reports: SMTP disabled, Art. 16(5) decision notice not sent", "report", report.Id)
		return nil
	}

	if _, err := sendGymMail(app, reportDecisionMail(app, report), []mailRecipient{reportNotifier(report)}); err != nil {
		return err
	}

	report.Set("notified_at", types.NowDateTime())
	return app.Save(report)
}

func reportDecisionMail(app core.App, report *core.Record) mailContent {
	outcome := "mails.reportDecision.kept"
	if report.GetString("decision") == "content_removed" {
		outcome = "mails.reportDecision.removed"
	}
	details := []mailDetail{{Label: "reference", Value: report.Id}}
	if reason := report.GetString("decision_reason"); reason != "" {
		details = append(details, mailDetail{Label: "reasoning", Value: reason})
	}
	outro := []string{"mails.reportDecision.redress"}
	contact := contactEmail(app, report.GetString("gym"))
	if contact != "" {
		outro = append(outro, "mails.reportDecision.redressContact")
	}
	return mailContent{
		Key:     "reportDecision",
		Gym:     report.GetString("gym"),
		Name:    report.GetString("notifier_name"),
		Params:  map[string]any{"email": contact},
		Lines:   []string{outcome},
		Details: details,
		Outro:   outro,
	}
}

func isReportDecisionMailPending(report *core.Record) bool {
	status := report.GetString("status")
	return status != "" && status != "open" && report.GetDateTime("notified_at").IsZero()
}

func isReportDecisionTransition(report *core.Record) bool {
	return report.Original().GetString("status") == "open" && isReportDecisionMailPending(report)
}

func reportAlertRecipients(app core.App, report *core.Record) []mailRecipient {
	recipients := usersAsRecipients(usersByPermission(app, report.GetString("gym"), "manage_reports"))
	if contact := contactEmail(app, report.GetString("gym")); contact != "" {
		recipients = append(recipients, mailRecipient{Address: contact})
	}
	return recipients
}

func appURL(app core.App) string {
	return strings.TrimRight(app.Settings().Meta.AppURL, "/")
}
