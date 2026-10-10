package mail

import (
	"context"
	"regexp"
	"slices"
	"strings"
	"testing"

	"gripello/internal/platform/config"
	"gripello/internal/platform/locales"
)

var leftoverPlaceholder = regexp.MustCompile(`\{[a-zA-Z]+\}`)

func testClient(t *testing.T) *Templates {
	messages := locales.Load("../../../../i18n/locales")
	if len(messages) == 0 {
		t.Fatal("no locales found")
	}
	return NewTemplates(config.Config{AppName: "Gripello", AppURL: "https://gym.example/"}, messages)
}

func testBrand() Brand {
	return Brand{Name: "Boulderhalle Nord", Subject: "Boulderhalle Nord", ImprintURL: "https://gym.example/nord/imprint", PrivacyURL: "https://gym.example/nord/privacy"}
}

func TestEveryMailRendersInEveryLocale(t *testing.T) {
	c := testClient(t)
	params := map[string]any{"route": "Arete", "problem": "Loose hold", "email": "gym@example.com", "role": "routesetter"}
	for key, value := range c.Messages.Group("en", "mails") {
		group, _ := value.(map[string]any)
		if _, isMail := group["subject"]; !isMail {
			continue
		}
		for language := range c.Messages {
			content := Content{Key: key, Name: "Alex", Params: params, Action: "/somewhere", Details: []Detail{{Label: "reason", Value: "x"}}}
			rendered, err := c.Render(testBrand(), language, content)
			if err != nil {
				t.Fatalf("%s/%s: %v", language, key, err)
			}
			if c.Messages.Lookup(language, "mails."+key+".subject") == "" || c.Messages.Lookup(language, "mails."+key+".body") == "" {
				t.Errorf("%s/%s lacks subject or body", language, key)
			}
			for part, text := range map[string]string{"subject": rendered.Subject, "html": rendered.HTML, "text": rendered.Text} {
				if found := leftoverPlaceholder.FindString(text); found != "" {
					t.Errorf("%s/%s %s keeps placeholder %s", language, key, part, found)
				}
			}
			if strings.Contains(rendered.HTML, "<img") {
				t.Errorf("%s/%s embeds an image", language, key)
			}
			if strings.Count(rendered.Subject, testBrand().Name) > 1 {
				t.Errorf("%s/%s subject names the gym twice: %s", language, key, rendered.Subject)
			}
			if !strings.Contains(rendered.Text, "https://gym.example/somewhere") || !strings.Contains(rendered.HTML, `lang="`+language+`"`) {
				t.Errorf("%s/%s misses the action link or language", language, key)
			}
		}
	}
}

func TestMailEscapesUserText(t *testing.T) {
	content := Content{Key: "reportAlert", Name: "<b>Eve</b>", Details: []Detail{{Label: "explanation", Value: "<script>alert(1)</script>"}}}
	rendered, err := testClient(t).Render(testBrand(), "en", content)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(rendered.HTML, "<script>") || strings.Contains(rendered.HTML, "<b>Eve</b>") {
		t.Errorf("unescaped user text in mail: %s", rendered.HTML)
	}
	if !strings.Contains(rendered.Text, "<script>alert(1)</script>") {
		t.Errorf("text part should carry the raw text: %s", rendered.Text)
	}
}

func TestReportReceiptTranslatesTheReason(t *testing.T) {
	content := Content{Key: "reportReceipt", Details: []Detail{
		{Label: "reason", ValueKey: "reports.reasons.spam_fraud", Value: "spam_fraud"},
		{Label: "reference", Value: "ref123"},
	}}
	rendered, err := testClient(t).Render(testBrand(), "de", content)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(rendered.HTML, "ref123") || !strings.Contains(rendered.HTML, "Spam oder Betrug") {
		t.Errorf("receipt lacks reference or translated reason: %s", rendered.HTML)
	}
}

