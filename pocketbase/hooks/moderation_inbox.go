package hooks

import (
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

type moderationReport struct {
	ID           string `json:"id"`
	Reason       string `json:"reason"`
	Explanation  string `json:"explanation"`
	NotifierName string `json:"notifier_name"`
	Status       string `json:"status"`
	Created      string `json:"created"`
}

type moderationRoute struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Grade string `json:"grade"`
	Color string `json:"color"`
}

type authorHistory struct {
	Items  int64 `json:"items"`
	Hidden int64 `json:"hidden"`
}

type moderationContext struct {
	Author      *climber           `json:"author,omitempty"`
	History     *authorHistory     `json:"history,omitempty"`
	Route       *moderationRoute   `json:"route,omitempty"`
	Competition string             `json:"competition,omitempty"`
	GymName     string             `json:"gym_name,omitempty"`
	Reports     []moderationReport `json:"reports"`
}

func registerModerationInbox(app core.App) {
	app.OnRecordEnrich("moderation_items").BindFunc(func(e *core.RecordEnrichEvent) error {
		var viewer *core.Record
		if e.RequestInfo != nil {
			viewer = e.RequestInfo.Auth
		}
		context := contextOf(e.App, e.Record, viewer)
		if context.Author == nil {
			concealAuthor(e.Record)
		}
		e.Record.WithCustomData(true)
		e.Record.Set("context", context)
		return e.Next()
	})

	// Gym staff must not narrow cases down by author: that would unmask anonymous reviewers.
	app.OnRecordsListRequest("moderation_items").BindFunc(func(e *core.RecordsListRequestEvent) error {
		if !e.HasSuperuserAuth() && !isPlatformAdmin(e.Auth) && mentionsAuthor(e.Request.URL.Query().Get("filter"), e.Request.URL.Query().Get("sort")) {
			return apis.NewForbiddenError("Filtering cases by author is reserved for platform admins.", nil)
		}
		return e.Next()
	})
	app.OnRealtimeSubscribeRequest().BindFunc(func(e *core.RealtimeSubscribeRequestEvent) error {
		if e.HasSuperuserAuth() || isPlatformAdmin(e.Auth) {
			return e.Next()
		}
		for _, subscription := range e.Subscriptions {
			if strings.HasPrefix(subscription, "moderation_items") && mentionsAuthor(subscription) {
				return apis.NewForbiddenError("Filtering cases by author is reserved for platform admins.", nil)
			}
		}
		return e.Next()
	})

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.GET("/api/moderation/summary", moderationSummary).Bind(apis.RequireAuth("users"))
		se.Router.POST("/api/moderation/authors/{id}/hide", hideAuthorContent).Bind(apis.RequireAuth("users"))
		se.Router.POST("/api/moderation/cases", openCase).Bind(apis.RequireAuth("users"))
		return se.Next()
	})
}

// Platform admins see everything; gym staff don't learn who wrote an anonymous review,
// and only report handlers (manage_reports) see who reported and why.
func contextOf(app core.App, item *core.Record, viewer *core.Record) moderationContext {
	context := moderationContext{Reports: []moderationReport{}}
	var snapshot map[string]any
	_ = item.UnmarshalJSONField("snapshot", &snapshot)

	platform := viewer != nil && (viewer.IsSuperuser() || isPlatformAdmin(viewer))
	reportHandler := platform || (viewer != nil && hasPermission(app, viewer.Id, item.GetString("gym"), "manage_reports"))

	if author, ok := authorOf(app, item.GetString("author")); ok && !hidesAuthor(item, author, platform) {
		context.Author = &author.climber
	}
	if authorID := context.authorID(); authorID != "" {
		items := countItems(app, "author = {:author} AND content_type != 'profile'", dbx.Params{"author": authorID})
		hidden := countItems(app, "author = {:author} AND content_type != 'profile' AND state = 'hidden'", dbx.Params{"author": authorID})
		context.History = &authorHistory{Items: items, Hidden: hidden}
	}

	routeID := ""
	switch item.GetString("content_type") {
	case "rating":
		routeID, _ = snapshot["route_id"].(string)
	case "beta_video":
		routeID, _ = snapshot["route"].(string)
	case "route":
		routeID = item.GetString("content_id")
	case "task":
		if task, err := app.FindRecordById("tasks", item.GetString("content_id")); err == nil {
			routeID = task.GetString("route")
		}
	case "competition_entry":
		if entry, err := app.FindRecordById("competition_entries", item.GetString("content_id")); err == nil {
			if competition, err := app.FindRecordById("competitions", entry.GetString("competition")); err == nil {
				context.Competition = competition.GetString("name")
			}
		}
	}
	if routeID != "" {
		if route, err := app.FindRecordById("routes", routeID); err == nil {
			context.Route = &moderationRoute{ID: route.Id, Name: route.GetString("name"), Grade: route.GetString("grade"), Color: route.GetString("color")}
		}
	}
	if gym, err := app.FindRecordById("gyms", item.GetString("gym")); err == nil {
		context.GymName = gym.GetString("name")
	}

	reports, err := app.FindRecordsByFilter("reports", "content_type = {:type} && content_id = {:id}", "-created", 20, 0,
		dbx.Params{"type": item.GetString("content_type"), "id": item.GetString("content_id")})
	if err == nil {
		for _, report := range reports {
			entry := moderationReport{
				ID: report.Id, Reason: report.GetString("reason"), Status: report.GetString("status"),
				Created: report.GetDateTime("created").String(),
			}
			if reportHandler {
				entry.Explanation = report.GetString("explanation")
				entry.NotifierName = report.GetString("notifier_name")
			}
			context.Reports = append(context.Reports, entry)
		}
	}
	return context
}

