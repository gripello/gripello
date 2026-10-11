package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/config"
	"gripello/internal/platform/secretbox"
)

type Message struct {
	To       []string
	FromName string
	ReplyTo  string
	Subject  string
	HTML     string
	Text     string
}

// SMTP is one delivery setup, from the environment or from the platform settings.
type SMTP struct {
	Host, Port, Username, Password string
	TLS                            bool
	SenderAddress, SenderName      string
}

func FromEnv(cfg config.Config) SMTP {
	return SMTP{Host: cfg.SMTPHost, Port: cfg.SMTPPort, Username: cfg.SMTPUsername, Password: cfg.SMTPPassword, TLS: cfg.SMTPTLS,
		SenderAddress: cfg.SenderAddress, SenderName: cfg.SenderName}
}

type transport struct {
	senderName    string
	senderAddress string
	configured    bool
	deliver       func(context.Context, Message) error
}

// Client swaps its transport at runtime, so modules keep the instance they got at Register.
type Client struct {
	current atomic.Pointer[transport]
}

// New sends over SMTP when SMTP_HOST is set and only logs otherwise.
func New(cfg config.Config) *Client {
	c := &Client{}
	c.Use(FromEnv(cfg))
	return c
}

func (c *Client) Use(s SMTP) {
	t := &transport{senderName: s.SenderName, senderAddress: s.SenderAddress, deliver: logMessage}
	if s.Host != "" {
		t.configured, t.deliver = true, smtpTransport(s)
	}
	c.current.Store(t)
}

// SenderAddress is the From address in use, from the platform settings or the environment.
func (c *Client) SenderAddress() string {
	return c.current.Load().senderAddress
}

// Configured is the GET /mail-status body.
func (c *Client) Configured() bool {
	return c.current.Load().configured
}

type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Settings reads the platform's mail settings; an empty host means the environment applies.
func Settings(ctx context.Context, q querier, secret string) (SMTP, error) {
	var s SMTP
	var port int
	var sealed string
	err := q.QueryRow(ctx, `SELECT smtp_host, smtp_port, smtp_username, smtp_password, smtp_tls, sender_address, sender_name FROM platform_config`).
		Scan(&s.Host, &port, &s.Username, &sealed, &s.TLS, &s.SenderAddress, &s.SenderName)
	if err != nil {
		return s, err
	}
	s.Port = strconv.Itoa(port)
	if s.Password, err = secretbox.Open(secret, sealed); err != nil {
		slog.Warn("mail: stored SMTP password is unreadable, re-enter it in the platform settings", "error", err)
		s.Password = ""
	}
	return s, nil
}

// Reload applies the platform's mail settings, or the environment when none are stored.
func (c *Client) Reload(ctx context.Context, q querier, cfg config.Config, secret string) error {
	s, err := Settings(ctx, q, secret)
	if err != nil {
		return err
	}
	if s.Host == "" {
		s = FromEnv(cfg)
	} else if s.SenderName == "" {
		s.SenderName = cfg.SenderName
	}
	c.Use(s)
	return nil
}

func (c *Client) Send(ctx context.Context, to, subject, html, text string) error {
	return c.SendMessage(ctx, Message{To: []string{to}, Subject: subject, HTML: html, Text: text})
}

func (c *Client) SendMessage(ctx context.Context, m Message) error {
	t := c.current.Load()
	if m.FromName == "" {
		m.FromName = t.senderName
	}
	return t.deliver(ctx, m)
}

func logMessage(_ context.Context, m Message) error {
	slog.Info("mail (SMTP not configured)", "to", m.To, "subject", m.Subject)
	return nil
}

// smtpTimeout bounds a whole delivery (dial, TLS, conversation), so a stalling server can't hang the sender.
var smtpTimeout = 30 * time.Second

func smtpTransport(cfg SMTP) func(context.Context, Message) error {
	addr := net.JoinHostPort(cfg.Host, cfg.Port)
	var auth smtp.Auth
	if cfg.Username != "" {
		auth = smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
	}
	return func(ctx context.Context, m Message) error {
		body, err := compose(cfg.SenderAddress, m)
		if err != nil {
			return err
		}
		deadline := time.Now().Add(smtpTimeout)
		dialCtx, cancel := context.WithDeadline(ctx, deadline)
		defer cancel()
		// Like PocketBase: TLS means implicit TLS (SMTPS); otherwise upgrade via STARTTLS when offered.
		var conn net.Conn
		startTLS := !cfg.TLS
		if cfg.TLS {
			dialer := tls.Dialer{Config: &tls.Config{ServerName: cfg.Host}}
			conn, err = dialer.DialContext(dialCtx, "tcp", addr)
			// A STARTTLS port (587/25) answers in plain text; the plain connection still upgrades before sending credentials.
			_, startTLS = errors.AsType[tls.RecordHeaderError](err)
		}
		if startTLS {
			var dialer net.Dialer
			conn, err = dialer.DialContext(dialCtx, "tcp", addr)
		}
		if err != nil {
			return err
		}
		conn.SetDeadline(deadline)
		client, err := smtp.NewClient(conn, cfg.Host)
		if err != nil {
			conn.Close()
			return err
		}
		defer client.Close()
		if offered, _ := client.Extension("STARTTLS"); startTLS && offered {
			if err := client.StartTLS(&tls.Config{ServerName: cfg.Host}); err != nil {
				return err
			}
		}
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

var authFailure = regexp.MustCompile(`\b53[0458]\b`)

// FailedStage names the step of an SMTP delivery an error came from: connect, encrypt, sign_in or deliver.
func FailedStage(err error) string {
	var netErr *net.OpError
	var dnsErr *net.DNSError
	var recordErr tls.RecordHeaderError
	var certErr *tls.CertificateVerificationError
	var protoErr *textproto.Error
	switch {
	case errors.As(err, &recordErr), errors.As(err, &certErr), strings.Contains(err.Error(), "tls:"), strings.Contains(err.Error(), "x509:"):
		return "encrypt"
	case errors.As(err, &dnsErr), errors.As(err, &netErr):
		return "connect"
	case errors.As(err, &protoErr) && (protoErr.Code == 530 || protoErr.Code == 534 || protoErr.Code == 535 || protoErr.Code == 538):
		return "sign_in"
	case authFailure.MatchString(err.Error()), strings.Contains(err.Error(), "unencrypted connection"), strings.Contains(err.Error(), "unknown authentication"):
		return "sign_in"
	}
	return "deliver"
}
