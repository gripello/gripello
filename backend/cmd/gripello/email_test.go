package main

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"testing"

	platformmail "gripello/internal/platform/mail"
	"gripello/internal/platform/testapp"
)

var inviteToken = regexp.MustCompile(`/auth/invite/([A-Za-z0-9]+)`)

func TestEmailVerdictsIgnoreCase(t *testing.T) {
	w := newWorld(t)
	w.exec(`INSERT INTO settings (id, allow_registration) VALUES ('platformsetting', true) ON CONFLICT (id) DO UPDATE SET allow_registration = true`)
	const pw = "Correct horse 1"
	for i, pair := range [][2]string{{"Max@Example.com", "max@example.com"}, {"Info@MÜLLER.de", "info@müller.de"}} {
		typed, folded := pair[0], pair[1]
		username := []string{"maxi", "mueller"}[i]
		register := func(email, name string) int {
			return w.call("", "POST", "/auth/register", `{"email":"`+email+`","username":"`+name+`","password":"`+pw+`","passwordConfirm":"`+pw+`"}`).Code
		}
		if register(typed, username) != http.StatusAccepted || register(folded, username+"2") != http.StatusAccepted {
			t.Fatalf("%s: registration refused", typed)
		}
		var accounts int
		w.app.DB.QueryRow(context.Background(), `SELECT count(*) FROM users WHERE email = $1`, platformmail.NormalizeAddress(folded)).Scan(&accounts)
		if accounts != 1 {
			t.Fatalf("%s and %s made %d accounts", typed, folded, accounts)
		}
		var id string
		w.app.DB.QueryRow(context.Background(), `UPDATE users SET verified = true WHERE email = $1 RETURNING id`, platformmail.NormalizeAddress(folded)).Scan(&id)
		w.users[username] = id
		for _, identity := range []string{typed, folded, strings.ToUpper(folded)} {
			if code := w.call("", "POST", "/auth/login", `{"identity":"`+identity+`","password":"`+pw+`"}`).Code; code != http.StatusOK {
				t.Errorf("login as %s = %d", identity, code)
			}
		}
		accountExists := func() int {
			n := 0
			for _, m := range testapp.Mails(w.app) {
				if strings.HasPrefix(m.Subject, "You already have an account") && m.To[0] == platformmail.NormalizeAddress(folded) {
					n++
				}
			}
			return n
		}
		testapp.WaitFor(t, func() bool { return accountExists() == 1 })
		if code := w.call("climber", "POST", "/auth/email-change/request", `{"newEmail":"`+strings.ToUpper(folded)+`"}`).Code; code != http.StatusNoContent {
			t.Errorf("e-mail change to a taken address in other case = %d", code)
		}
		testapp.WaitFor(t, func() bool { return accountExists() == 2 })
		sent := len(testapp.Mails(w.app))
		if code := w.call("adminA", "POST", "/gyms/"+w.gymA+"/members", `{"email":"`+strings.ToUpper(typed)+`","role":"`+w.records["role"]+`"}`).Code; code != http.StatusAccepted {
			t.Fatalf("invite = %d", code)
		}
		var token string
		for _, m := range testapp.Mails(w.app)[sent:] {
			if match := inviteToken.FindStringSubmatch(m.Text); match != nil {
				token = match[1]
			}
		}
		if token == "" {
			t.Fatal("no invite mail")
		}
		if response := w.call(username, "POST", "/invites/"+token+"/accept", `{}`); response.Code >= 300 {
			t.Errorf("accepting the invite of %s as %s = %d %s", strings.ToUpper(typed), typed, response.Code, response.Body)
		}
		domain := folded[strings.Index(folded, "@")+1:]
		w.exec(`UPDATE platform_config SET blocked_emails = $1`, []string{strings.ToUpper(domain)})
		for _, email := range []string{"new@" + domain, "New@" + strings.ToUpper(domain)} {
			if body := w.call("", "POST", "/auth/register", `{"email":"`+email+`","username":"blocked`+username+`","password":"`+pw+`","passwordConfirm":"`+pw+`"}`).Body.String(); !strings.Contains(body, "validation_email_blocked") {
				t.Errorf("register %s on a blocked domain: %s", email, body)
			}
			if body := w.call("adminA", "POST", "/gyms/"+w.gymA+"/members", `{"email":"`+email+`","role":"`+w.records["role"]+`"}`).Body.String(); !strings.Contains(body, "validation_email_blocked") {
				t.Errorf("invite %s on a blocked domain: %s", email, body)
			}
		}
		w.exec(`UPDATE platform_config SET blocked_emails = '{}'`)
	}
}

func TestCaseVariantsOfAnEmailCannotBothBeStored(t *testing.T) {
	w := newWorld(t)
	_, err := w.app.DB.Exec(context.Background(), `UPDATE users SET email = 'CLIMBER@example.com' WHERE id = $1`, w.users["other"])
	if err == nil {
		t.Fatal("two accounts share an address up to case")
	}
}