func mentionsAuthor(parts ...string) bool {
	for _, part := range parts {
		if strings.Contains(strings.ToLower(part), "author") {
			return true
		}
	}
	return false
}

func notifyAuthorOfBulkHide(app core.App, authorID string, items []*core.Record) {
	if len(items) == 0 {
		return
	}
	author, err := app.FindRecordById("users", authorID)
	if err != nil {
		return
	}
	pushNotification(app, notification{
		Users:  []*core.Record{author},
		Type:   "content_hidden",
		Params: map[string]any{"reason": truncateRunes(items[0].GetString("reason"), 140)},
		URL:    "/",
	})
	if err := sendStatementOfReasons(app, items, author); err != nil {
		app.Logger().Error("moderation: statement of reasons failed", "author", authorID, "error", err)
	}
}

func hidesAuthor(item *core.Record, author cachedAuthor, platform bool) bool {
	return author.anonymous && item.GetString("content_type") == "rating" && !platform
}

// The author id is only in the response when the viewer may know the author.
func concealAuthor(item *core.Record) {
	item.Set("author", "")
	var snapshot map[string]any
	if item.UnmarshalJSONField("snapshot", &snapshot) == nil && snapshot != nil {
		delete(snapshot, "user")
		item.Set("snapshot", snapshot)
	}
}

func (context moderationContext) authorID() string {
	if context.Author == nil {
		return ""
	}
	return context.Author.ID
}

func countItems(app core.App, filter string, params dbx.Params) int64 {
	total, err := app.CountRecords("moderation_items", dbx.NewExp(filter, params))
	if err != nil {
		app.Logger().Error("moderation: counting failed", "filter", filter, "error", err)
	}
	return total
}

func moderationSummary(e *core.RequestEvent) error {
	platform := isPlatformAdmin(e.Auth)
	gymID := e.Request.URL.Query().Get("gym")
	if gymID != "" {
		if !platform && !hasPermission(e.App, e.Auth.Id, gymID, "manage_comments") && !hasPermission(e.App, e.Auth.Id, gymID, "manage_reports") {
			return e.ForbiddenError("", nil)
		}
		params := dbx.Params{"gym": gymID}
		return e.JSON(http.StatusOK, map[string]int64{
			"decide":  countItems(e.App, "gym = {:gym} AND state = 'unreviewed'", params),
			"waiting": countItems(e.App, "gym = {:gym} AND state = 'pending'", params),
			"hidden":  countItems(e.App, "gym = {:gym} AND state = 'hidden'", params),
		})
	}
	if !platform {
		return e.ForbiddenError("", nil)
	}

	legalReports, _ := e.App.CountRecords("reports", dbx.NewExp("status = 'open' AND reason != 'other'"))
	suspended, _ := e.App.CountRecords("users", dbx.NewExp("suspended_until > {:now}", dbx.Params{"now": time.Now().UTC().Format("2006-01-02 15:04:05.000Z")}))
	type gymBacklog struct {
		Gym    string `db:"gym" json:"gym"`
		Open   int    `db:"open" json:"open"`
		Oldest string `db:"oldest" json:"oldest"`
	}
	backlog := []gymBacklog{}
	if err := e.App.DB().NewQuery("SELECT gym, COUNT(*) AS open, MIN(created) AS oldest FROM moderation_items WHERE gym != '' AND state IN ('unreviewed', 'pending') GROUP BY gym").All(&backlog); err != nil {
		return e.InternalServerError("", err)
	}
	return e.JSON(http.StatusOK, map[string]any{
		"decide":        countItems(e.App, "state = 'unreviewed' AND (reports_count > 0 OR gym = '')", nil),
		"legal_reports": legalReports,
		"profiles":      countItems(e.App, "content_type = 'profile' AND state = 'unreviewed'", nil),
		"suspended":     suspended,
		"gyms":          backlog,
	})
}

