package audit

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/apitime"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/db"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/tenancy"
)

const (
	defaultPageSize = 50
	maxPageSize     = 200
)

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

func (m *module) listGym(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	gym, err := tenancy.ResolveGym(r.Context(), m.db, r.PathValue("gym"))
	if err != nil {
		return err
	}
	q := &db.Where{}
	q.Add("a.gym = ?", gym)
	if !p.PlatformAdmin && !m.perms.Has(r.Context(), gym, tenancy.PermViewAuditLog) {
		q.Add("a.actor = ?", p.UserID)
	}
	return m.list(w, r, p, q)
}

func (m *module) listOwn(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	q := &db.Where{}
	q.Add("a.actor = ?", p.UserID)
	return m.list(w, r, p, q)
}

func (m *module) listPlatform(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.RequirePlatformAdmin(r.Context())
	if err != nil {
		return err
	}
	q := &db.Where{}
	if gym := r.URL.Query().Get("gym"); gym != "" {
		q.Add("(a.gym = ? OR g.slug = ?)", gym)
	}
	return m.list(w, r, p, q)
}

func (m *module) list(w http.ResponseWriter, r *http.Request, p auth.Principal, q *db.Where) error {
	params := r.URL.Query()
	if action := params.Get("action"); action != "" {
		if recordActions[action] != action && !slices.Contains(authActions, action) {
			return httpx.BadRequest("Unknown action.").Field("action", "validation_invalid_value", "Invalid value "+action+".")
		}
		q.Add("a.action = ?", action)
	}
	if collection := params.Get("collection"); collection != "" {
		q.Add("a.collection_name = ?", collection)
	}
	if record := params.Get("record"); record != "" {
		q.Add("a.record_id = ?", record)
	}
	switch actor := params.Get("actor"); actor {
	case "":
	case "me":
		q.Add("a.actor = ?", p.UserID)
	case "guest", "guests":
		q.Add("a.actor IS NULL AND a.actor_label <> ?", platformLabel)
	case "platform":
		q.Add("a.actor_label = ?", platformLabel)
	default:
		q.Add("a.actor = ?", actor)
	}
	for param, op := range map[string]string{"from": ">=", "to": "<="} {
		if value := params.Get(param); value != "" {
			at, err := apitime.ParseTimeOrDay(value)
			if err != nil {
				return httpx.BadRequest("Invalid date.").Field(param, "validation_invalid_date", "Must be a valid date.")
			}
			q.Add("a.created "+op+" ?", at)
		}
	}
	if term := strings.TrimSpace(params.Get("q")); term != "" {
		q.Add("NOT EXISTS (SELECT 1 FROM unnest(?::text[]) w WHERE NOT (a.actor_label ILIKE w OR a.record_id ILIKE w OR a.collection_name ILIKE w))", db.WordPatterns(term))
	}
	page := httpx.Page(r, defaultPageSize, maxPageSize)
	from := ` FROM audit_logs a LEFT JOIN gyms g ON g.id = a.gym` + q.SQL()
	var total int
	if err := m.db.QueryRow(r.Context(), `SELECT count(*)`+from, q.Args...).Scan(&total); err != nil {
		return err
	}
	items, err := entries(r.Context(), m.db, entryColumns+from+
		` ORDER BY a.created DESC, a.id DESC`+page.SQL(), q.Args)
	return httpx.Respond(w, http.StatusOK, httpx.PageOf[Entry]{Items: items, Page: page.Page, Limit: page.Limit, Total: &total}, err)
}

const entryColumns = `SELECT a.id, a.created, COALESCE(a.actor, ''), a.actor_label, a.action, a.collection_name, a.record_id,
	a.changed_fields, a.ip, COALESCE(a.gym, ''), COALESCE(g.slug, ''), COALESCE(g.name, '')`

func entries(ctx context.Context, q db.Querier, sql string, args []any) ([]Entry, error) {
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
