package logbuf

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	quoted = regexp.MustCompile(`"[^"]*"|'[^']*'`)
	token  = regexp.MustCompile(`[A-Za-z0-9_-]+`)
)

// Fingerprint groups WARN+ records into issues: same message, route, kind, topic and masked error, panic and SQL (ids, numbers and quoted values masked).
func Fingerprint(level slog.Level, message string, attrs map[string]any) string {
	if level < slog.LevelWarn {
		return ""
	}
	key := message
	for _, name := range []string{"route", "kind", "topic"} {
		key += "|" + fmt.Sprint(attrs[name])
	}
	for _, name := range []string{"error", "panic", "sql"} {
		key += "|" + mask(fmt.Sprint(attrs[name]))
	}
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:8])
}

func mask(text string) string {
	text = quoted.ReplaceAllString(text, "?")
	return token.ReplaceAllStringFunc(text, func(t string) string {
		if strings.IndexFunc(t, unicode.IsDigit) >= 0 {
			return "#"
		}
		return t
	})
}

type Issue struct {
	Fingerprint string         `json:"fingerprint"`
	Level       string         `json:"level"`
	Message     string         `json:"message"`
	Sample      map[string]any `json:"sample"`
	Count       int            `json:"count"`
	Users       int            `json:"users"`
	FirstSeen   time.Time      `json:"first_seen"`
	LastSeen    time.Time      `json:"last_seen"`
}

// GroupedIssues aggregates the issues seen within $1; grouping per actor first hashes where count(DISTINCT) would sort.
const GroupedIssues = `SELECT g.fingerprint, latest.level, latest.message, latest.attrs, g.count, g.users, g.client,
		(SELECT min(time) FROM server_logs o WHERE o.fingerprint = g.fingerprint) AS first_seen, g.last_seen
	FROM (SELECT fingerprint, sum(weight)::int AS count, count(actor) AS users, bool_or(client) AS client, max(last_seen) AS last_seen
		FROM (SELECT fingerprint, actor, sum(weight) AS weight, bool_or(client) AS client, max(time) AS last_seen
			FROM server_logs WHERE fingerprint IS NOT NULL AND time > now() - $1::interval GROUP BY fingerprint, actor) per_actor
		GROUP BY fingerprint) g
	CROSS JOIN LATERAL (SELECT level, message, attrs FROM server_logs l WHERE l.fingerprint = g.fingerprint ORDER BY time DESC LIMIT 1) latest`

// Issues lists the groups seen within since, errors first, then newest; first_seen looks back over everything still retained.
func Issues(ctx context.Context, pool *pgxpool.Pool, since time.Duration, limit int) ([]Issue, error) {
	rows, err := pool.Query(ctx, `SELECT fingerprint, level, message, attrs, count, users, first_seen, last_seen FROM (`+GroupedIssues+`) issues
		ORDER BY level = 'ERROR' DESC, last_seen DESC LIMIT $2`, since.String(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Issue{}
	for rows.Next() {
		var i Issue
		var attrs []byte
		if err := rows.Scan(&i.Fingerprint, &i.Level, &i.Message, &attrs, &i.Count, &i.Users, &i.FirstSeen, &i.LastSeen); err != nil {
			return nil, err
		}
		json.Unmarshal(attrs, &i.Sample)
		out = append(out, i)
	}
	return out, rows.Err()
}

// Occurrences returns the newest records of one issue, for its detail view.
func Occurrences(ctx context.Context, pool *pgxpool.Pool, fingerprint string, limit int) ([]Entry, error) {
	rows, err := pool.Query(ctx, `SELECT time, replica, level, message, attrs FROM server_logs WHERE fingerprint = $1 ORDER BY time DESC LIMIT $2`, fingerprint, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Entry{}
	for rows.Next() {
		var e Entry
		var attrs []byte
		if err := rows.Scan(&e.Time, &e.Replica, &e.Level, &e.Message, &attrs); err != nil {
			return nil, err
		}
		json.Unmarshal(attrs, &e.Attrs)
		out = append(out, e)
	}
	return out, rows.Err()
}
