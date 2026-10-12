package platformadmin

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/logbuf"
	"gripello/internal/platform/metrics"
)

var issueRanges = map[string]time.Duration{"1h": time.Hour, "24h": 24 * time.Hour, "7d": 7 * 24 * time.Hour}

func (m *module) listIssues(w http.ResponseWriter, r *http.Request) error {
	since, ok := issueRanges[r.URL.Query().Get("range")]
	if !ok {
		since = issueRanges["24h"]
	}
	items, err := logbuf.Issues(r.Context(), m.app.DB, since, 200)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	return nil
}

func (m *module) issueOccurrences(w http.ResponseWriter, r *http.Request) error {
	items, err := logbuf.Occurrences(r.Context(), m.app.DB, r.PathValue("fingerprint"), 100)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	return nil
}

const (
	alertWindow   = 5 * time.Minute
	alertCooldown = 6 * time.Hour
	// A known issue alerts again once it recurs this often within alertWindow.
	alertBurst = 10
	// Browser reports are unauthenticated input: they alert only as a burst across this many signed-in climbers, never as "new".
	clientAlertUsers = 3
	alertsPerRun     = 5
	escalation       = 10
)

// alertIssues tells platform admins about errors that are new or keep happening, before a climber reports them.
func (m *module) alertIssues(ctx context.Context) error {
	// Within the cooldown an issue alerts again only once its rate has grown escalation-fold since the last alert.
	rows, err := m.app.DB.Query(ctx, `SELECT i.fingerprint, i.level, i.message, i.attrs, i.count, i.first_seen, a.alerted_at > now() - $3::interval
		FROM (`+logbuf.GroupedIssues+`) i LEFT JOIN issue_alerts a ON a.fingerprint = i.fingerprint
		WHERE CASE WHEN i.client THEN i.count >= $2 AND i.users >= $4
			ELSE (i.level = 'ERROR' AND i.first_seen > now() - $1::interval * 2) OR i.count >= $2 END
		  AND (a.fingerprint IS NULL OR a.alerted_at <= now() - $3::interval OR (i.count >= $2 AND i.count >= a.alerted_count * $6))
		ORDER BY i.level = 'ERROR' DESC, i.count DESC LIMIT $5`,
		alertWindow.String(), alertBurst, alertCooldown.String(), clientAlertUsers, alertsPerRun, escalation)
	if err != nil {
		return err
	}
	type due struct {
		fingerprint, level, message string
		attrs                       map[string]any
		count                       int
		firstSeen                   time.Time
		escalated                   *bool
	}
	issues, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (due, error) {
		var d due
		err := row.Scan(&d.fingerprint, &d.level, &d.message, &d.attrs, &d.count, &d.firstSeen, &d.escalated)
		return d, err
	})
	if err != nil || len(issues) == 0 {
		return err
	}
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT id FROM users WHERE platform_admin ORDER BY id`)
		if err != nil {
			return err
		}
		admins, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil || len(admins) == 0 {
			return err
		}
		for _, issue := range issues {
			if _, err := tx.Exec(ctx, `INSERT INTO issue_alerts (fingerprint, alerted_at, alerted_count) VALUES ($1, now(), $2)
				ON CONFLICT (fingerprint) DO UPDATE SET alerted_at = now(), alerted_count = $2`, issue.fingerprint, issue.count); err != nil {
				return err
			}
			summary := issue.message
			if route, _ := issue.attrs["route"].(string); route != "" {
				summary += " · " + route
			}
			if detail, _ := issue.attrs["error"].(string); detail != "" {
				summary += " · " + truncate(detail, 120)
			}
			err := events.Publish(ctx, tx, "notify", "notify", map[string]any{
				"type": "platform_issue", "users": admins,
				"params": map[string]any{"level": issue.level, "summary": summary, "count": issue.count, "new": time.Since(issue.firstSeen) < 2*alertWindow,
					"escalated": issue.escalated != nil && *issue.escalated},
				"url": "/platform/logs?issue=" + issue.fingerprint,
			}, events.Audience{})
			if err != nil {
				return err
			}
		}
		return nil
	})
}

// PruneIssueAlerts drops alerts past their cooldown, which no longer hold anything back.
func PruneIssueAlerts(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `DELETE FROM issue_alerts WHERE alerted_at < now() - $1::interval`, alertCooldown.String())
	return err
}

func truncate(text string, max int) string {
	if utf8.RuneCountInString(text) <= max {
		return text
	}
	return string([]rune(text)[:max]) + "…"
}

// clientError is what the browser reports: no URL query, no form values, only where and what failed.
type clientError struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
	Stack   string `json:"stack"`
	Route   string `json:"route"`
	Version string `json:"version"`
}

var clientErrorKinds = map[string]bool{"vue": true, "window": true, "promise": true, "chunk": true, "nuxt": true}

func (m *module) reportClientError(w http.ResponseWriter, r *http.Request) error {
	if !m.clientIPs.Allow(metrics.ClientIP(r), time.Now()) || !m.clientErrors.Allow("all", time.Now()) {
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
	var body clientError
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if !clientErrorKinds[body.Kind] || body.Message == "" {
		return httpx.NewError(http.StatusBadRequest, "Unknown error report.")
	}
	route, _, _ := strings.Cut(body.Route, "?")
	user := ""
	if p, ok := auth.From(r.Context()); ok {
		user = p.UserID
	}
	slog.Error("client error", "source", "client", "kind", body.Kind, "route", truncate(route, 200), "error", truncate(body.Message, 500),
		"stack", truncate(body.Stack, 2000), "version", truncate(body.Version, 40), "user", user, "req", httpx.RequestID(r.Context()))
	w.WriteHeader(http.StatusNoContent)
	return nil
}