func TestAuthMailsUseTheGivenLanguage(t *testing.T) {
	c := testClient(t)
	rendered, err := c.Render(c.AppBrand(), c.Messages.Language("es"), PasswordReset("Ana", "tok"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(rendered.Subject, "Restablece tu contraseña") || !strings.HasSuffix(rendered.Subject, " - Gripello") {
		t.Errorf("subject = %q", rendered.Subject)
	}
	if !strings.Contains(rendered.Text, "https://gym.example/auth/confirm-password-reset/tok") {
		t.Errorf("reset link missing: %s", rendered.Text)
	}
}

func TestRecipientsAreGroupedByLanguage(t *testing.T) {
	c := testClient(t)
	groups, order := c.GroupByLanguage([]Recipient{
		{Address: "de@example.com", Language: "de"},
		{Address: "none@example.com"},
		{Address: "ru@example.com", Language: "ru"},
		{Address: "DE@example.com", Language: "de"},
		{Address: ""},
	}, "nl")
	if !slices.Equal(order, []string{"de", "nl"}) {
		t.Fatalf("languages = %v", order)
	}
	if len(groups["de"]) != 1 || len(groups["nl"]) != 2 {
		t.Errorf("groups = %v", groups)
	}
	if got := c.Messages.Language("", ""); got != "en" {
		t.Errorf("no language falls back to %q", got)
	}
}

func TestUrgentDefectIsLocalizedPerRecipient(t *testing.T) {
	var sent []Message
	c := testClient(t)
	client := &Client{senderName: "Gripello", deliver: func(_ context.Context, m Message) error {
		sent = append(sent, m)
		return nil
	}}
	brand := testBrand()
	brand.Language = "fr"
	brand.ReplyTo = "front@nord.example"
	content := Content{
		Key:       "urgentDefect",
		Params:    map[string]any{"route": "Arete"},
		ParamKeys: map[string]string{"problem": "tasks.categories.loose_bolt"},
		Details:   []Detail{{Label: "details", Value: "<script>alert(1)</script>"}},
		Action:    "/nord/manage/tasks",
	}
	ok, err := c.Send(context.Background(), client, brand, content, []Recipient{{Address: "admin@example.com", Language: "de"}, {Address: "setter@example.com"}})
	if err != nil || !ok || len(sent) != 2 {
		t.Fatalf("sent %d, ok %v, err %v", len(sent), ok, err)
	}
	if !strings.HasPrefix(sent[0].Subject, "Dringend: Lockere Schraube") || !strings.HasPrefix(sent[1].Subject, "Urgent : ") {
		t.Errorf("subjects = %q, %q", sent[0].Subject, sent[1].Subject)
	}
	for _, m := range sent {
		if m.ReplyTo != "front@nord.example" || m.FromName != "Boulderhalle Nord" || strings.Contains(m.HTML, "<script>") || m.Text == "" {
			t.Errorf("message = %+v", m)
		}
	}
}

func TestComposeEncodesHeadersAndRejectsInjection(t *testing.T) {
	body, err := compose("no-reply@gripello.app", Message{To: []string{"a@example.com"}, FromName: "Halle Süd", ReplyTo: "r@example.com", Subject: "Grüße", HTML: "<p>x</p>", Text: "x"})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Subject: =?utf-8?q?Gr=C3=BC=C3=9Fe?=", "Reply-To: <r@example.com>", "text/plain; charset=utf-8", "text/html; charset=utf-8", "@gripello.app>"} {
		if !strings.Contains(string(body), want) {
			t.Errorf("missing %q in\n%s", want, body)
		}
	}
	if _, err := compose("no-reply@gripello.app", Message{To: []string{"a@example.com"}, Subject: "x\r\nBcc: evil@example.com"}); err != nil {
		t.Errorf("subject is Q-encoded, newline must not leak: %v", err)
	}
	if _, err := compose("no-reply@gripello.app", Message{To: []string{"a@example.com\r\nBcc: evil@example.com"}}); err == nil {
		t.Error("recipient with CRLF accepted")
	}
}

func TestStatusReflectsSMTPConfig(t *testing.T) {
	if Status(config.Config{})["configured"] || !Status(config.Config{SMTPHost: "smtp.example.com"})["configured"] {
		t.Error("configured must follow SMTP_HOST")
	}
}

func TestPlainSendersGetOneMailPerRecipient(t *testing.T) {
	var to []string
	sender := plainSender(func(address string) { to = append(to, address) })
	if _, err := testClient(t).Send(context.Background(), sender, testBrand(), Invite("Kim", "routesetter", "tok"), []Recipient{{Address: "a@example.com"}, {Address: "b@example.com"}}); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(to, []string{"a@example.com", "b@example.com"}) {
		t.Errorf("to = %v", to)
	}
}

type plainSender func(to string)

func (p plainSender) Send(_ context.Context, to, _, _, _ string) error {
	p(to)
	return nil
}
