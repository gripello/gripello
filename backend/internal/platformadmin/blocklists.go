package platformadmin

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/blocklist"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
)

const blocklistMax = 10000

// Public providers: blocking one of them would lock out everyone, so suspensions never suggest them.
var freemailDomains = []string{
	"aol.com", "gmail.com", "googlemail.com", "gmx.at", "gmx.ch", "gmx.de", "gmx.net", "hotmail.com", "icloud.com", "live.com",
	"mail.ru", "me.com", "msn.com", "outlook.com", "outlook.de", "posteo.de", "proton.me", "protonmail.com", "t-online.de",
	"web.de", "yahoo.com", "yahoo.de", "yandex.ru",
}

type blocklists struct {
	BlockedEmails  []string `json:"blocked_emails"`
	AllowedEmails  []string `json:"allowed_emails"`
	ProtectedNames []string `json:"protected_names"`
}

func (m *module) getBlocklists(w http.ResponseWriter, r *http.Request) error {
	var lists struct {
		blocklists
		Sources []emailSourceState `json:"sources"`
	}
	if err := m.app.DB.QueryRow(r.Context(), `SELECT blocked_emails, allowed_emails, protected_names FROM platform_config`).
		Scan(&lists.BlockedEmails, &lists.AllowedEmails, &lists.ProtectedNames); err != nil {
		return err
	}
	sources, err := m.emailSourceStates(r.Context())
	if err != nil {
		return err
	}
	lists.Sources = sources
	return httpx.Respond(w, http.StatusOK, lists, nil)
}

func (m *module) putBlocklists(w http.ResponseWriter, r *http.Request) error {
	var body blocklists
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	invalid := httpx.BadRequest("Failed to validate.")
	emails := cleanEmailPatterns(invalid, "blocked_emails", body.BlockedEmails)
	allowed := cleanEmailPatterns(invalid, "allowed_emails", body.AllowedEmails)
	names := cleanProtectedNames(invalid, body.ProtectedNames)
	if len(invalid.Data) > 0 {
		return invalid
	}
	if err := m.saveBlocklists(r, func(blocklists) blocklists { return blocklists{emails, allowed, names} }); err != nil {
		return err
	}
	return m.getBlocklists(w, r)
}

