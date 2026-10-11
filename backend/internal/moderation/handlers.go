package moderation

import (
	"context"
	"errors"
	"net/http"
	"net/mail"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/captcha"
	"gripello/internal/platform/climbers"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
)

const (
	defaultPageSize = 30
	maxPageSize     = 200
)

var (
	reportTypes   = []string{"rating", "route", "beta_video", "profile"}
	reportReasons = []string{"hate_speech", "harassment", "violence_threat", "sexual_content", "personal_data", "ip_infringement", "spam_fraud", "other"}
	languages     = []string{"", "en", "de", "nl", "fr", "es"}
	states        = []string{"unreviewed", "approved", "pending", "hidden"}
)

func invalid(field, message string) *httpx.Error {
	return badRequest(message).Field(field, "validation_invalid_value", message)
}

func page(r *http.Request) (int, int, string) {
	atoi := func(value string, fallback int) int {
		if n, err := strconv.Atoi(value); err == nil {
			return n
		}
		return fallback
	}
	p := min(1_000_000, max(1, atoi(r.URL.Query().Get("page"), 1)))
	limit := min(maxPageSize, max(1, atoi(r.URL.Query().Get("limit"), defaultPageSize)))
	return p, limit, " LIMIT " + strconv.Itoa(limit) + " OFFSET " + strconv.Itoa((p-1)*limit)
}

func (m *module) can(ctx context.Context, p auth.Principal, gym string, permissions ...string) bool {
	if gym == "" {
		return false
	}
	for _, perm := range permissions {
		if m.perms.Can(ctx, p.UserID, gym, perm) {
			return true
		}
	}
	return false
}

type reportInput struct {
	ContentType   string `json:"content_type"`
	ContentID     string `json:"content_id"`
	Reason        string `json:"reason"`
	Explanation   string `json:"explanation"`
	NotifierName  string `json:"notifier_name"`
	NotifierEmail string `json:"notifier_email"`
	GoodFaith     bool   `json:"good_faith"`
	Language      string `json:"language"`
}

func (in *reportInput) validate() error {
	in.Explanation, in.NotifierName, in.NotifierEmail = strings.TrimSpace(in.Explanation), strings.TrimSpace(in.NotifierName), strings.TrimSpace(in.NotifierEmail)
	switch {
	case !slices.Contains(reportTypes, in.ContentType):
		return invalid("content_type", "This content cannot be reported.")
	case !slices.Contains(reportReasons, in.Reason):
		return invalid("reason", "Pick a reason.")
	case in.Explanation == "" || len([]rune(in.Explanation)) > 2000:
		return invalid("explanation", "Explain the report in at most 2000 characters.")
	case in.NotifierName == "" || len([]rune(in.NotifierName)) > 100:
		return invalid("notifier_name", "Enter your name.")
	case !validEmail(in.NotifierEmail):
		return invalid("notifier_email", "Enter a valid email address.")
	case !in.GoodFaith:
		return invalid("good_faith", "Confirm that the report is made in good faith.")
	case !slices.Contains(languages, in.Language):
		in.Language = ""
	}
	return nil
}

func validEmail(address string) bool {
	parsed, err := mail.ParseAddress(address)
	return err == nil && parsed.Address == address
}

// reported returns the gym, a text snapshot and the link of reported content.
func reported(ctx context.Context, q querier, contentType, id string) (gym, snapshot, link string, err error) {
	escaped := url.QueryEscape(id)
	switch contentType {
	case "profile":
		err = q.QueryRow(ctx, `SELECT concat_ws(' - ', NULLIF(username, ''), NULLIF(firstname, ''), NULLIF(name, '')) FROM users WHERE id = $1`, id).Scan(&snapshot)
		link = "/climber?id=" + escaped
	case "beta_video":
		var route string
		err = q.QueryRow(ctx, `SELECT gym, url || file, route FROM beta_videos WHERE id = $1`, id).Scan(&gym, &snapshot, &route)
		link = "/route?id=" + url.QueryEscape(route) + "#beta-" + escaped
	case "route":
		err = q.QueryRow(ctx, `SELECT gym, concat_ws(' - ', NULLIF(name, ''), NULLIF(comment, '')) FROM routes WHERE id = $1`, id).Scan(&gym, &snapshot)
		link = "/route?id=" + escaped
	default:
		var route string
		err = q.QueryRow(ctx, `SELECT gym, comment, route_id FROM ratings WHERE id = $1`, id).Scan(&gym, &snapshot, &route)
		link = "/route?id=" + url.QueryEscape(route) + "#comment-" + escaped
	}
	if err == pgx.ErrNoRows {
		err = badRequest("The reported content does not exist.")
	}
	return gym, truncate(snapshot, 5000), link, err
}

