package mail

import (
	"bytes"
	"context"
	"embed"
	htmltemplate "html/template"
	"slices"
	"strings"
	texttemplate "text/template"

	"gripello/internal/platform/config"
	"gripello/internal/platform/locales"
)

//go:embed templates/layout.html templates/layout.txt
var layouts embed.FS

var (
	htmlLayout = htmltemplate.Must(htmltemplate.ParseFS(layouts, "templates/layout.html"))
	textLayout = texttemplate.Must(texttemplate.ParseFS(layouts, "templates/layout.txt"))
)

// Content is one mail before translation; Key selects mails.<Key>.subject/body/action/note in the locales.
type Content struct {
	Key    string
	Name   string
	Params map[string]any
	// ParamKeys are i18n keys translated per recipient language before they fill a placeholder.
	ParamKeys map[string]string
	Lines     []string
	Details   []Detail
	Code      string
	Action    string
	Outro     []string
}

type Detail struct {
	Label    string
	Value    string
	ValueKey string
	Link     string
}

// Brand is the sender identity: the gym when the mail belongs to one, else the app.
type Brand struct {
	Name       string
	Subject    string
	Language   string
	ReplyTo    string
	ImprintURL string
	PrivacyURL string
}

type Recipient struct {
	Address  string
	Language string
}

type Rendered struct {
	Subject string
	HTML    string
	Text    string
}

type link struct {
	Label string
	URL   string
}

type view struct {
	Language    string
	Subject     string
	Brand       string
	Greeting    string
	Paragraphs  []string
	Details     []Detail
	Code        string
	ActionLabel string
	ActionURL   string
	LinkHint    string
	Outro       []string
	Note        string
	FooterLinks []link
}

func Verification(name, token string) Content {
	return Content{Key: "verification", Name: name, Action: "/auth/confirm-verification/" + token}
}

func PasswordReset(name, token string) Content {
	return Content{Key: "passwordReset", Name: name, Action: "/auth/confirm-password-reset/" + token}
}

func EmailChange(name, token string) Content {
	return Content{Key: "emailChange", Name: name, Action: "/auth/confirm-email-change/" + token}
}

func OTP(name, code string) Content {
	return Content{Key: "otp", Name: name, Code: code}
}

func AuthAlert(name, info string) Content {
	return Content{Key: "authAlert", Name: name, Details: []Detail{{Label: "location", Value: info}}}
}

func Invite(name, role, token string) Content {
	return Content{Key: "invite", Name: name, Params: map[string]any{"role": role}, Action: "/auth/invite/" + token}
}

type Templates struct {
	Messages locales.Messages
	AppName  string
	AppURL   string
}

func NewTemplates(cfg config.Config, messages locales.Messages) *Templates {
	return &Templates{Messages: messages, AppName: cfg.AppName, AppURL: strings.TrimRight(cfg.AppURL, "/")}
}

// Sender is platform.Mailer; one that also has SendMessage gets the brand's sender name and Reply-To.
type Sender interface {
	Send(ctx context.Context, to, subject, html, text string) error
}

type messageSender interface {
	SendMessage(ctx context.Context, m Message) error
}

// AppBrand is the brand of mails that belong to no gym (auth mails, platform notices).
func (c *Templates) AppBrand() Brand {
	return Brand{Name: c.AppName, ImprintURL: c.AppURL + "/imprint", PrivacyURL: c.AppURL + "/privacy"}
}

func AbsoluteURL(base, target string) string {
	if target == "" || strings.HasPrefix(target, "http") {
		return target
	}
	return base + target
}

func (c *Templates) Render(brand Brand, language string, content Content) (Rendered, error) {
	t := func(key string, params map[string]any) string {
		return c.Messages.Translate(language, key, params)
	}
	params := map[string]any{"gym": brand.Name, "app": c.AppName}
	for name, value := range content.Params {
		params[name] = value
	}
	for name, paramKey := range content.ParamKeys {
		params[name] = t(paramKey, nil)
	}
	key := "mails." + content.Key

	v := view{
		Language: language,
		Subject:  subject(t(key+".subject", params), brand.Subject, c.AppName),
		Brand:    brand.Name,
		Code:     content.Code,
		Note:     t(key+".note", params),
		FooterLinks: []link{
			{Label: t("mails.imprint", nil), URL: brand.ImprintURL},
			{Label: t("mails.privacy", nil), URL: brand.PrivacyURL},
		},
	}
	if content.Name != "" {
		v.Greeting = t("mails.greeting", map[string]any{"name": content.Name})
	} else {
		v.Greeting = t("mails.greetingAnonymous", nil)
	}
	v.Paragraphs = paragraphs(t(key+".body", params))
	for _, line := range content.Lines {
		v.Paragraphs = append(v.Paragraphs, paragraphs(t(line, params))...)
	}
	for _, detail := range content.Details {
		value := detail.Value
		if detail.ValueKey != "" {
			value = firstNonEmpty(t(detail.ValueKey, nil), value)
		}
		v.Details = append(v.Details, Detail{
			Label: t("mails.labels."+detail.Label, nil),
			Value: firstNonEmpty(value, t("mails.unavailable", nil)),
			Link:  detail.Link,
		})
	}
	if content.Action != "" {
		v.ActionURL = AbsoluteURL(c.AppURL, content.Action)
		v.ActionLabel = t(key+".action", params)
		v.LinkHint = t("mails.linkHint", nil)
	}
	for _, line := range content.Outro {
		v.Outro = append(v.Outro, paragraphs(t(line, params))...)
	}

	var htmlBody, textBody bytes.Buffer
	if err := htmlLayout.Execute(&htmlBody, v); err != nil {
		return Rendered{}, err
	}
	if err := textLayout.Execute(&textBody, v); err != nil {
		return Rendered{}, err
	}
	return Rendered{Subject: v.Subject, HTML: htmlBody.String(), Text: textBody.String()}, nil
}

// Send renders once per language (recipient language → brand language → en) and reports whether anything went out.
func (c *Templates) Send(ctx context.Context, sender Sender, brand Brand, content Content, recipients []Recipient) (bool, error) {
	groups, languages := c.GroupByLanguage(recipients, brand.Language)
	sent := false
	for _, language := range languages {
		rendered, err := c.Render(brand, language, content)
		if err != nil {
			return sent, err
		}
		message := Message{To: groups[language], FromName: brand.Subject, ReplyTo: brand.ReplyTo, Subject: rendered.Subject, HTML: rendered.HTML, Text: rendered.Text}
		if err := deliver(ctx, sender, message); err != nil {
			return sent, err
		}
		sent = true
	}
	return sent, nil
}

func deliver(ctx context.Context, sender Sender, m Message) error {
	if ms, ok := sender.(messageSender); ok {
		return ms.SendMessage(ctx, m)
	}
	for _, to := range m.To {
		if err := sender.Send(ctx, to, m.Subject, m.HTML, m.Text); err != nil {
			return err
		}
	}
	return nil
}

func (c *Templates) GroupByLanguage(recipients []Recipient, fallback string) (map[string][]string, []string) {
	groups := map[string][]string{}
	var order []string
	seen := map[string]bool{}
	for _, recipient := range recipients {
		address := strings.ToLower(strings.TrimSpace(recipient.Address))
		if address == "" || seen[address] {
			continue
		}
		seen[address] = true
		language := c.Messages.Language(recipient.Language, fallback)
		if !slices.Contains(order, language) {
			order = append(order, language)
		}
		groups[language] = append(groups[language], recipient.Address)
	}
	return groups, order
}

func subject(text, gymName, appName string) string {
	return text + " - " + firstNonEmpty(gymName, appName)
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

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