// addBlockedEmails appends to the stored list, so a suspension doesn't overwrite an edit made meanwhile.
func (m *module) addBlockedEmails(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Patterns []string `json:"patterns"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	invalid := httpx.BadRequest("Failed to validate.")
	added := cleanEmailPatterns(invalid, "patterns", body.Patterns)
	if len(invalid.Data) > 0 {
		return invalid
	}
	err := m.saveBlocklists(r, func(before blocklists) blocklists {
		emails := append(slices.Clone(before.BlockedEmails), added...)
		slices.Sort(emails)
		return blocklists{slices.Compact(emails), before.AllowedEmails, before.ProtectedNames}
	})
	if err != nil {
		return err
	}
	return m.getBlocklists(w, r)
}

func (m *module) saveBlocklists(r *http.Request, change func(blocklists) blocklists) error {
	ctx := r.Context()
	p, _ := auth.From(ctx)
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		var before blocklists
		if err := tx.QueryRow(ctx, `SELECT blocked_emails, allowed_emails, protected_names FROM platform_config FOR UPDATE`).
			Scan(&before.BlockedEmails, &before.AllowedEmails, &before.ProtectedNames); err != nil {
			return err
		}
		after := change(before)
		if len(after.BlockedEmails) > blocklistMax || len(after.AllowedEmails) > blocklistMax {
			return httpx.BadRequest("Failed to validate.").
				Field("blocked_emails", "validation_too_many_values", fmt.Sprintf("Enter no more than %d.", blocklistMax))
		}
		changed := []string{}
		if !slices.Equal(before.BlockedEmails, after.BlockedEmails) {
			changed = append(changed, "blocked_emails")
		}
		if !slices.Equal(before.AllowedEmails, after.AllowedEmails) {
			changed = append(changed, "allowed_emails")
		}
		if !slices.Equal(before.ProtectedNames, after.ProtectedNames) {
			changed = append(changed, "protected_names")
		}
		if len(changed) == 0 {
			return nil
		}
		if _, err := tx.Exec(ctx, `UPDATE platform_config SET blocked_emails = $1, allowed_emails = $2, protected_names = $3, updated = now()`,
			after.BlockedEmails, after.AllowedEmails, after.ProtectedNames); err != nil {
			return err
		}
		return events.PublishAs(ctx, tx, p.UserID, "platform", "platform_config.updated", map[string]any{"id": "platformconfig", "changed": changed}, events.Audience{PlatformAdmins: true})
	})
}

func cleanEmailPatterns(invalid *httpx.Error, field string, patterns []string) []string {
	if len(patterns) > blocklistMax {
		invalid.Field(field, "validation_too_many_values", fmt.Sprintf("Enter no more than %d.", blocklistMax))
		return nil
	}
	cleaned := []string{}
	for i, pattern := range patterns {
		pattern, ok := blocklist.NormalizeEmailPattern(pattern)
		if !ok {
			invalid.Field(fmt.Sprintf("%s.%d", field, i), "validation_invalid_value", "Enter an address, a domain or a pattern like *.example.com.")
			continue
		}
		cleaned = append(cleaned, pattern)
	}
	slices.Sort(cleaned)
	return slices.Compact(cleaned)
}

func cleanProtectedNames(invalid *httpx.Error, names []string) []string {
	if len(names) > blocklistMax {
		invalid.Field("protected_names", "validation_too_many_values", fmt.Sprintf("Enter no more than %d.", blocklistMax))
		return nil
	}
	cleaned := []string{}
	for i, name := range names {
		name = strings.ToLower(strings.TrimSpace(name))
		// Short terms would match inside countless ordinary names.
		if utf8.RuneCountInString(blocklist.Normalize(name)) < 3 || utf8.RuneCountInString(name) > 100 {
			invalid.Field(fmt.Sprintf("protected_names.%d", i), "validation_length_out_of_range", "Enter 3 to 100 letters.")
			continue
		}
		cleaned = append(cleaned, name)
	}
	slices.Sort(cleaned)
	return slices.Compact(cleaned)
}

type blockSuggestions struct {
	Email           string `json:"email"`
	Domain          string `json:"domain"`
	Freemail        bool   `json:"freemail"`
	DomainAccounts  int    `json:"domain_accounts"`
	DomainSuspended int    `json:"domain_suspended"`
	EmailBlocked    bool   `json:"email_blocked"`
	DomainBlocked   bool   `json:"domain_blocked"`
}

// blockSuggestions tells the suspend dialog what blocking this user's address or domain would cover; counts leave the user out.
func (m *module) blockSuggestions(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	id := r.PathValue("id")
	var s blockSuggestions
	var patterns []string
	err := m.app.DB.QueryRow(ctx, `SELECT lower(u.email), c.blocked_emails FROM users u, platform_config c WHERE u.id = $1`, id).Scan(&s.Email, &patterns)
	if err == pgx.ErrNoRows {
		return httpx.NewError(http.StatusNotFound, "User not found.")
	}
	if err != nil {
		return err
	}
	if at := strings.LastIndex(s.Email, "@"); at >= 0 {
		s.Domain = s.Email[at+1:]
	}
	if s.Domain != "" {
		s.Freemail = slices.Contains(freemailDomains, s.Domain)
		s.EmailBlocked = blocklist.MatchEmail(patterns, s.Email)
		s.DomainBlocked = blocklist.MatchEmail(patterns, "*@"+s.Domain)
		if err := m.app.DB.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE suspended_until > now()) FROM users
			WHERE lower(split_part(email, '@', 2)) = $1 AND id <> $2`, s.Domain, id).Scan(&s.DomainAccounts, &s.DomainSuspended); err != nil {
			return err
		}
	}
	return httpx.Respond(w, http.StatusOK, s, nil)
}

type blocklistCheck struct {
	Email string `json:"email"`
	Name  string `json:"name"`
	blocklists
}

// checkBlocklists answers how the given lists (the unsaved form) plus the enabled sources treat an address and a name.
func (m *module) checkBlocklists(w http.ResponseWriter, r *http.Request) error {
	var body blocklistCheck
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	ctx := r.Context()
	type emailResult struct {
		Blocked bool   `json:"blocked"`
		Rule    string `json:"rule"`
		Match   string `json:"match"`
	}
	type nameResult struct {
		Protected bool   `json:"protected"`
		Match     string `json:"match"`
	}
	var result struct {
		Email *emailResult `json:"email"`
		Name  *nameResult  `json:"name"`
	}
	if email := strings.TrimSpace(body.Email); email != "" {
		check := emailResult{}
		if match := blocklist.EmailMatch(lowered(body.AllowedEmails), email); match != "" {
			check.Rule, check.Match = "allowed", match
		} else if match := blocklist.EmailMatch(lowered(body.BlockedEmails), email); match != "" {
			check.Blocked, check.Rule, check.Match = true, "blocked", match
		} else {
			source, err := blocklist.DisposableSource(ctx, m.app.DB, email)
			if err != nil {
				return err
			}
			if source != "" {
				check.Blocked, check.Rule, check.Match = true, "source", source
			}
		}
		result.Email = &check
	}
	if name := strings.TrimSpace(body.Name); name != "" {
		var gyms []string
		if err := m.app.DB.QueryRow(ctx, `SELECT ARRAY(SELECT name FROM gyms)`).Scan(&gyms); err != nil {
			return err
		}
		match := blocklist.NameMatch(body.ProtectedNames, gyms, name)
		result.Name = &nameResult{Protected: match != "", Match: match}
	}
	return httpx.Respond(w, http.StatusOK, result, nil)
}

func lowered(patterns []string) []string {
	out := make([]string, 0, len(patterns))
	for _, pattern := range patterns {
		out = append(out, strings.ToLower(strings.TrimSpace(pattern)))
	}
	return out
}