func (m *module) createReport(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	var in reportInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	if err := in.validate(); err != nil {
		return err
	}
	if err := captcha.Request(ctx, m.app.DB, r, "report"); err != nil {
		return err
	}
	report := Report{
		ID: ids.New(), ContentType: in.ContentType, ContentID: in.ContentID, Reason: in.Reason, Explanation: in.Explanation,
		NotifierName: in.NotifierName, NotifierEmail: in.NotifierEmail, GoodFaith: true, Status: "open", Language: in.Language,
	}
	var err error
	if report.Gym, report.ContentSnapshot, report.ContentURL, err = reported(ctx, m.app.DB, in.ContentType, in.ContentID); err != nil {
		return err
	}
	err = m.inTx(ctx, func(w *work) error {
		if _, err := w.tx.Exec(ctx, `INSERT INTO reports (id, gym, content_type, content_id, content_url, content_snapshot, reason, explanation,
			notifier_name, notifier_email, good_faith, status, language) VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, $7, $8, $9, $10, true, 'open', $11)`,
			report.ID, report.Gym, report.ContentType, report.ContentID, report.ContentURL, report.ContentSnapshot, report.Reason,
			report.Explanation, report.NotifierName, report.NotifierEmail, report.Language); err != nil {
			return err
		}
		snippet := map[string]any{"snippet": truncate(report.ContentSnapshot, 140)}
		staff, err := usersWith(ctx, w.tx, report.Gym, permReports)
		if err != nil {
			return err
		}
		if err := publishNotify(ctx, w.tx, Notify{
			Type: "report_filed", Users: staff, Gym: report.Gym, Params: snippet, URL: gymPath(ctx, w.tx, report.Gym, "/manage/moderation"),
		}); err != nil {
			return err
		}
		if report.Reason != "other" {
			admins, err := platformAdmins(ctx, w.tx)
			if err != nil {
				return err
			}
			if err := publishNotify(ctx, w.tx, Notify{
				Type: "report_filed_platform", Users: admins, Gym: report.Gym, Params: snippet, URL: "/platform/moderation",
			}); err != nil {
				return err
			}
		}
		w.after = append(w.after, func(ctx context.Context) { m.sendReceipt(ctx, report) })
		return m.countReport(ctx, w, report)
	})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, map[string]string{"id": report.ID})
	return nil
}

// countReport raises the content's case; content that is already hidden gets that decision instead of a case nobody can act on.
func (m *module) countReport(ctx context.Context, w *work, report Report) error {
	if it, err := itemOf(ctx, w.tx, report.ContentType, report.ContentID); err == nil && it.State == "hidden" {
		return m.closeReports(ctx, w, report.ContentType, report.ContentID, "content_removed", it.Reason, "")
	}
	it, err := m.queue(ctx, w, report.ContentType, report.ContentID, false)
	if err != nil {
		return err
	}
	it.ReportsCount++
	return m.save(ctx, w, &it)
}

func (m *module) listReports(w http.ResponseWriter, r *http.Request, gym string) error {
	where, args := "WHERE true", []any{}
	if gym != "" {
		args = append(args, gym)
		where += " AND gym = $1"
	}
	if status := r.URL.Query().Get("status"); status != "" {
		args = append(args, status)
		where += " AND status = $" + strconv.Itoa(len(args))
	}
	p, limit, tail := page(r)
	items, err := queryReports(r.Context(), m.app.DB, `SELECT `+reportColumns+` FROM reports `+where+` ORDER BY created DESC, id`+tail, args...)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items, "page": p, "limit": limit})
	return nil
}

