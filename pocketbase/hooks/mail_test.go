package hooks

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/mails"
)

var realLocalesDir = filepath.Join("..", "..", "i18n", "locales")

func TestMain(m *testing.M) {
	os.Setenv("PB_LOCALES_DIR", realLocalesDir)
	os.Exit(m.Run())
}

var leftoverPlaceholder = regexp.MustCompile(`\{[a-zA-Z]+\}`)

func testBrand() mailBrand {
	return mailBrand{Name: "Boulderhalle Nord", Subject: "Boulderhalle Nord", ImprintURL: "https://gym.example/nord/imprint", PrivacyURL: "https://gym.example/nord/privacy"}
}

func TestEveryMailRendersInEveryLocale(t *testing.T) {
	messages := loadLocales(realLocalesDir)
	params := map[string]any{"route": "Arete", "problem": "Loose hold", "email": "gym@example.com"}
	for key, value := range messages.group("en", "mails") {
		group, _ := value.(map[string]any)
		if _, isMail := group["subject"]; !isMail {
			continue
		}
		for language := range messages {
			content := mailContent{Key: key, Name: "Alex", Params: params, Action: "/somewhere", Details: []mailDetail{{Label: "reason", Value: "x"}}}
			rendered, err := renderMail(messages, testBrand(), "https://gym.example", "Gripello", language, content)
			if err != nil {
				t.Fatalf("%s/%s: %v", language, key, err)
			}
			if messages.lookup(language, "mails."+key+".subject") == "" || messages.lookup(language, "mails."+key+".body") == "" {
				t.Errorf("%s/%s lacks subject or body", language, key)
			}
			for part, text := range map[string]string{"subject": rendered.Subject, "html": rendered.HTML, "text": rendered.Text} {
				if found := leftoverPlaceholder.FindString(text); found != "" {
					t.Errorf("%s/%s %s keeps placeholder %s", language, key, part, found)
				}
			}
			if !strings.Contains(rendered.Text, "https://gym.example/somewhere") || !strings.Contains(rendered.HTML, `lang="`+language+`"`) {
				t.Errorf("%s/%s misses the action link or language", language, key)
			}
		}
	}
}

func TestMailEscapesUserText(t *testing.T) {
	messages := loadLocales(realLocalesDir)
	content := mailContent{Key: "reportAlert", Name: "<b>Eve</b>", Details: []mailDetail{{Label: "explanation", Value: "<script>alert(1)</script>"}}}
	rendered, err := renderMail(messages, testBrand(), "https://gym.example", "Gripello", "en", content)
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

func TestReportReceiptOmitsNotifierText(t *testing.T) {
	report := core.NewRecord(core.NewBaseCollection("reports"))
	report.Id = "ref123"
	report.Set("reason", "spam_fraud")
	report.Set("notifier_name", "Buy cheap pills")
	report.Set("explanation", "visit spam.example")
	report.Set("content_snapshot", "more spam")

	rendered, err := renderMail(loadLocales(realLocalesDir), testBrand(), "https://gym.example", "Gripello", "de", reportReceiptMail(report))
	if err != nil {
		t.Fatal(err)
	}
	for _, injected := range []string{"Buy cheap pills", "spam.example", "more spam"} {
		if strings.Contains(rendered.HTML, injected) {
			t.Errorf("receipt contains notifier-controlled text %q", injected)
		}
	}
	if !strings.Contains(rendered.HTML, "ref123") || !strings.Contains(rendered.HTML, "Spam oder Betrug") {
		t.Errorf("receipt lacks reference or translated reason: %s", rendered.HTML)
	}
}

func TestRecipientsAreGroupedByLanguage(t *testing.T) {
	messages := loadLocales(realLocalesDir)
	groups, order := recipientsByLanguage(messages, []mailRecipient{
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
	if got := messages.language("", ""); got != "en" {
		t.Errorf("no language falls back to %q", got)
	}
}

func TestUrgentDefectMailIsLocalizedPerStaffMember(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()

	f.gymA.Set("language", "fr")
	f.gymA.Set("contact_email", "front@nord.example")
	if err := f.app.Save(f.gymA); err != nil {
		t.Fatal(err)
	}
	f.adminA.Set("language", "de")
	if err := f.app.Save(f.adminA); err != nil {
		t.Fatal(err)
	}

	task := newTaskRecord()
	task.Set("gym", f.gymA.Id)
	task.Set("category", "loose_bolt")
	task.Set("description", "<script>alert(1)</script>")
	if _, err := sendGymMail(f.app, urgentDefectMail(f.app, task), usersAsRecipients([]*core.Record{f.adminA, f.setterA})); err != nil {
		t.Fatal(err)
	}

	subjects := map[string]string{}
	for _, message := range f.app.TestMailer.Messages() {
		for _, to := range message.To {
			subjects[to.Address] = message.Subject
		}
		if message.Headers["Reply-To"] != "front@nord.example" || message.From.Name != f.gymA.GetString("name") {
			t.Errorf("sender = %v, reply-to = %q", message.From, message.Headers["Reply-To"])
		}
		if strings.Contains(message.HTML, "<script>") || message.Text == "" {
			t.Errorf("unsafe html or missing text part")
		}
	}
	if !strings.HasPrefix(subjects[f.adminA.Email()], "Dringend: Lockere Schraube") {
		t.Errorf("admin (de) subject = %q", subjects[f.adminA.Email()])
	}
	if !strings.HasPrefix(subjects[f.setterA.Email()], "Urgent : ") {
		t.Errorf("setter (gym default fr) subject = %q", subjects[f.setterA.Email()])
	}
}

func TestAuthMailsUseTheUserLanguage(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()

	f.climber.Set("language", "es")
	if err := f.app.Save(f.climber); err != nil {
		t.Fatal(err)
	}
	if err := mails.SendRecordPasswordReset(f.app, f.climber); err != nil {
		t.Fatal(err)
	}

	message := f.app.TestMailer.LastMessage()
	if !strings.HasPrefix(message.Subject, "Restablece tu contraseña") {
		t.Errorf("subject = %q", message.Subject)
	}
	if !strings.Contains(message.HTML, "/auth/confirm-password-reset/") || !strings.Contains(message.Text, "/auth/confirm-password-reset/") {
		t.Errorf("reset link missing: %s", message.Text)
	}
}
