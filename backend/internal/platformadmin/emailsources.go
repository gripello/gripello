package platformadmin

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/db"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
)

type emailSource struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Homepage   string `json:"homepage"`
	License    string `json:"license"`
	url        string
	licenseURL string
}

// Fixed URLs only: an admin-entered URL would let the server fetch anything.
var emailSources = []emailSource{
	{
		ID: "disposable-email-domains", Name: "disposable-email-domains", License: "CC0-1.0",
		Homepage: "https://github.com/disposable-email-domains/disposable-email-domains",
		url:      "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf",
	},
	{
		ID: "mailchecker", Name: "FGRibreau/mailchecker", License: "MIT",
		Homepage:   "https://github.com/FGRibreau/mailchecker",
		url:        "https://raw.githubusercontent.com/FGRibreau/mailchecker/master/list.txt",
		licenseURL: "https://raw.githubusercontent.com/FGRibreau/mailchecker/master/LICENSE",
	},
}

const (
	emailSourceMaxBytes = 32 << 20
	emailNoticeMaxBytes = 64 << 10
	emailDomainsPage    = 100
	// A download with fewer lines is treated as broken rather than wiping the stored list.
	emailSourceMinDomains = 100
)

var (
	sourceDomainPattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`)
	// Two downloads (list and license) stay inside nginx's 60 s for a manual sync.
	emailSourceClient = &http.Client{Timeout: 25 * time.Second}
)

type emailSourceState struct {
	emailSource
	Enabled     bool       `json:"enabled"`
	SyncedAt    *time.Time `json:"synced_at"`
	AttemptedAt *time.Time `json:"attempted_at"`
	DomainCount int        `json:"domain_count"`
	LastError   string     `json:"last_error"`
	Notice      string     `json:"notice"`
}

func findEmailSource(id string) (emailSource, bool) {
	i := slices.IndexFunc(emailSources, func(s emailSource) bool { return s.ID == id })
	if i < 0 {
		return emailSource{}, false
	}
	return emailSources[i], true
}

func (m *module) emailSourceStates(ctx context.Context) ([]emailSourceState, error) {
	rows, err := m.app.DB.Query(ctx, `SELECT id, enabled, synced_at, attempted_at, domain_count, last_error, notice FROM email_blocklist_sources`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	stored := map[string]emailSourceState{}
	for rows.Next() {
		var s emailSourceState
		var id string
		if err := rows.Scan(&id, &s.Enabled, &s.SyncedAt, &s.AttemptedAt, &s.DomainCount, &s.LastError, &s.Notice); err != nil {
			return nil, err
		}
		stored[id] = s
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	states := []emailSourceState{}
	for _, source := range emailSources {
		state := stored[source.ID]
		state.emailSource = source
		states = append(states, state)
	}
	return states, nil
}

func (m *module) setEmailSource(w http.ResponseWriter, r *http.Request) error {
	source, ok := findEmailSource(r.PathValue("id"))
	if !ok {
		return httpx.NewError(http.StatusNotFound, "Unknown source.")
	}
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	ctx := r.Context()
	p, _ := auth.From(ctx)
	var neverSynced bool
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		var before bool
		if err := tx.QueryRow(ctx, `SELECT enabled, synced_at IS NULL FROM email_blocklist_sources WHERE id = $1 FOR UPDATE`, source.ID).
			Scan(&before, &neverSynced); err != nil {
			return err
		}
		if before == body.Enabled {
			return nil
		}
		if _, err := tx.Exec(ctx, `UPDATE email_blocklist_sources SET enabled = $2 WHERE id = $1`, source.ID, body.Enabled); err != nil {
			return err
		}
		return events.PublishAs(ctx, tx, p.UserID, "platform", "platform_config.updated",
			map[string]any{"id": "platformconfig", "changed": []string{"email_source:" + source.ID}}, events.Audience{})
	})
	if err != nil {
		return err
	}
	if body.Enabled && neverSynced {
		m.syncForRequest(r, source)
	}
	return m.getBlocklists(w, r)
}

func (m *module) syncEmailSourceNow(w http.ResponseWriter, r *http.Request) error {
	source, ok := findEmailSource(r.PathValue("id"))
	if !ok {
		return httpx.NewError(http.StatusNotFound, "Unknown source.")
	}
	m.syncForRequest(r, source)
	return m.getBlocklists(w, r)
}

// syncForRequest keeps running when the admin leaves the page; the outcome lands on the source row either way.
func (m *module) syncForRequest(r *http.Request, source emailSource) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), time.Minute)
	defer cancel()
	m.syncEmailSource(ctx, source)
}

func (m *module) syncEnabledEmailSources(ctx context.Context) error {
	var errs []error
	for _, source := range emailSources {
		var enabled bool
		if err := m.app.DB.QueryRow(ctx, `SELECT enabled FROM email_blocklist_sources WHERE id = $1`, source.ID).Scan(&enabled); err != nil {
			return err
		}
		if enabled {
			errs = append(errs, m.syncEmailSource(ctx, source))
		}
	}
	return errors.Join(errs...)
}

// syncEmailSource replaces the source's domains and license notice; a failed download keeps the old list and stores the error for the settings page.
func (m *module) syncEmailSource(ctx context.Context, source emailSource) error {
	domains, err := fetchSourceDomains(ctx, source.url)
	notice := ""
	if err == nil && source.licenseURL != "" {
		notice, err = fetchSourceNotice(ctx, source.licenseURL)
	}
	if err == nil {
		err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `SELECT 1 FROM email_blocklist_sources WHERE id = $1 FOR UPDATE`, source.ID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `DELETE FROM disposable_domains WHERE source = $1`, source.ID); err != nil {
				return err
			}
			rows := make([][]any, len(domains))
			for i, domain := range domains {
				rows[i] = []any{domain, source.ID}
			}
			if _, err := tx.CopyFrom(ctx, pgx.Identifier{"disposable_domains"}, []string{"domain", "source"}, pgx.CopyFromRows(rows)); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `UPDATE email_blocklist_sources SET synced_at = now(), attempted_at = now(), domain_count = $2, notice = $3, last_error = '' WHERE id = $1`,
				source.ID, len(domains), notice)
			return err
		})
	}
	if err != nil {
		message := truncate(err.Error(), 500)
		if _, updateErr := m.app.DB.Exec(context.WithoutCancel(ctx), `UPDATE email_blocklist_sources SET attempted_at = now(), last_error = $2 WHERE id = $1`,
			source.ID, message); updateErr != nil {
			return errors.Join(err, updateErr)
		}
	}
	return err
}

func download(ctx context.Context, url string) (io.ReadCloser, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	response, err := emailSourceClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("download failed: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, fmt.Errorf("download failed: HTTP %d", response.StatusCode)
	}
	return response.Body, nil
}

func fetchSourceNotice(ctx context.Context, url string) (string, error) {
	body, err := download(ctx, url)
	if err != nil {
		return "", fmt.Errorf("license: %w", err)
	}
	defer body.Close()
	notice, err := io.ReadAll(io.LimitReader(body, emailNoticeMaxBytes))
	if err != nil {
		return "", fmt.Errorf("license: %w", err)
	}
	if strings.TrimSpace(string(notice)) == "" {
		return "", errors.New("license: empty download")
	}
	return string(notice), nil
}

func fetchSourceDomains(ctx context.Context, url string) ([]string, error) {
	body, err := download(ctx, url)
	if err != nil {
		return nil, err
	}
	defer body.Close()
	domains, err := parseSourceDomains(io.LimitReader(body, emailSourceMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(domains) < emailSourceMinDomains {
		return nil, fmt.Errorf("only %d domains in the download, keeping the previous list", len(domains))
	}
	return domains, nil
}

// parseSourceDomains reads one domain per line, skipping comments and anything that isn't a domain.
func parseSourceDomains(r io.Reader) ([]string, error) {
	var domains []string
	scanner := bufio.NewScanner(r)
	read := 0
	for scanner.Scan() {
		read += len(scanner.Bytes()) + 1
		if read > emailSourceMaxBytes {
			return nil, fmt.Errorf("download larger than %d MB", emailSourceMaxBytes>>20)
		}
		line := strings.ToLower(strings.TrimSpace(scanner.Text()))
		if len(line) <= 253 && sourceDomainPattern.MatchString(line) {
			domains = append(domains, line)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	slices.Sort(domains)
	return slices.Compact(domains), nil
}

// listEmailSourceDomains pages through a source's stored domains, optionally filtered by a substring.
func (m *module) listEmailSourceDomains(w http.ResponseWriter, r *http.Request) error {
	source, ok := findEmailSource(r.PathValue("id"))
	if !ok {
		return httpx.NewError(http.StatusNotFound, "Unknown source.")
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	page = min(max(page, 1), 1_000_000)
	patterns := db.WordPatterns(strings.ToLower(r.URL.Query().Get("q")))
	ctx := r.Context()
	var total int
	if err := m.app.DB.QueryRow(ctx, `SELECT count(*) FROM disposable_domains WHERE source = $1 AND domain LIKE ALL($2)`,
		source.ID, patterns).Scan(&total); err != nil {
		return err
	}
	rows, err := m.app.DB.Query(ctx, `SELECT domain FROM disposable_domains WHERE source = $1 AND domain LIKE ALL($2)
		ORDER BY domain LIMIT $3 OFFSET $4`, source.ID, patterns, emailDomainsPage, (page-1)*emailDomainsPage)
	if err != nil {
		return err
	}
	items, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items, "page": page, "limit": emailDomainsPage, "total": total})
	return nil
}