func (m *module) listGymReports(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	p, err := auth.Require(ctx)
	if err != nil {
		return err
	}
	gym, err := resolveGym(ctx, m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	if !p.PlatformAdmin && !m.can(ctx, p, gym, permReports) {
		return httpx.ErrForbidden
	}
	return m.listReports(w, r, gym)
}

func (m *module) listPlatformReports(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	if !p.PlatformAdmin {
		return httpx.ErrForbidden
	}
	return m.listReports(w, r, "")
}

func (m *module) decide(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	p, err := auth.Require(ctx)
	if err != nil {
		return err
	}
	var body struct {
		Action string `json:"action"`
		Reason string `json:"reason"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if (body.Action == "hide" || body.Action == "reject") && strings.TrimSpace(body.Reason) == "" {
		return badRequest("Hiding or declining needs a reason.")
	}
	it, err := findItem(ctx, m.app.DB, r.PathValue("id"))
	if err != nil {
		return err
	}
	gymStaff := m.can(ctx, p, it.Gym, permComments)
	if !p.PlatformAdmin && !gymStaff {
		return httpx.ErrNotFound
	}
	err = m.inTx(ctx, func(w *work) error {
		// Locked inside the transaction so two decisions on one case can't both apply.
		fresh, err := lockItem(ctx, w.tx, it.ID)
		if err != nil {
			return err
		}
		if err := allowed(fresh, body.Action, p.PlatformAdmin, gymStaff); err != nil {
			return err
		}
		wasPending := fresh.State == "pending"
		if err := m.apply(ctx, w, &fresh, body.Action, body.Reason, p.PlatformAdmin, p.UserID); err != nil {
			return err
		}
		it = fresh
		return m.notifyAuthor(ctx, w, fresh, body.Action, wasPending)
	})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"id": it.ID, "state": it.State, "hidden_by": it.HiddenBy})
	return nil
}

func (m *module) hideAuthor(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	p, err := auth.Require(ctx)
	if err != nil {
		return err
	}
	if !p.PlatformAdmin {
		return httpx.NewError(http.StatusForbidden, "Only platform admins can hide all content of a person.")
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if strings.TrimSpace(body.Reason) == "" {
		return badRequest("Hiding needs a reason.")
	}
	authorID := r.PathValue("id")
	var hidden []Item
	err = m.inTx(ctx, func(w *work) error {
		// Content from before the queue existed has no case yet; bulk actions need one per piece.
		for kindName, sql := range map[string]string{
			"rating":     `SELECT id FROM ratings WHERE "user" = $1 AND comment <> ''`,
			"beta_video": `SELECT id FROM beta_videos WHERE "user" = $1`,
		} {
			rows, err := w.tx.Query(ctx, sql, authorID)
			if err != nil {
				return err
			}
			contentIDs, err := pgx.CollectRows(rows, pgx.RowTo[string])
			if err != nil {
				return err
			}
			for _, id := range contentIDs {
				if _, err := m.queue(ctx, w, kindName, id, true); err != nil {
					return err
				}
			}
		}
		items, err := queryItems(ctx, w.tx, `WHERE author = $1 AND content_type <> 'profile' AND state IN ('unreviewed', 'approved', 'pending')
			ORDER BY created FOR UPDATE`, authorID)
		if err != nil {
			return err
		}
		for _, it := range items {
			if _, err := loadContent(ctx, w.tx, it.ContentType, it.ContentID); errors.Is(err, httpx.ErrNotFound) && !it.quarantined() {
				continue
			} else if err != nil && !errors.Is(err, httpx.ErrNotFound) {
				return err
			}
			if err := m.apply(ctx, w, &it, "hide", body.Reason, true, p.UserID); err != nil {
				return err
			}
			hidden = append(hidden, it)
		}
		if len(hidden) == 0 {
			return nil
		}
		w.after = append(w.after, func(ctx context.Context) { m.sendStatement(ctx, authorID, hidden) })
		return publishNotify(ctx, w.tx, Notify{
			Type: "content_hidden", Users: []string{authorID}, Params: map[string]any{"reason": truncate(hidden[0].Reason, 140)}, URL: "/",
		})
	})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]int{"hidden": len(hidden)})
	return nil
}

// openCase opens a case for content from before the inbox existed.
func (m *module) openCase(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	p, err := auth.Require(ctx)
	if err != nil {
		return err
	}
	var body struct {
		ContentType string `json:"content_type"`
		ContentID   string `json:"content_id"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if _, ok := kinds[body.ContentType]; !ok {
		return badRequest("This content cannot be moderated.")
	}
	c, err := loadContent(ctx, m.app.DB, body.ContentType, body.ContentID)
	if err != nil {
		return err
	}
	if !p.PlatformAdmin && !m.can(ctx, p, c.Gym, permComments) {
		return httpx.ErrNotFound
	}
	var it Item
	err = m.inTx(ctx, func(w *work) error {
		it, err = m.queue(ctx, w, body.ContentType, body.ContentID, true)
		return err
	})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"id": it.ID, "state": it.State})
	return nil
}

// mayView mirrors the inbox rule: platform admins, or the gym's comment and report handlers.
func (m *module) mayView(ctx context.Context, p auth.Principal, gym string) bool {
	return p.PlatformAdmin || m.can(ctx, p, gym, permComments, permReports)
}

