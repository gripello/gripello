package moderation

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"gripello/internal/platform/httpx"
)

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

const (
	filesKey   = "_files"
	pendingKey = "_pending"
)

// kind is one moderated content type; fields == nil means the whole row is snapshotted, deleted on hide and recreated on restore.
type kind struct {
	table   string
	author  string
	gym     string
	fields  []string
	files   []string
	hide    string
	restore string
	exposed string
}

var kinds = map[string]kind{
	"rating":     {table: "ratings", author: "user", gym: "t.gym"},
	"beta_video": {table: "beta_videos", author: "user", gym: "t.gym", files: []string{"file"}},
	"route": {
		table: "routes", gym: "t.gym", fields: []string{"name", "comment", "archived"},
		hide:    "archived = true, archived_at = COALESCE(t.archived_at, now())",
		restore: "archived_at = CASE WHEN s.archived THEN t.archived_at END",
		exposed: "NOT t.archived",
	},
	"profile": {
		table: "users", author: "id", gym: "NULL", fields: []string{"username", "firstname", "name", "avatar", "banner"},
		files: []string{"avatar", "banner"},
		hide:  "username = 'climber_' || t.id, firstname = '', name = '', avatar = '', banner = ''",
	},
	"competition_entry": {
		table: "competition_entries", author: "user", gym: "(SELECT gym FROM competitions WHERE id = t.competition)",
		fields: []string{"display_name", "hidden"}, hide: "hidden = true", exposed: "NOT t.hidden",
	},
	"task": {
		table: "tasks", author: "reporter", gym: "t.gym", fields: []string{"description", "photo"},
		files: []string{"photo"}, hide: "description = '', photo = ''", exposed: "(t.description <> '' OR t.photo <> '')",
	},
}

type content struct {
	Gym      string
	Author   string
	Snapshot map[string]any
}

// loadContent snapshots the moderated fields; the author stays in moderation_items.author only, so snapshots don't reveal it.
func loadContent(ctx context.Context, q querier, kindName, id string) (content, error) {
	k := kinds[kindName]
	snapshot := "to_jsonb(t) - '" + k.author + "'"
	if k.fields != nil {
		parts := make([]string, len(k.fields))
		for i, f := range k.fields {
			parts[i] = "'" + f + `', t."` + f + `"`
		}
		snapshot = "jsonb_build_object(" + strings.Join(parts, ", ") + ")"
	}
	author := "''"
	if k.author != "" {
		author = `COALESCE(t."` + k.author + `", '')`
	}
	var c content
	err := q.QueryRow(ctx, `SELECT COALESCE(`+k.gym+`, ''), `+author+`, `+snapshot+` FROM `+k.table+` t WHERE t.id = $1`, id).
		Scan(&c.Gym, &c.Author, &c.Snapshot)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, httpx.ErrNotFound
	}
	return c, err
}

type Item struct {
	ID           string         `db:"id" json:"id"`
	Created      time.Time      `db:"created" json:"created"`
	Updated      time.Time      `db:"updated" json:"updated"`
	Gym          string         `db:"gym" json:"gym"`
	ContentType  string         `db:"content_type" json:"content_type"`
	ContentID    string         `db:"content_id" json:"content_id"`
	Author       string         `db:"author" json:"author"`
	Snapshot     map[string]any `db:"snapshot" json:"snapshot"`
	Files        []string       `db:"files" json:"files"`
	State        string         `db:"state" json:"state"`
	HiddenBy     string         `db:"hidden_by" json:"hidden_by"`
	ReportsCount int            `db:"reports_count" json:"reports_count"`
	Reason       string         `db:"reason" json:"reason"`
	ReviewedBy   string         `db:"reviewed_by" json:"reviewed_by"`
	ReviewedAt   *time.Time     `db:"reviewed_at" json:"reviewed_at"`
	Context      *Context       `db:"-" json:"context,omitempty"`
}

func (it Item) quarantined() bool { return it.State == "hidden" || it.State == "pending" }

const itemColumns = `id, created, updated, COALESCE(gym, '') AS gym, content_type, content_id, COALESCE(author, '') AS author,
	snapshot, files, state, hidden_by, reports_count, reason, COALESCE(reviewed_by, '') AS reviewed_by, reviewed_at`

func queryItems(ctx context.Context, q querier, where string, args ...any) ([]Item, error) {
	return scanItems(ctx, q, `SELECT `+itemColumns+` FROM moderation_items `+where, args...)
}

func scanItems(ctx context.Context, q querier, sql string, args ...any) ([]Item, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Item])
}

func oneItem(items []Item, err error) (Item, error) {
	if err != nil {
		return Item{}, err
	}
	if len(items) == 0 {
		return Item{}, httpx.ErrNotFound
	}
	return items[0], nil
}

func findItem(ctx context.Context, q querier, id string) (Item, error) {
	return oneItem(queryItems(ctx, q, `WHERE id = $1`, id))
}

func lockItem(ctx context.Context, tx pgx.Tx, id string) (Item, error) {
	return oneItem(queryItems(ctx, tx, `WHERE id = $1 FOR UPDATE`, id))
}

