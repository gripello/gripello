package main

import (
	"bytes"
	"context"
	"log/slog"
	"slices"
	"strings"
	"testing"
	"time"

	"gripello/internal/platform/ids"
	"gripello/internal/platform/testapp"
)

func TestPunycodeEmailsConvertsOnceAndSkipsCollisions(t *testing.T) {
	app := testapp.App(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := app.DB.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	user := func(email string) string {
		id := ids.New()
		exec(`INSERT INTO users (id, email, token_key, username) VALUES ($1, $2, $3, $4)`, id, email, ids.New()+ids.New(), "u"+strings.ToLower(id))
		return id
	}
	converted, taken, collides := user("max@müller.de"), user("eva@xn--mller-kva.de"), user("eva@müller.de")
	tooLongAddress := strings.Repeat("x", 60) + "@" + strings.Repeat("äbücödßeéfàgèhìiòjùkâlêmîn.", 5) + "de"
	tooLong := user(tooLongAddress)
	gym, role := ids.New(), ids.New()
	exec(`INSERT INTO gyms (id, slug, name, active) VALUES ($1, 'puny', 'Puny', true)`, gym)
	exec(`INSERT INTO roles (id, gym, name) VALUES ($1, $2, 'helper')`, role, gym)
	exec(`INSERT INTO invites (id, gym, role, email, token_hash, expires_at) VALUES ($1, $2, $3, 'jo@müller.de', $4, $5)`, ids.New(), gym, role, ids.New(), time.Now().Add(time.Hour))
	exec(`INSERT INTO gym_onboardings (id, email, token_hash, expires_at) VALUES ($1, 'jo@müller.de', $2, $3)`, ids.New(), ids.New(), time.Now().Add(time.Hour))
	exec(`INSERT INTO reports (id, content_type, content_id, content_url, reason, explanation, notifier_name, notifier_email, status)
		VALUES ($1, 'route', 'r', '/', 'other', 'x', 'Jo', 'jo@müller.de', 'open')`, ids.New())
	exec(`UPDATE platform_config SET blocked_emails = '{*@spam.test,bösewicht.de}', allowed_emails = '{ok@grüße.de}'`)

	var logs bytes.Buffer
	defer slog.SetDefault(slog.Default())
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	if err := punycodeEmails(ctx, app.DB); err != nil {
		t.Fatal(err)
	}
	email := func(id string) (address string) {
		app.DB.QueryRow(ctx, `SELECT email FROM users WHERE id = $1`, id).Scan(&address)
		return address
	}
	if got := email(converted); got != "max@xn--mller-kva.de" {
		t.Errorf("converted user has %q", got)
	}
	if email(taken) != "eva@xn--mller-kva.de" || email(collides) != "eva@müller.de" {
		t.Errorf("collision was not left alone: %q, %q", email(taken), email(collides))
	}
	if line := logs.String(); !strings.Contains(line, "level=ERROR") || !strings.Contains(line, collides) || !strings.Contains(line, taken) || strings.Contains(line, "eva@") {
		t.Errorf("collision log = %q", line)
	}
	if line := logs.String(); email(tooLong) != tooLongAddress || !strings.Contains(line, "converted address is invalid") || !strings.Contains(line, tooLong) {
		t.Errorf("an address too long once converted was not left alone: %q, %q", email(tooLong), line)
	}
	for _, table := range []string{"invites WHERE email", "gym_onboardings WHERE email", "reports WHERE notifier_email"} {
		var n int
		app.DB.QueryRow(ctx, `SELECT count(*) FROM `+table+` = 'jo@xn--mller-kva.de'`).Scan(&n)
		if n != 1 {
			t.Errorf("%s not converted", table)
		}
	}
	var blocked, allowed []string
	app.DB.QueryRow(ctx, `SELECT blocked_emails, allowed_emails FROM platform_config`).Scan(&blocked, &allowed)
	if !slices.Equal(blocked, []string{"*@spam.test", "xn--bsewicht-n4a.de"}) || !slices.Equal(allowed, []string{"ok@xn--gre-6ka8l.de"}) {
		t.Errorf("blocklists = %v, %v", blocked, allowed)
	}
	var updates int
	app.DB.QueryRow(ctx, `SELECT count(*) FROM events WHERE topic = $1 AND kind = 'user.updated'`, "user:"+converted).Scan(&updates)
	if updates != 1 {
		t.Errorf("user.updated published %d times", updates)
	}

	var before, after int
	app.DB.QueryRow(ctx, `SELECT count(*) FROM events`).Scan(&before)
	if err := punycodeEmails(ctx, app.DB); err != nil {
		t.Fatal(err)
	}
	app.DB.QueryRow(ctx, `SELECT count(*) FROM events`).Scan(&after)
	if after != before || email(converted) != "max@xn--mller-kva.de" || email(collides) != "eva@müller.de" {
		t.Errorf("second run changed something: %d → %d events", before, after)
	}
}