func (m *module) getCase(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	p, err := auth.Require(ctx)
	if err != nil {
		return err
	}
	it, err := findItem(ctx, m.app.DB, r.PathValue("id"))
	if err != nil {
		return err
	}
	if !m.mayView(ctx, p, it.Gym) {
		return httpx.ErrNotFound
	}
	m.enrich(ctx, &it, p)
	httpx.JSON(w, http.StatusOK, it)
	return nil
}

func (m *module) listCases(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	p, err := auth.Require(ctx)
	if err != nil {
		return err
	}
	query := r.URL.Query()
	where, args := []string{"true"}, []any{}
	arg := func(clause string, value any) {
		args = append(args, value)
		where = append(where, strings.ReplaceAll(clause, "?", "$"+strconv.Itoa(len(args))))
	}
	if value := query.Get("gym"); value != "" {
		gym, err := resolveGym(ctx, m.app.DB, value)
		if errors.Is(err, httpx.ErrNotFound) && p.PlatformAdmin {
			gym, err = value, nil
		}
		if err != nil {
			return err
		}
		if !m.mayView(ctx, p, gym) {
			return httpx.ErrForbidden
		}
		arg("gym = ?", gym)
	} else if !p.PlatformAdmin {
		return httpx.ErrForbidden
	}
	// Gym staff must not narrow cases down by author: that would unmask anonymous reviewers.
	if author := query.Get("author"); author != "" {
		if !p.PlatformAdmin {
			return httpx.NewError(http.StatusForbidden, "Filtering cases by author is reserved for platform admins.")
		}
		arg("author = ?", author)
	}
	if picked := append(query["state"], query["state[]"]...); len(picked) > 0 {
		for _, s := range picked {
			if !slices.Contains(states, s) {
				return invalid("state", "Unknown state "+s+".")
			}
		}
		arg("state = ANY (?)", picked)
	}
	if contentType := query.Get("content_type"); contentType != "" {
		arg("content_type = ?", contentType)
	}
	if q := strings.TrimSpace(query.Get("q")); q != "" {
		arg("snapshot::text ILIKE ?", "%"+strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(q)+"%")
	}
	if query.Get("queue") == "platform" {
		where = append(where, "(reports_count > 0 OR gym IS NULL)")
	}
	order, ok := caseSorts[query.Get("sort")]
	if !ok {
		return invalid("sort", "Unknown sort key "+query.Get("sort")+".")
	}
	filter := "WHERE " + strings.Join(where, " AND ")
	pg, limit, tail := page(r)
	items, err := queryItems(ctx, m.app.DB, filter+" ORDER BY "+order+", id"+tail, args...)
	if err != nil {
		return err
	}
	for i := range items {
		m.enrich(ctx, &items[i], p)
	}
	body := map[string]any{"items": items, "page": pg, "limit": limit}
	if query.Get("total") == "true" {
		var total int
		if err := m.app.DB.QueryRow(ctx, `SELECT count(*) FROM moderation_items `+filter, args...).Scan(&total); err != nil {
			return err
		}
		body["total"] = total
	}
	httpx.JSON(w, http.StatusOK, body)
	return nil
}

var caseSorts = map[string]string{
	"": "reports_count DESC, created ASC", "reviewed": "reviewed_at DESC NULLS LAST", "newest": "created DESC",
}

func (m *module) summary(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	p, err := auth.Require(ctx)
	if err != nil {
		return err
	}
	count := func(sql string, args ...any) int {
		var n int
		m.app.DB.QueryRow(ctx, sql, args...).Scan(&n)
		return n
	}
	if value := r.URL.Query().Get("gym"); value != "" {
		gym, err := resolveGym(ctx, m.app.DB, value)
		if err != nil {
			return err
		}
		if !m.mayView(ctx, p, gym) {
			return httpx.ErrForbidden
		}
		httpx.JSON(w, http.StatusOK, map[string]int{
			"decide":  count(`SELECT count(*) FROM moderation_items WHERE gym = $1 AND state = 'unreviewed'`, gym),
			"waiting": count(`SELECT count(*) FROM moderation_items WHERE gym = $1 AND state = 'pending'`, gym),
			"hidden":  count(`SELECT count(*) FROM moderation_items WHERE gym = $1 AND state = 'hidden'`, gym),
		})
		return nil
	}
	if !p.PlatformAdmin {
		return httpx.ErrForbidden
	}
	type backlog struct {
		Gym    string `json:"gym"`
		Open   int    `json:"open"`
		Oldest string `json:"oldest"`
	}
	rows, err := m.app.DB.Query(ctx, `SELECT gym, count(*), to_char(min(created) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MSZ')
		FROM moderation_items WHERE gym IS NOT NULL AND state IN ('unreviewed', 'pending') GROUP BY gym ORDER BY gym`)
	if err != nil {
		return err
	}
	gyms, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (backlog, error) {
		var b backlog
		return b, row.Scan(&b.Gym, &b.Open, &b.Oldest)
	})
	if err != nil {
		return err
	}
	if gyms == nil {
		gyms = []backlog{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"decide":        count(`SELECT count(*) FROM moderation_items WHERE state = 'unreviewed' AND (reports_count > 0 OR gym IS NULL)`),
		"legal_reports": count(`SELECT count(*) FROM reports WHERE status = 'open' AND reason <> 'other'`),
		"profiles":      count(`SELECT count(*) FROM moderation_items WHERE content_type = 'profile' AND state = 'unreviewed'`),
		"suspended":     count(`SELECT count(*) FROM users WHERE suspended_until > now()`),
		"gyms":          gyms,
	})
	return nil
}

