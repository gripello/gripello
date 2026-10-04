package hooks

import (
	"fmt"
	"html"
	"net/http"
	"net/mail"
	"net/url"
	"slices"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/mailer"
	"github.com/pocketbase/pocketbase/tools/types"
)

var reportReasonLabels = map[string]string{
	"hate_speech":     "Hate speech",
	"harassment":      "Harassment",
	"violence_threat": "Threat of violence",
	"sexual_content":  "Sexual content",
	"personal_data":   "Personal data",
	"ip_infringement": "Intellectual property infringement",
	"spam_fraud":      "Spam or fraud",
	"other":           "Other",
}

func registerReports(app core.App) {
	app.OnRecordCreateRequest("reports").BindFunc(func(e *core.RecordRequestEvent) error {
		e.Record.Set("status", "open")
		e.Record.Set("decision", "")
		e.Record.Set("decision_reason", "")
		e.Record.Set("decided_at", "")
		e.Record.Set("decided_by", "")
		e.Record.Set("receipt_sent", false)
		e.Record.Set("notified_at", "")
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
			return apis.NewBadRequestError("The reported content still exists. Delete it before recording its removal.", nil)
		}
		return e.Next()
	})

	app.OnRecordAfterCreateSuccess("reports").BindFunc(func(e *core.RecordEvent) error {
		pushNotification(e.App, notification{
			Users:  usersByPermission(e.App, e.Record.GetString("gym"), "manage_reports"),
			Gym:    e.Record.GetString("gym"),
			Type:   "report_filed",
			Params: map[string]any{"snippet": truncateRunes(e.Record.GetString("content_snapshot"), 140)},
			URL:    gymPath(e.App, e.Record.GetString("gym"), "/manage/reports"),
		})

		if err := sendReportReceipt(e.App, e.Record); err != nil {
			e.App.Logger().Error("reports: receipt/alert mail failed", "report", e.Record.Id, "error", err)
		}
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

var moderatorReportFields = []string{"status", "decision", "decision_reason"}

func keepServerOwnedReportFields(report *core.Record, original *core.Record) {
	for _, field := range report.Collection().Fields {
		if name := field.GetName(); !slices.Contains(moderatorReportFields, name) {
			report.Set(name, original.Get(name))
		}
	}
}

func reportedContentCollection(report *core.Record) string {
	if report.GetString("content_type") == "route" {
		return "routes"
	}
	return "ratings"
}

func reportedContentExists(app core.App, report *core.Record) bool {
	_, err := app.FindRecordById(reportedContentCollection(report), report.GetString("content_id"))
	return err == nil
}

func reportedContentSnapshot(app core.App, report *core.Record) string {
	contentID := report.GetString("content_id")
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

	pushNotification(app, notification{Users: recipients, Gym: report.GetString("gym"), Type: notificationType, URL: gymPath(app, report.GetString("gym"), "/manage/reports")})
}

func sendReportReceipt(app core.App, report *core.Record) error {
	if !app.Settings().SMTP.Enabled {
		app.Logger().Warn("reports: SMTP disabled, Art. 16(4) receipt not sent", "report", report.Id)
		return nil
	}

	summary := reportSummaryHTML(app, report)

	receiptSent, err := sendMail(
		app,
		[]string{report.GetString("notifier_email")},
		gymMailSubject(app, report.GetString("gym"), "We received your report"),
		reportReceiptHTML(report),
	)
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

	_, err = sendMail(
		app,
		reportAlertRecipients(app, report),
		gymMailSubject(app, report.GetString("gym"), "New content report"),
		fmt.Sprintf(`<p>A new report was submitted and is awaiting review.</p>
             %s
             <p><strong>Reported by:</strong> %s
             (%s)</p>
             <p><a href="%s%s">Open the moderation queue</a></p>`,
			summary,
			html.EscapeString(report.GetString("notifier_name")),
			html.EscapeString(report.GetString("notifier_email")),
			html.EscapeString(appURL(app)),
			html.EscapeString(gymPath(app, report.GetString("gym"), "/manage/reports")),
		),
	)
	return err
}

func reportReceiptHTML(report *core.Record) string {
	return fmt.Sprintf(`<p>Hello,</p>
             <p>We have received your report and will review it without undue delay.
             You will be informed of the decision and of the ways to challenge it.</p>
             <p><strong>Reason:</strong> %s</p>
             <p>Reference: %s</p>`,
		html.EscapeString(reportReasonLabel(report.GetString("reason"))),
		html.EscapeString(report.Id),
	)
}

func sendReportDecision(app core.App, report *core.Record) error {
	if !isReportDecisionMailPending(report) {
		return nil
	}
	if !app.Settings().SMTP.Enabled {
		app.Logger().Warn("reports: SMTP disabled, Art. 16(5) decision notice not sent", "report", report.Id)
		return nil
	}

	outcome := "The reported content has been kept online."
	if report.GetString("decision") == "content_removed" {
		outcome = "The reported content has been removed."
	}
	reasoning := ""
	if reason := report.GetString("decision_reason"); reason != "" {
		reasoning = fmt.Sprintf("<p><strong>Reasoning:</strong><br>%s</p>", html.EscapeString(reason))
	}

	if _, err := sendMail(
		app,
		[]string{report.GetString("notifier_email")},
		gymMailSubject(app, report.GetString("gym"), "Decision on your report"),
		fmt.Sprintf(`<p>Hello %s,</p>
             <p>We have reviewed your report (reference %s).</p>
             <p><strong>Decision:</strong> %s</p>
             %s
             %s`,
			html.EscapeString(report.GetString("notifier_name")),
			html.EscapeString(report.Id),
			html.EscapeString(outcome),
			reasoning,
			reportRedressHTML(app, report.GetString("gym")),
		),
	); err != nil {
		return err
	}

	report.Set("notified_at", types.NowDateTime())
	return app.Save(report)
}

func isReportDecisionMailPending(report *core.Record) bool {
	status := report.GetString("status")
	return status != "" && status != "open" && report.GetDateTime("notified_at").IsZero()
}

func isReportDecisionTransition(report *core.Record) bool {
	return report.Original().GetString("status") == "open" && isReportDecisionMailPending(report)
}

func sendMail(app core.App, recipients []string, subject string, body string) (bool, error) {
	to := []mail.Address{}
	for _, address := range recipients {
		if address != "" {
			to = append(to, mail.Address{Address: address})
		}
	}
	if len(to) == 0 {
		return false, nil
	}

	meta := app.Settings().Meta
	message := &mailer.Message{
		From:    mail.Address{Address: meta.SenderAddress, Name: meta.SenderName},
		To:      to,
		Subject: subject,
		HTML:    body,
	}
	if err := app.NewMailClient().Send(message); err != nil {
		return false, err
	}
	return true, nil
}

func reportAlertRecipients(app core.App, report *core.Record) []string {
	addresses := []string{}
	for _, user := range usersByPermission(app, report.GetString("gym"), "manage_reports") {
		if address := user.GetString("email"); address != "" && !slices.Contains(addresses, address) {
			addresses = append(addresses, address)
		}
	}
	if contact := contactEmail(app, report.GetString("gym")); contact != "" && !slices.Contains(addresses, contact) {
		addresses = append(addresses, contact)
	}
	return addresses
}

func reportSummaryHTML(app core.App, report *core.Record) string {
	contentURL := report.GetString("content_url")
	if !strings.HasPrefix(contentURL, "http") {
		contentURL = appURL(app) + contentURL
	}

	snapshot := html.EscapeString(report.GetString("content_snapshot"))
	if snapshot == "" {
		snapshot = "<em>unavailable</em>"
	}

	return fmt.Sprintf(`
        <p><strong>Reason:</strong> %s</p>
        <p><strong>Reported content:</strong> <a href="%s">%s</a></p>
        <p><strong>Explanation:</strong><br>%s</p>
        <p><strong>Content at the time of the report:</strong><br>%s</p>
    `,
		html.EscapeString(reportReasonLabel(report.GetString("reason"))),
		html.EscapeString(contentURL),
		html.EscapeString(contentURL),
		html.EscapeString(report.GetString("explanation")),
		snapshot,
	)
}

func reportRedressHTML(app core.App, gymID string) string {
	contactLine := ""
	if contact := contactEmail(app, gymID); contact != "" {
		escaped := html.EscapeString(contact)
		contactLine = fmt.Sprintf(`<li>Contacting the operator directly at <a href="mailto:%s">%s</a>.</li>`, escaped, escaped)
	}

	return fmt.Sprintf(`
        <p><strong>How to challenge this decision</strong></p>
        <ul>
            <li>Out-of-court dispute settlement before a certified body under Article 21 of the Digital Services Act.</li>
            <li>Judicial remedy before the competent court.</li>
            %s
        </ul>
    `, contactLine)
}

func reportReasonLabel(reason string) string {
	if label, ok := reportReasonLabels[reason]; ok {
		return label
	}
	return firstNonEmpty(reason, "Other")
}

func appURL(app core.App) string {
	return strings.TrimRight(app.Settings().Meta.AppURL, "/")
}