// itemOf returns the case of a piece of content, or ErrNotFound.
func itemOf(ctx context.Context, q querier, kindName, contentID string) (Item, error) {
	return oneItem(queryItems(ctx, q, `WHERE content_type = $1 AND content_id = $2 FOR UPDATE`, kindName, contentID))
}

func insertItem(ctx context.Context, q querier, it Item) (Item, bool, error) {
	if it.Files == nil {
		it.Files = []string{}
	}
	saved, err := scanItems(ctx, q, `INSERT INTO moderation_items (id, gym, content_type, content_id, author, snapshot, files, state)
		VALUES ($1, NULLIF($2, ''), $3, $4, NULLIF($5, ''), $6, $7, $8)
		ON CONFLICT (content_type, content_id) DO NOTHING RETURNING `+itemColumns,
		it.ID, it.Gym, it.ContentType, it.ContentID, it.Author, it.Snapshot, it.Files, it.State)
	if err != nil || len(saved) == 0 {
		return it, false, err
	}
	return saved[0], true, nil
}

func updateItem(ctx context.Context, q querier, it Item) (Item, error) {
	if it.Files == nil {
		it.Files = []string{}
	}
	return oneItem(scanItems(ctx, q, `UPDATE moderation_items SET gym = NULLIF($2, ''), author = NULLIF($3, ''), snapshot = $4,
		files = $5, state = $6, hidden_by = $7, reports_count = $8, reason = $9, reviewed_by = NULLIF($10, ''), reviewed_at = $11,
		updated = now() WHERE id = $1 RETURNING `+itemColumns,
		it.ID, it.Gym, it.Author, it.Snapshot, it.Files, it.State, it.HiddenBy, it.ReportsCount, it.Reason, it.ReviewedBy, it.ReviewedAt))
}

type Report struct {
	ID              string     `db:"id" json:"id"`
	Created         time.Time  `db:"created" json:"created"`
	Updated         time.Time  `db:"updated" json:"updated"`
	Gym             string     `db:"gym" json:"gym"`
	ContentType     string     `db:"content_type" json:"content_type"`
	ContentID       string     `db:"content_id" json:"content_id"`
	ContentURL      string     `db:"content_url" json:"content_url"`
	ContentSnapshot string     `db:"content_snapshot" json:"content_snapshot"`
	Reason          string     `db:"reason" json:"reason"`
	Explanation     string     `db:"explanation" json:"explanation"`
	NotifierName    string     `db:"notifier_name" json:"notifier_name"`
	NotifierEmail   string     `db:"notifier_email" json:"notifier_email"`
	GoodFaith       bool       `db:"good_faith" json:"good_faith"`
	Status          string     `db:"status" json:"status"`
	Decision        string     `db:"decision" json:"decision"`
	DecisionReason  string     `db:"decision_reason" json:"decision_reason"`
	DecidedAt       *time.Time `db:"decided_at" json:"decided_at"`
	DecidedBy       string     `db:"decided_by" json:"decided_by"`
	ReceiptSent     bool       `db:"receipt_sent" json:"receipt_sent"`
	NotifiedAt      *time.Time `db:"notified_at" json:"notified_at"`
	Language        string     `db:"language" json:"language"`
}

const reportColumns = `id, created, updated, COALESCE(gym, '') AS gym, content_type, content_id, content_url, content_snapshot, reason,
	explanation, notifier_name, notifier_email, good_faith, status, decision, decision_reason, decided_at,
	COALESCE(decided_by, '') AS decided_by, receipt_sent, notified_at, language`

func queryReports(ctx context.Context, q querier, sql string, args ...any) ([]Report, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Report])
}

func usersWith(ctx context.Context, q querier, gym, permission string) ([]string, error) {
	if gym == "" {
		return nil, nil
	}
	rows, err := q.Query(ctx, `SELECT DISTINCT m."user" FROM memberships m JOIN roles r ON r.id = m.role
		WHERE m.gym = $1 AND $2 = ANY (r.permissions) ORDER BY 1`, gym, permission)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func platformAdmins(ctx context.Context, q querier) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT id FROM users WHERE platform_admin ORDER BY id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func resolveGym(ctx context.Context, q querier, idOrSlug string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id FROM gyms WHERE id = $1 OR slug = $1 LIMIT 1`, idOrSlug).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", httpx.ErrNotFound
	}
	return id, err
}

func gymPath(ctx context.Context, q querier, gym, path string) string {
	var slug string
	q.QueryRow(ctx, `SELECT slug FROM gyms WHERE id = $1`, gym).Scan(&slug)
	if slug == "" {
		return path
	}
	return "/" + slug + path
}

func contactEmail(ctx context.Context, q querier, gym string) string {
	var email string
	q.QueryRow(ctx, `SELECT COALESCE(NULLIF((SELECT contact_email FROM gyms WHERE id = $1), ''),
		(SELECT contact_email FROM settings ORDER BY id LIMIT 1), '')`, gym).Scan(&email)
	return email
}

func badRequest(message string) *httpx.Error { return httpx.NewError(http.StatusBadRequest, message) }

func truncate(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}
