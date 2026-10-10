package audit

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/httpx"
)

const (
	defaultPageSize = 50
	maxPageSize     = 200
)

var timeLayouts = []string{time.RFC3339Nano, "2006-01-02 15:04:05.999Z07:00", "2006-01-02 15:04:05.999Z", "2006-01-02"}

type gymRef struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
}

type Entry struct {
	ID             string    `json:"id"`
	Created        time.Time `json:"created"`
	Actor          string    `json:"actor"`
	ActorLabel     string    `json:"actor_label"`
	Action         string    `json:"action"`
	CollectionName string    `json:"collection_name"`
	RecordID       string    `json:"record_id"`
	ChangedFields  []string  `json:"changed_fields"`
	IP             string    `json:"ip"`
	Gym            string    `json:"gym"`
	Expand         *struct {
		Gym gymRef `json:"gym"`
	} `json:"expand,omitempty"`
}

type query struct {
	where []string
	args  []any
}

func (q *query) add(clause string, args ...any) {
	for _, arg := range args {
		q.args = append(q.args, arg)
		clause = strings.Replace(clause, "?", "$"+strconv.Itoa(len(q.args)), 1)
	}
	q.where = append(q.where, clause)
}

func (m *module) listGym(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	var gym string
	err = m.db.QueryRow(r.Context(), `SELECT id FROM gyms WHERE id = $1 OR slug = $1 LIMIT 1`, r.PathValue("gym")).Scan(&gym)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.ErrNotFound
	} else if err != nil {
		return err
	}
	q := &query{}
	q.add("a.gym = ?", gym)
	if !p.PlatformAdmin && !m.perms.Can(r.Context(), p.UserID, gym, "view_audit_log") {
		q.add("a.actor = ?", p.UserID)
	}
	return m.list(w, r, p, q)
}

func (m *module) listOwn(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	q := &query{}
	q.add("a.actor = ?", p.UserID)
	return m.list(w, r, p, q)
}

func (m *module) listPlatform(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	if !p.PlatformAdmin {
		return httpx.ErrForbidden
	}
	q := &query{}
	if gym := r.URL.Query().Get("gym"); gym != "" {
		q.add("(a.gym = ? OR g.slug = ?)", gym, gym)
	}
	return m.list(w, r, p, q)
}

func (m *module) list(w http.ResponseWriter, r *http.Request, p auth.Principal, q *query) error {
	params := r.URL.Query()
	if action := params.Get("action"); action != "" {
		if recordActions[action] != action && !slices.Contains(authActions, action) {
			return httpx.NewError(http.StatusBadRequest, "Unknown action.").Field("action", "validation_invalid_value", "Invalid value "+action+".")
		}
		q.add("a.action = ?", action)
	}
	if collection := params.Get("collection"); collection != "" {
		q.add("a.collection_name = ?", collection)
	}
	switch actor := params.Get("actor"); actor {
	case "":
	case "me":
		q.add("a.actor = ?", p.UserID)
	case "guest", "guests":
		q.add("a.actor IS NULL AND a.actor_label <> ?", platformLabel)
	case "platform":
		q.add("a.actor_label = ?", platformLabel)
	default:
		q.add("a.actor = ?", actor)
	}
	for param, op := range map[string]string{"from": ">=", "to": "<="} {
		if value := params.Get(param); value != "" {
			at, ok := parseTime(value)
			if !ok {
				return httpx.NewError(http.StatusBadRequest, "Invalid date.").Field(param, "validation_invalid_date", "Must be a valid date.")
			}
			q.add("a.created "+op+" ?", at)
		}
	}
	if term := strings.TrimSpace(params.Get("q")); term != "" {
		q.add("(strpos(lower(a.actor_label), lower(?)) > 0 OR strpos(lower(a.record_id), lower(?)) > 0 OR strpos(lower(a.collection_name), lower(?)) > 0)", term, term, term)
	}
	page := max(1, atoi(params.Get("page"), 1))
	limit := min(maxPageSize, max(1, atoi(params.Get("limit"), defaultPageSize)))
	where := "TRUE"
	if len(q.where) > 0 {
		where = strings.Join(q.where, " AND ")
	}
	from := ` FROM audit_logs a LEFT JOIN gyms g ON g.id = a.gym WHERE ` + where
	var total int
	if err := m.db.QueryRow(r.Context(), `SELECT count(*)`+from, q.args...).Scan(&total); err != nil {
		return err
	}
	items, err := entries(r.Context(), m.db, entryColumns+from+
		` ORDER BY a.created DESC, a.id DESC LIMIT `+strconv.Itoa(limit)+` OFFSET `+strconv.Itoa((page-1)*limit), q.args)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items, "page": page, "limit": limit, "total": total})
	return nil
}

const entryColumns = `SELECT a.id, a.created, COALESCE(a.actor, ''), a.actor_label, a.action, a.collection_name, a.record_id,
	a.changed_fields, a.ip, COALESCE(a.gym, ''), COALESCE(g.slug, ''), COALESCE(g.name, '')`

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func entries(ctx context.Context, q querier, sql string, args []any) ([]Entry, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Entry, error) {
		var e Entry
		var g gymRef
		err := row.Scan(&e.ID, &e.Created, &e.Actor, &e.ActorLabel, &e.Action, &e.CollectionName, &e.RecordID,
			&e.ChangedFields, &e.IP, &e.Gym, &g.Slug, &g.Name)
		if e.Gym != "" {
			g.ID = e.Gym
			e.Expand = &struct {
				Gym gymRef `json:"gym"`
			}{g}
		}
		return e, err
	})
	if items == nil {
		items = []Entry{}
	}
	return items, err
}

func parseTime(value string) (time.Time, bool) {
	for _, layout := range timeLayouts {
		if at, err := time.Parse(layout, value); err == nil {
			return at, true
		}
	}
	return time.Time{}, false
}

func atoi(value string, fallback int) int {
	if n, err := strconv.Atoi(value); err == nil {
		return n
	}
	return fallback
}
