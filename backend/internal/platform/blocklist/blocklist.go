package blocklist

import (
	"context"
	"errors"
	"path"
	"regexp"
	"strings"
	"unicode"

	"github.com/jackc/pgx/v5"
	"golang.org/x/text/unicode/norm"

	"gripello/internal/platform/db"
	"gripello/internal/platform/mail"
)

const (
	CodeEmailBlocked  = "validation_email_blocked"
	CodeNameProtected = "validation_name_protected"
)

var lookalikes = strings.NewReplacer("0", "o", "1", "i", "3", "e", "4", "a", "5", "s", "7", "t", "@", "a", "$", "s", "!", "i", "|", "l")

// Normalize folds case, accents and digit lookalikes and drops everything but letters, so "Gr1pe_llo" reads "gripello".
func Normalize(s string) string {
	s = lookalikes.Replace(strings.ToLower(norm.NFD.String(s)))
	var b strings.Builder
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

var emailPatternChars = regexp.MustCompile(`^[\p{L}\p{M}\p{N}.*@+_-]+$`)

// foldEmail matches addresses and entries in one form: lowercase NFC with the domain in punycode.
func foldEmail(s string) string {
	s = strings.ToLower(norm.NFC.String(strings.TrimSpace(s)))
	at := strings.LastIndexByte(s, '@')
	return s[:at+1] + mail.ASCIIDomain(s[at+1:])
}

// NormalizeEmailPattern lowercases a blocklist entry; ok is false for an entry that can never match a valid address.
func NormalizeEmailPattern(pattern string) (string, bool) {
	pattern = foldEmail(pattern)
	if pattern == "" || len(pattern) > 254 || !emailPatternChars.MatchString(pattern) || strings.Count(pattern, "@") > 1 ||
		strings.Trim(pattern, "*@.") == "" {
		return pattern, false
	}
	_, err := path.Match(pattern, "")
	return pattern, err == nil
}

// MatchEmail treats an entry without "@" as a domain: "spam.test" blocks "*@spam.test", "*.spam.test" its subdomains.
func MatchEmail(patterns []string, email string) bool {
	return EmailMatch(patterns, email) != ""
}

// EmailMatch returns the first entry matching the address, or "".
func EmailMatch(patterns []string, email string) string {
	email = foldEmail(email)
	for _, entry := range patterns {
		pattern := foldEmail(entry)
		if !strings.Contains(pattern, "@") {
			pattern = "*@" + pattern
		}
		if ok, _ := path.Match(pattern, email); ok {
			return entry
		}
	}
	return ""
}

// MatchName blocks a name containing a protected term, or equal to a gym name (containing one would block "Maxine" for a gym "Max").
func MatchName(terms, gyms []string, name string) bool {
	return NameMatch(terms, gyms, name) != ""
}

// NameMatch returns the protected term or gym name the name runs into, or "".
func NameMatch(terms, gyms []string, name string) string {
	normalized := Normalize(name)
	if normalized == "" {
		return ""
	}
	for _, term := range terms {
		if normalizedTerm := Normalize(term); normalizedTerm != "" && strings.Contains(normalized, normalizedTerm) {
			return term
		}
	}
	for _, gym := range gyms {
		if Normalize(gym) == normalized {
			return gym
		}
	}
	return ""
}

// EmailBlocked checks the manual list and the domains synced from enabled sources; the allowlist overrides both.
func EmailBlocked(ctx context.Context, q db.Querier, email string) (bool, error) {
	var blocked, allowed []string
	var disposable bool
	if err := q.QueryRow(ctx, `SELECT c.blocked_emails, c.allowed_emails, EXISTS (SELECT 1 FROM disposable_domains d
		JOIN email_blocklist_sources s ON s.id = d.source WHERE s.enabled AND d.domain = ANY($1)) FROM platform_config c`,
		DomainAndParents(email)).Scan(&blocked, &allowed, &disposable); err != nil {
		return false, err
	}
	return (disposable || MatchEmail(blocked, email)) && !MatchEmail(allowed, email), nil
}

// DisposableSource returns the enabled source listing the address's domain or a parent domain, or "".
func DisposableSource(ctx context.Context, q db.Querier, email string) (string, error) {
	var source string
	err := q.QueryRow(ctx, `SELECT s.id FROM disposable_domains d JOIN email_blocklist_sources s ON s.id = d.source
		WHERE s.enabled AND d.domain = ANY($1) ORDER BY s.id LIMIT 1`, DomainAndParents(email)).Scan(&source)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return source, err
}

// DomainAndParents lists "a.b.example.com", "b.example.com", "example.com" for an address at a.b.example.com.
func DomainAndParents(email string) []string {
	_, domain, _ := strings.Cut(foldEmail(email), "@")
	domains := []string{}
	for strings.Contains(domain, ".") {
		domains = append(domains, domain)
		_, domain, _ = strings.Cut(domain, ".")
	}
	return domains
}

// NameProtected checks a whole name (first and last name together, so "North" + "Walls" meets a gym "North Walls").
// ponytail: reads the lists and every gym per call; cache them per replica if name edits ever get hot.
func NameProtected(ctx context.Context, q db.Querier, name string) (bool, error) {
	var terms, gyms []string
	if err := q.QueryRow(ctx, `SELECT protected_names, ARRAY(SELECT name FROM gyms) FROM platform_config`).
		Scan(&terms, &gyms); err != nil {
		return false, err
	}
	return MatchName(terms, gyms, name), nil
}
