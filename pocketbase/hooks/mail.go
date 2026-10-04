package hooks

import (
	"bytes"
	"embed"
	htmltemplate "html/template"
	"net/mail"
	"slices"
	"strings"
	texttemplate "text/template"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/mailer"
)

//go:embed mail/layout.html mail/layout.txt
var mailLayouts embed.FS

var (
	mailHTMLLayout = htmltemplate.Must(htmltemplate.ParseFS(mailLayouts, "mail/layout.html"))
	mailTextLayout = texttemplate.Must(texttemplate.ParseFS(mailLayouts, "mail/layout.txt"))
)

type mailContent struct {
	Key    string
	Gym    string
	Name   string
	Params map[string]any
	// ParamKeys are i18n keys translated per recipient language before they fill a placeholder.
	ParamKeys map[string]string
	Lines     []string
	Details   []mailDetail
	Code      string
	Action    string
	Outro     []string
}

type mailDetail struct {
	Label    string
	Value    string
	ValueKey string
	Link     string
}

type mailRecipient struct {
	Address  string
	Language string
}

type mailLink struct {
	Label string
	URL   string
}

type mailView struct {
	Language    string
	Subject     string
	Brand       string
	Greeting    string
	Paragraphs  []string
	Details     []mailDetail
	Code        string
	ActionLabel string
	ActionURL   string
	LinkHint    string
	Outro       []string
	Note        string
	FooterLinks []mailLink
}

type mailBrand struct {
	Name       string
	Subject    string
	Language   string
	ReplyTo    string
	ImprintURL string
	PrivacyURL string
}

type renderedMail struct {
	Subject string
	HTML    string
	Text    string
}

func loadMailBrand(app core.App, gymID string) mailBrand {
	base := appURL(app)
	brand := mailBrand{
		Name:       app.Settings().Meta.AppName,
		ImprintURL: base + "/imprint",
		PrivacyURL: base + "/privacy",
	}
	settings, _ := app.FindRecordById("settings", platformSettingsID)
	if settings != nil {
		brand.ReplyTo = settings.GetString("contact_email")
	}
	gym, _ := app.FindRecordById("gyms", gymID)
	if gym == nil {
		return brand
	}
	brand.Name = firstNonEmpty(gym.GetString("name"), brand.Name)
	brand.Subject = gym.GetString("name")
	brand.Language = gym.GetString("language")
	brand.ReplyTo = firstNonEmpty(gym.GetString("contact_email"), brand.ReplyTo)
	brand.ImprintURL = base + gymPath(app, gymID, "/imprint")
	brand.PrivacyURL = base + gymPath(app, gymID, "/privacy")
	return brand
}

func absoluteURL(base, target string) string {
	if target == "" || strings.HasPrefix(target, "http") {
		return target
	}
	return base + target
}

func renderMail(messages localeMessages, brand mailBrand, base, appName, language string, content mailContent) (renderedMail, error) {
	t := func(key string, params map[string]any) string {
		return messages.translate(language, key, params)
	}
	params := map[string]any{"gym": brand.Name, "app": appName}
	for name, value := range content.Params {
		params[name] = value
	}
	for name, paramKey := range content.ParamKeys {
		params[name] = t(paramKey, nil)
	}
	key := "mails." + content.Key

	view := mailView{
		Language: language,
		Subject:  mailSubject(t(key+".subject", params), brand.Subject, appName),
		Brand:    brand.Name,
		Code:     content.Code,
		Note:     t(key+".note", params),
		FooterLinks: []mailLink{
			{Label: t("mails.imprint", nil), URL: brand.ImprintURL},
			{Label: t("mails.privacy", nil), URL: brand.PrivacyURL},
		},
	}
	if content.Name != "" {
		view.Greeting = t("mails.greeting", map[string]any{"name": content.Name})
	} else {
		view.Greeting = t("mails.greetingAnonymous", nil)
	}
	view.Paragraphs = paragraphs(t(key+".body", params))
	for _, line := range content.Lines {
		view.Paragraphs = append(view.Paragraphs, paragraphs(t(line, params))...)
	}
	for _, detail := range content.Details {
		value := detail.Value
		if detail.ValueKey != "" {
			value = firstNonEmpty(t(detail.ValueKey, nil), value)
		}
		view.Details = append(view.Details, mailDetail{
			Label: t("mails.labels."+detail.Label, nil),
			Value: firstNonEmpty(value, t("mails.unavailable", nil)),
			Link:  detail.Link,
		})
	}
	if content.Action != "" {
		view.ActionURL = absoluteURL(base, content.Action)
		view.ActionLabel = t(key+".action", params)
		view.LinkHint = t("mails.linkHint", nil)
	}
	for _, line := range content.Outro {
		view.Outro = append(view.Outro, paragraphs(t(line, params))...)
	}

	var htmlBody, textBody bytes.Buffer
	if err := mailHTMLLayout.Execute(&htmlBody, view); err != nil {
		return renderedMail{}, err
	}
	if err := mailTextLayout.Execute(&textBody, view); err != nil {
		return renderedMail{}, err
	}
	return renderedMail{Subject: view.Subject, HTML: htmlBody.String(), Text: textBody.String()}, nil
}

