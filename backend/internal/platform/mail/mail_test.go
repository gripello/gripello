package mail

import (
	"bufio"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/textproto"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"gripello/internal/platform/config"
	"gripello/internal/platform/locales"
	"gripello/internal/platform/secretbox"
	"gripello/internal/platform/testkit"
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
	params := map[string]any{"route": "Arete", "problem": "Loose hold", "email": "gym@example.com", "role": "routesetter", "date": "2026-11-18"}
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
	client := &Client{}
	client.current.Store(&transport{senderName: "Gripello", deliver: func(_ context.Context, m Message) error {
		sent = append(sent, m)
		return nil
	}})
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

func TestConfiguredFollowsTheSMTPHost(t *testing.T) {
	if New(config.Config{}).Configured() || !New(config.Config{SMTPHost: "smtp.example.com"}).Configured() {
		t.Error("configured must follow SMTP_HOST")
	}
}

func TestReloadPrefersStoredSettingsOverTheEnvironment(t *testing.T) {
	pool := testkit.Pool(t)
	ctx := context.Background()
	env := config.Config{SMTPHost: "env.example.com", SMTPPort: "587", SenderName: "Env"}
	c := New(config.Config{})
	if err := c.Reload(ctx, pool, env, "secret"); err != nil || !c.Configured() || c.current.Load().senderName != "Env" {
		t.Fatalf("env fallback: configured %v, sender %q, %v", c.Configured(), c.current.Load().senderName, err)
	}
	sealed, _ := secretbox.Seal("secret", "pw")
	if _, err := pool.Exec(ctx, `UPDATE platform_config SET smtp_host = 'db.example.com', smtp_password = $1, sender_name = 'Stored'`, sealed); err != nil {
		t.Fatal(err)
	}
	stored, err := Settings(ctx, pool, "secret")
	if err != nil || stored.Host != "db.example.com" || stored.Password != "pw" || stored.Port != "587" {
		t.Fatalf("settings = %+v, %v", stored, err)
	}
	if err := c.Reload(ctx, pool, config.Config{}, "secret"); err != nil || !c.Configured() || c.current.Load().senderName != "Stored" {
		t.Errorf("stored settings not applied: configured %v, sender %q", c.Configured(), c.current.Load().senderName)
	}
	if unreadable, _ := Settings(ctx, pool, "rotated"); unreadable.Password != "" || unreadable.Host != "db.example.com" {
		t.Errorf("password under a rotated secret = %+v", unreadable)
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

func TestTLSOnAStartTLSPortFallsBackToPlainSMTP(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	delivered := make(chan string, 1)
	go fakeSMTP(ln, delivered)

	host, port, _ := net.SplitHostPort(ln.Addr().String())
	send := smtpTransport(SMTP{Host: host, Port: port, TLS: true, SenderAddress: "noreply@example.com"})
	if err := send(context.Background(), Message{To: []string{"kim@example.com"}, Subject: "Hi", Text: "Hello"}); err != nil {
		t.Fatal(err)
	}
	if got := <-delivered; got != "kim@example.com" {
		t.Errorf("delivered to %q", got)
	}
}

// fakeSMTP answers the first connection (the failed TLS dial) by closing it and serves the second in plain text.
func fakeSMTP(ln net.Listener, delivered chan<- string) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		go func() {
			defer conn.Close()
			r := bufio.NewReader(conn)
			fmt.Fprint(conn, "220 fake\r\n")
			var rcpt string
			for {
				line, err := r.ReadString('\n')
				if err != nil {
					return
				}
				switch cmd := strings.ToUpper(strings.TrimSpace(line)); {
				case strings.HasPrefix(cmd, "EHLO"), strings.HasPrefix(cmd, "HELO"):
					fmt.Fprint(conn, "250 fake\r\n")
				case strings.HasPrefix(cmd, "RCPT TO:"):
					rcpt = strings.Trim(strings.TrimSpace(line)[len("RCPT TO:"):], "<>")
					fmt.Fprint(conn, "250 ok\r\n")
				case cmd == "DATA":
					fmt.Fprint(conn, "354 go\r\n")
					for l, _ := r.ReadString('\n'); l != ".\r\n" && l != ""; l, _ = r.ReadString('\n') {
					}
					fmt.Fprint(conn, "250 ok\r\n")
					delivered <- rcpt
				case cmd == "QUIT":
					fmt.Fprint(conn, "221 bye\r\n")
					return
				default:
					fmt.Fprint(conn, "250 ok\r\n")
				}
			}
		}()
	}
}

func TestFailedStageNamesTheBrokenStep(t *testing.T) {
	for err, want := range map[error]string{
		&net.OpError{Op: "dial", Err: errors.New("connection refused")}:               "connect",
		tls.RecordHeaderError{Msg: "first record does not look like a TLS handshake"}: "encrypt",
		&textproto.Error{Code: 535, Msg: "Authentication credentials invalid"}:        "sign_in",
		fmt.Errorf("send: %v", &textproto.Error{Code: 535, Msg: "invalid"}):           "sign_in",
		&textproto.Error{Code: 550, Msg: "mailbox unavailable"}:                       "deliver",
	} {
		if got := FailedStage(err); got != want {
			t.Errorf("%v = %s, want %s", err, got, want)
		}
	}
}

func TestStallingServerTimesOut(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			defer conn.Close()
		}
	}()
	defer func(previous time.Duration) { smtpTimeout = previous }(smtpTimeout)
	smtpTimeout = 200 * time.Millisecond

	host, port, _ := net.SplitHostPort(ln.Addr().String())
	for _, implicitTLS := range []bool{false, true} {
		send := smtpTransport(SMTP{Host: host, Port: port, TLS: implicitTLS, SenderAddress: "noreply@example.com"})
		started := time.Now()
		err := send(context.Background(), Message{To: []string{"kim@example.com"}, Subject: "Hi", Text: "Hello"})
		if err == nil || time.Since(started) > 2*time.Second {
			t.Fatalf("TLS=%v: err %v after %s", implicitTLS, err, time.Since(started))
		}
	}
}

func TestSenderAddressFollowsTheSettingsInUse(t *testing.T) {
	c := &Client{}
	c.Use(SMTP{SenderAddress: "env@example.com"})
	c.Use(SMTP{Host: "smtp.example.com", Port: "587", SenderAddress: "platform@example.com"})
	if got := c.SenderAddress(); got != "platform@example.com" {
		t.Errorf("sender address = %q, want the settings applied last", got)
	}
}