func hideAuthorContent(e *core.RequestEvent) error {
	if !isPlatformAdmin(e.Auth) {
		return e.ForbiddenError("Only platform admins can hide all content of a person.", nil)
	}
	var body moderationRequest
	if err := e.BindBody(&body); err != nil || strings.TrimSpace(body.Reason) == "" {
		return e.BadRequestError("Hiding needs a reason.", err)
	}
	authorID := e.Request.PathValue("id")
	hiddenItems := []*core.Record{}
	err := e.App.RunInTransaction(func(tx core.App) error {
		if err := queueAuthorContent(tx, authorID); err != nil {
			return err
		}
		items, err := tx.FindRecordsByFilter("moderation_items", "author = {:author} && content_type != 'profile' && (state = 'unreviewed' || state = 'approved' || state = 'pending')", "", 0, 0, dbx.Params{"author": authorID})
		if err != nil {
			return err
		}
		for _, item := range items {
			if err := applyModeration(tx, item, moderationRequest{Action: "hide", Reason: body.Reason}, true, e.Auth.Id); err != nil {
				return err
			}
			hiddenItems = append(hiddenItems, item)
		}
		return nil
	})
	if err != nil {
		return e.BadRequestError("The content could not be hidden.", err)
	}
	entry := requestAuditEntry(e, "update", "moderation_items")
	entry.RecordID = authorID
	entry.ChangedFields = []string{"state"}
	writeAuditEntry(e.App, entry)
	notifyAuthorOfBulkHide(e.App, authorID, hiddenItems)
	return e.JSON(http.StatusOK, map[string]int{"hidden": len(hiddenItems)})
}

// Content from before the queue existed has no item yet; bulk actions need one per piece.
func queueAuthorContent(app core.App, authorID string) error {
	for kindName, filter := range map[string]string{
		"rating":     "user = {:author} && comment != ''",
		"beta_video": "user = {:author}",
	} {
		records, err := app.FindRecordsByFilter(moderatedKinds[kindName].collection, filter, "", 0, 0, dbx.Params{"author": authorID})
		if err != nil {
			return err
		}
		for _, record := range records {
			if findModerationItem(app, kindName, record.Id) == nil {
				if err := upsertModerationItem(app, kindName, record); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

type openCaseRequest struct {
	ContentType string `json:"content_type"`
	ContentID   string `json:"content_id"`
}

// Content from before the inbox existed has no case until someone opens one.
func openCase(e *core.RequestEvent) error {
	var body openCaseRequest
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid case request.", err)
	}
	kind, moderated := moderatedKinds[body.ContentType]
	if !moderated {
		return e.BadRequestError("This content cannot be moderated.", nil)
	}
	record, err := e.App.FindRecordById(kind.collection, body.ContentID)
	if err != nil {
		return e.NotFoundError("", nil)
	}
	gymID := moderatedGym(e.App, body.ContentType, record)
	if !isPlatformAdmin(e.Auth) && (gymID == "" || !hasPermission(e.App, e.Auth.Id, gymID, "manage_comments")) {
		return e.NotFoundError("", nil)
	}
	item := findModerationItem(e.App, body.ContentType, record.Id)
	if item == nil {
		if err := upsertModerationItem(e.App, body.ContentType, record); err != nil {
			return e.BadRequestError("The case could not be opened.", err)
		}
		item = findModerationItem(e.App, body.ContentType, record.Id)
	}
	return e.JSON(http.StatusOK, map[string]string{"id": item.Id, "state": item.GetString("state")})
}