type Context struct {
	Author      *climbers.Climber `json:"author,omitempty"`
	History     *History          `json:"history,omitempty"`
	Route       *RouteSummary     `json:"route,omitempty"`
	Competition string            `json:"competition,omitempty"`
	GymName     string            `json:"gym_name,omitempty"`
	Reports     []CaseReport      `json:"reports"`
}

type History struct {
	Items  int `json:"items"`
	Hidden int `json:"hidden"`
}

type RouteSummary struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Grade string `json:"grade"`
	Color string `json:"color"`
}

type CaseReport struct {
	ID           string `json:"id"`
	Reason       string `json:"reason"`
	Explanation  string `json:"explanation"`
	NotifierName string `json:"notifier_name"`
	Status       string `json:"status"`
	Created      string `json:"created"`
}

// enrich adds the context a decision needs. Gym staff don't learn who wrote an anonymous review,
// and only report handlers see who reported and why.
func (m *module) enrich(ctx context.Context, it *Item, viewer auth.Principal) {
	db := m.app.DB
	c := &Context{Reports: []CaseReport{}}
	if it.Author != "" {
		if author, ok := m.author(ctx, db, it.Author, it.ContentType == "rating" && !viewer.PlatformAdmin); ok {
			c.Author = &author
			c.History = &History{}
			db.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE state = 'hidden') FROM moderation_items
				WHERE author = $1 AND content_type <> 'profile'`, it.Author).Scan(&c.History.Items, &c.History.Hidden)
		}
	}
	if c.Author == nil {
		it.Author = ""
		delete(it.Snapshot, "user")
	}
	var routeID string
	switch it.ContentType {
	case "rating":
		routeID, _ = it.Snapshot["route_id"].(string)
	case "beta_video":
		routeID, _ = it.Snapshot["route"].(string)
	case "route":
		routeID = it.ContentID
	case "task":
		db.QueryRow(ctx, `SELECT COALESCE(route, '') FROM tasks WHERE id = $1`, it.ContentID).Scan(&routeID)
	case "competition_entry":
		db.QueryRow(ctx, `SELECT c.name FROM competition_entries e JOIN competitions c ON c.id = e.competition WHERE e.id = $1`, it.ContentID).
			Scan(&c.Competition)
	}
	if routeID != "" {
		var route RouteSummary
		if db.QueryRow(ctx, `SELECT id, name, grade, color FROM routes WHERE id = $1`, routeID).Scan(&route.ID, &route.Name, &route.Grade, &route.Color) == nil {
			c.Route = &route
		}
	}
	db.QueryRow(ctx, `SELECT name FROM gyms WHERE id = $1`, it.Gym).Scan(&c.GymName)
	reportHandler := viewer.PlatformAdmin || m.can(ctx, viewer, it.Gym, permReports)
	rows, err := db.Query(ctx, `SELECT id, reason, explanation, notifier_name, status, to_char(created AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MSZ')
		FROM reports WHERE content_type = $1 AND content_id = $2 ORDER BY created DESC LIMIT 20`, it.ContentType, it.ContentID)
	if err == nil {
		reports, _ := pgx.CollectRows(rows, func(row pgx.CollectableRow) (CaseReport, error) {
			var cr CaseReport
			err := row.Scan(&cr.ID, &cr.Reason, &cr.Explanation, &cr.NotifierName, &cr.Status, &cr.Created)
			if !reportHandler {
				cr.Explanation, cr.NotifierName = "", ""
			}
			return cr, err
		})
		c.Reports = append(c.Reports, reports...)
	}
	it.Context = c
}
