package platformadmin

import (
	"net/http"
	"net/mail"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	gmail "gripello/internal/platform/mail"
	"gripello/internal/platform/secretbox"
)

type mailSettings struct {
	Host          string `json:"smtp_host"`
	Port          int    `json:"smtp_port"`
	Username      string `json:"smtp_username"`
	PasswordSet   bool   `json:"smtp_password_set"`
	TLS           bool   `json:"smtp_tls"`
	SenderAddress string `json:"sender_address"`
	SenderName    string `json:"sender_name"`
	Source        string `json:"source"`
}

// getMail shows the stored settings, or the environment's when none are stored; the password never leaves the server.
func (m *module) getMail(w http.ResponseWriter, r *http.Request) error {
	stored, err := gmail.Settings(r.Context(), m.app.DB, m.app.Tokens.Secret)
	if err != nil {
		return err
	}
	source := "database"
	if stored.Host == "" {
		stored, source = gmail.FromEnv(m.app.Cfg), "environment"
		if stored.Host == "" {
			source = "none"
		}
	}
	port, _ := strconv.Atoi(stored.Port)
	httpx.JSON(w, http.StatusOK, mailSettings{Host: stored.Host, Port: port, Username: stored.Username, PasswordSet: stored.Password != "",
		TLS: stored.TLS, SenderAddress: stored.SenderAddress, SenderName: stored.SenderName, Source: source})
	return nil
}

// putMail stores the settings (an empty host hands mail back to the environment); smtp_password left out keeps the stored one.
func (m *module) putMail(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Host          string  `json:"smtp_host"`
		Port          int     `json:"smtp_port"`
		Username      string  `json:"smtp_username"`
		Password      *string `json:"smtp_password"`
		TLS           bool    `json:"smtp_tls"`
		SenderAddress string  `json:"sender_address"`
		SenderName    string  `json:"sender_name"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	ctx := r.Context()
	p, _ := auth.From(ctx)
	if err := auth.RequireRecentReauth(ctx, m.app.DB, p); err != nil {
		return err
	}
	body.Host, body.SenderAddress, body.SenderName = strings.TrimSpace(body.Host), strings.TrimSpace(body.SenderAddress), strings.TrimSpace(body.SenderName)
	invalid := httpx.BadRequest("Failed to validate.")
	if body.Host != "" {
		if body.Port < 1 || body.Port > 65535 {
			invalid.Field("smtp_port", "validation_invalid_port", "Must be between 1 and 65535.")
		}
		if _, err := mail.ParseAddress(body.SenderAddress); err != nil || strings.ContainsAny(body.SenderAddress, "<> ") {
			invalid.Field("sender_address", "validation_invalid_email", "Must be a valid email address.")
		}
	}
	if strings.ContainsAny(body.Host+body.Username+body.SenderName, "\r\n") {
		invalid.Field("smtp_host", "validation_invalid_value", "Line breaks are not allowed.")
	}
	if len(invalid.Data) > 0 {
		return invalid
	}
	if body.Port == 0 {
		body.Port = 587
	}
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		var before struct {
			Host, Username, Password, SenderAddress, SenderName string
			Port                                                int
			TLS                                                 bool
		}
		if err := tx.QueryRow(ctx, `SELECT smtp_host, smtp_port, smtp_username, smtp_password, smtp_tls, sender_address, sender_name FROM platform_config FOR UPDATE`).
			Scan(&before.Host, &before.Port, &before.Username, &before.Password, &before.TLS, &before.SenderAddress, &before.SenderName); err != nil {
			return err
		}
		password := before.Password
		if body.Password != nil {
			sealed, err := secretbox.Seal(m.app.Tokens.Secret, *body.Password)
			if err != nil {
				return err
			}
			password = sealed
		}
		changed := []string{}
		for field, differs := range map[string]bool{
			"smtp_host": body.Host != before.Host, "smtp_port": body.Port != before.Port, "smtp_username": body.Username != before.Username,
			"smtp_password": body.Password != nil, "smtp_tls": body.TLS != before.TLS, "sender_address": body.SenderAddress != before.SenderAddress,
			"sender_name": body.SenderName != before.SenderName,
		} {
			if differs {
				changed = append(changed, field)
			}
		}
		if len(changed) == 0 {
			return nil
		}
		slices.Sort(changed)
		if _, err := tx.Exec(ctx, `UPDATE platform_config SET smtp_host = $1, smtp_port = $2, smtp_username = $3, smtp_password = $4, smtp_tls = $5,
			sender_address = $6, sender_name = $7, updated = now()`, body.Host, body.Port, body.Username, password, body.TLS, body.SenderAddress, body.SenderName); err != nil {
			return err
		}
		return events.PublishAs(ctx, tx, p.UserID, "platform", "platform_config.updated", map[string]any{"id": "platformconfig", "changed": changed}, events.Audience{PlatformAdmins: true})
	})
	if err != nil {
		return err
	}
	return m.getMail(w, r)
}

// sendTestMail delivers to the caller over the live transport, so a wrong setup shows up as the SMTP error.
func (m *module) sendTestMail(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	p, _ := auth.From(ctx)
	if !m.testMails.Allow(p.UserID, time.Now()) {
		return httpx.NewError(http.StatusTooManyRequests, "Too many test mails, try again in a minute.")
	}
	if c, ok := m.app.Mail.(interface{ Configured() bool }); ok && !c.Configured() {
		return httpx.NewError(http.StatusConflict, "Mail is not configured.")
	}
	var t target
	if err := m.app.DB.QueryRow(ctx, `SELECT email, firstname, language FROM users WHERE id = $1`, p.UserID).Scan(&t.Email, &t.Firstname, &t.Language); err != nil {
		return err
	}
	if t.Email == "" {
		return httpx.BadRequest("Your account has no email address.")
	}
	content := gmail.Content{Key: "mailTest", Name: t.Firstname}
	if _, err := m.app.MailTemplates.Send(ctx, m.app.Mail, m.app.MailTemplates.AppBrand(), content, []gmail.Recipient{{Address: t.Email, Language: t.Language}}); err != nil {
		return httpx.BadRequest("Sending failed: "+err.Error()).Field("smtp", gmail.FailedStage(err), err.Error())
	}
	return httpx.NoContent(w, nil)
}
