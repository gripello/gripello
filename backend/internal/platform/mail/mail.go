package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"log/slog"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"slices"
	"strings"
	"time"

	"gripello/internal/platform/config"
)

type Message struct {
	To       []string
	FromName string
	ReplyTo  string
	Subject  string
	HTML     string
	Text     string
}

type Client struct {
	senderName string
	deliver    func(context.Context, Message) error
}

// New sends over SMTP when SMTP_HOST is set and only logs otherwise.
func New(cfg config.Config) *Client {
	c := &Client{senderName: cfg.SenderName, deliver: logMessage}
	if cfg.SMTPHost != "" {
		c.deliver = smtpTransport(cfg)
	}
	return c
}

// Status is the GET /mail-status body.
func Status(cfg config.Config) map[string]bool {
	return map[string]bool{"configured": cfg.SMTPHost != ""}
}

func (c *Client) Send(ctx context.Context, to, subject, html, text string) error {
	return c.SendMessage(ctx, Message{To: []string{to}, Subject: subject, HTML: html, Text: text})
}

func (c *Client) SendMessage(ctx context.Context, m Message) error {
	if m.FromName == "" {
		m.FromName = c.senderName
	}
	return c.deliver(ctx, m)
}

func logMessage(_ context.Context, m Message) error {
	slog.Info("mail (SMTP not configured)", "to", m.To, "subject", m.Subject)
	return nil
}

func smtpTransport(cfg config.Config) func(context.Context, Message) error {
	addr := net.JoinHostPort(cfg.SMTPHost, cfg.SMTPPort)
	var auth smtp.Auth
	if cfg.SMTPUsername != "" {
		auth = smtp.PlainAuth("", cfg.SMTPUsername, cfg.SMTPPassword, cfg.SMTPHost)
	}
	return func(ctx context.Context, m Message) error {
		body, err := compose(cfg.SenderAddress, m)
		if err != nil {
			return err
		}
		// Like PocketBase: TLS means implicit TLS (SMTPS); otherwise net/smtp upgrades via STARTTLS when offered.
		if !cfg.SMTPTLS {
			return smtp.SendMail(addr, auth, cfg.SenderAddress, m.To, body)
		}
		dialer := tls.Dialer{Config: &tls.Config{ServerName: cfg.SMTPHost}}
		conn, err := dialer.DialContext(ctx, "tcp", addr)
		if err != nil {
			return err
		}
		client, err := smtp.NewClient(conn, cfg.SMTPHost)
		if err != nil {
			conn.Close()
			return err
		}
		defer client.Close()
		if auth != nil {
			if err := client.Auth(auth); err != nil {
				return err
			}
		}
		if err := client.Mail(cfg.SenderAddress); err != nil {
			return err
		}
		for _, to := range m.To {
			if err := client.Rcpt(to); err != nil {
				return err
			}
		}
		w, err := client.Data()
		if err != nil {
			return err
		}
		if _, err := w.Write(body); err != nil {
			return err
		}
		if err := w.Close(); err != nil {
			return err
		}
		return client.Quit()
	}
}

func compose(sender string, m Message) ([]byte, error) {
	var buf bytes.Buffer
	from := mail.Address{Name: m.FromName, Address: sender}
	var to []string
	addresses := m.To
	if m.ReplyTo != "" {
		addresses = append(slices.Clip(m.To), m.ReplyTo)
	}
	for _, address := range addresses {
		if _, err := mail.ParseAddress(address); err != nil {
			return nil, fmt.Errorf("mail: invalid address %q", address)
		}
	}
	for _, address := range m.To {
		to = append(to, (&mail.Address{Address: address}).String())
	}
	id := make([]byte, 12)
	rand.Read(id)
	domain := sender[strings.LastIndex(sender, "@")+1:]
	writer := multipart.NewWriter(&buf)
	header := []string{
		"From: " + from.String(),
		"To: " + strings.Join(to, ", "),
		"Subject: " + mime.QEncoding.Encode("utf-8", m.Subject),
		"Date: " + time.Now().Format(time.RFC1123Z),
		"Message-ID: <" + hex.EncodeToString(id) + "@" + domain + ">",
		"MIME-Version: 1.0",
		"Content-Type: multipart/alternative; boundary=" + writer.Boundary(),
	}
	if m.ReplyTo != "" {
		header = append(header, "Reply-To: "+(&mail.Address{Address: m.ReplyTo}).String())
	}
	for _, line := range header {
		if strings.ContainsAny(line, "\r\n") {
			return nil, fmt.Errorf("mail: header injection in %q", line)
		}
		buf.WriteString(line + "\r\n")
	}
	buf.WriteString("\r\n")
	for _, part := range []struct{ contentType, body string }{{"text/plain", m.Text}, {"text/html", m.HTML}} {
		if part.body == "" {
			continue
		}
		w, err := writer.CreatePart(textproto.MIMEHeader{
			"Content-Type":              {part.contentType + "; charset=utf-8"},
			"Content-Transfer-Encoding": {"quoted-printable"},
		})
		if err != nil {
			return nil, err
		}
		qp := quotedprintable.NewWriter(w)
		qp.Write([]byte(part.body))
		qp.Close()
	}
	writer.Close()
	return buf.Bytes(), nil
}