func paragraphs(text string) []string {
	var result []string
	for _, paragraph := range strings.Split(text, "\n\n") {
		if paragraph = strings.TrimSpace(paragraph); paragraph != "" {
			result = append(result, paragraph)
		}
	}
	return result
}

func usersAsRecipients(users []*core.Record) []mailRecipient {
	var recipients []mailRecipient
	for _, user := range users {
		recipients = append(recipients, mailRecipient{Address: user.GetString("email"), Language: user.GetString("language")})
	}
	return recipients
}

func recipientsByLanguage(messages localeMessages, recipients []mailRecipient, fallback string) (map[string][]mail.Address, []string) {
	groups := map[string][]mail.Address{}
	var order []string
	seen := map[string]bool{}
	for _, recipient := range recipients {
		address := strings.ToLower(strings.TrimSpace(recipient.Address))
		if address == "" || seen[address] {
			continue
		}
		seen[address] = true
		language := messages.language(recipient.Language, fallback)
		if !slices.Contains(order, language) {
			order = append(order, language)
		}
		groups[language] = append(groups[language], mail.Address{Address: recipient.Address})
	}
	return groups, order
}

func sendGymMail(app core.App, content mailContent, recipients []mailRecipient) (bool, error) {
	messages := loadedLocales(app)
	brand := loadMailBrand(app, content.Gym)
	groups, languages := recipientsByLanguage(messages, recipients, brand.Language)
	meta := app.Settings().Meta
	sent := false
	for _, language := range languages {
		rendered, err := renderMail(messages, brand, appURL(app), meta.AppName, language, content)
		if err != nil {
			return sent, err
		}
		message := &mailer.Message{
			From:    mail.Address{Address: meta.SenderAddress, Name: firstNonEmpty(brand.Subject, meta.SenderName)},
			To:      groups[language],
			Subject: rendered.Subject,
			HTML:    rendered.HTML,
			Text:    rendered.Text,
		}
		if brand.ReplyTo != "" {
			message.Headers = map[string]string{"Reply-To": brand.ReplyTo}
		}
		if err := app.NewMailClient().Send(message); err != nil {
			return sent, err
		}
		sent = true
	}
	return sent, nil
}

func registerAuthMails(app core.App) {
	rewrite := func(content func(e *core.MailerRecordEvent) mailContent) func(e *core.MailerRecordEvent) error {
		return func(e *core.MailerRecordEvent) error {
			messages := loadedLocales(e.App)
			brand := loadMailBrand(e.App, "")
			language := messages.language(e.Record.GetString("language"))
			rendered, err := renderMail(messages, brand, appURL(e.App), e.App.Settings().Meta.AppName, language, content(e))
			if err != nil {
				return err
			}
			e.Message.Subject = rendered.Subject
			e.Message.HTML = rendered.HTML
			e.Message.Text = rendered.Text
			return e.Next()
		}
	}
	token := func(e *core.MailerRecordEvent) string {
		value, _ := e.Meta["token"].(string)
		return value
	}
	name := func(e *core.MailerRecordEvent) string {
		return e.Record.GetString("firstname")
	}

	app.OnMailerRecordVerificationSend("users").BindFunc(rewrite(func(e *core.MailerRecordEvent) mailContent {
		return mailContent{Key: "verification", Name: name(e), Action: "/auth/confirm-verification/" + token(e)}
	}))
	app.OnMailerRecordPasswordResetSend("users").BindFunc(rewrite(func(e *core.MailerRecordEvent) mailContent {
		return mailContent{Key: "passwordReset", Name: name(e), Action: "/auth/confirm-password-reset/" + token(e)}
	}))
	app.OnMailerRecordEmailChangeSend("users").BindFunc(rewrite(func(e *core.MailerRecordEvent) mailContent {
		return mailContent{Key: "emailChange", Name: name(e), Action: "/auth/confirm-email-change/" + token(e)}
	}))
	app.OnMailerRecordOTPSend("users").BindFunc(rewrite(func(e *core.MailerRecordEvent) mailContent {
		password, _ := e.Meta["password"].(string)
		return mailContent{Key: "otp", Name: name(e), Code: password}
	}))
	app.OnMailerRecordAuthAlertSend("users").BindFunc(rewrite(func(e *core.MailerRecordEvent) mailContent {
		info, _ := e.Meta["info"].(string)
		return mailContent{Key: "authAlert", Name: name(e), Details: []mailDetail{{Label: "location", Value: info}}}
	}))
}
