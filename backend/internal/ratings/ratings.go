package ratings

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/apitime"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/captcha"
	"gripello/internal/platform/db"
	"gripello/internal/platform/events"
	"gripello/internal/platform/grades"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/tenancy"
)

const (
	defaultPageSize    = 50
	maxPageSize        = 500
	maxCommentLength   = 5000
	maxImportedRatings = 500
)

type ratingInput struct {
	Rating      *int     `json:"rating"`
	Comment     *string  `json:"comment"`
	Grade       *string  `json:"grade"`
	GradeSystem *string  `json:"grade_system"`
	GradeIndex  *float64 `json:"grade_index"`
}

func (in ratingInput) applyTo(r *Rating) error {
	if in.Rating != nil {
		r.Rating = *in.Rating
	}
	if in.Comment != nil {
		r.Comment = *in.Comment
	}
	if in.Grade != nil {
		r.Grade = *in.Grade
	}
	if in.GradeSystem != nil {
		r.GradeSystem = *in.GradeSystem
	}
	if in.GradeIndex != nil {
		r.GradeIndex = *in.GradeIndex
	}
	r.Grade = grades.Canonical(r.GradeSystem, r.Grade)
	if r.Rating < 0 || r.Rating > 5 {
		return httpx.Invalid("rating", "Rating must be between 0 and 5.")
	}
	if len([]rune(r.Comment)) > maxCommentLength {
		return httpx.Invalid("comment", "Comment must be at most 5000 characters.")
	}
	if r.GradeIndex < 0 || r.GradeIndex > grades.MaxIndex {
		return httpx.Invalid("grade_index", "Grade index must be between 0 and 40.")
	}
	if utf8.RuneCountInString(r.Grade) > grades.MaxLength {
		return httpx.Invalid("grade", fmt.Sprintf("Grade must be at most %d characters.", grades.MaxLength))
	}
	if utf8.RuneCountInString(r.GradeSystem) > grades.MaxSystemLength {
		return httpx.Invalid("grade_system", fmt.Sprintf("Grade system must be at most %d characters.", grades.MaxSystemLength))
	}
	return nil
}

func (m *module) listRouteRatings(w http.ResponseWriter, r *http.Request) error {
	page := httpx.Page(r, defaultPageSize, maxPageSize)
	where := &db.Where{}
	where.Add("route_id = ?", r.PathValue("id"))
	where.Add("gym_visible(gym, ?)", auth.UserID(r.Context()))
	items, err := queryRatings(r.Context(), m.app.DB, where, " ORDER BY created DESC, id"+page.SQL())
	if err != nil {
		return err
	}
	if err := m.enrichRatings(r.Context(), items, true); err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, httpx.PageOf[Rating]{Items: items, Page: page.Page, Limit: page.Limit}, nil)
}

var gymRatingSorts = map[string]string{
	"newest": "created DESC", "oldest": "created ASC", "highest": "rating DESC, created DESC", "lowest": "rating ASC, created DESC",
}

func (m *module) listGymRatings(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	gym, err := tenancy.ResolveGym(ctx, m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	if _, err := auth.Require(ctx); err != nil {
		return err
	}
	moderator := m.perms.Has(ctx, gym, tenancy.PermManageComments)
	if !moderator && !m.perms.Has(ctx, gym, tenancy.PermManageRoutes) {
		return httpx.ErrForbidden
	}
	query := r.URL.Query()
	where := &db.Where{}
	where.Add("gym = ?", gym)
	for key, clause := range map[string]string{"rating": "rating = ?", "min_rating": "rating >= ?", "max_rating": "rating <= ?"} {
		if value := query.Get(key); value != "" {
			n, err := strconv.Atoi(value)
			if err != nil {
				return httpx.Invalid(key, "Must be a number.")
			}
			where.Add(clause, n)
		}
	}
	for key, clause := range map[string]string{
		"grade_system": "grade_system = ?", "grade": "grade = ?",
		"location": "route_id IN (SELECT id FROM routes WHERE location = ?)",
	} {
		if value := query.Get(key); value != "" {
			where.Add(clause, value)
		}
	}
	for key, clause := range map[string]string{"route": "route_id = ANY (?)", "ids": "id = ANY (?)"} {
		if value := query.Get(key); value != "" {
			where.Add(clause, strings.Split(value, ","))
		}
	}
	if since := query.Get("since"); since != "" {
		at, err := apitime.ParseTimeOrDay(since)
		if err != nil {
			return httpx.Invalid("since", "Must be an RFC 3339 timestamp or a day as YYYY-MM-DD.")
		}
		where.Add("created >= ?", at)
	}
	if q := strings.TrimSpace(query.Get("q")); q != "" {
		where.Add("NOT EXISTS (SELECT 1 FROM unnest(?::text[]) w WHERE NOT (comment ILIKE w OR EXISTS (SELECT 1 FROM routes WHERE routes.id = ratings.route_id AND routes.name ILIKE w)))", db.WordPatterns(q))
	}
	sort := query.Get("sort")
	if sort == "" {
		sort = "newest"
	}
	order, ok := gymRatingSorts[sort]
	if !ok {
		return httpx.Invalid("sort", "Unknown sort key "+sort+".")
	}
	page := httpx.Page(r, defaultPageSize, maxPageSize)
	items, err := queryRatings(ctx, m.app.DB, where, " ORDER BY "+order+", id"+page.SQL())
	if err != nil {
		return err
	}
	if err := m.enrichRatings(ctx, items, !moderator); err != nil {
		return err
	}
	if err := m.expandRoutes(ctx, items); err != nil {
		return err
	}
	result := httpx.PageOf[Rating]{Items: items, Page: page.Page, Limit: page.Limit}
	if query.Get("total") == "true" {
		var total int
		if err := m.app.DB.QueryRow(ctx, `SELECT COUNT(*) FROM ratings`+where.SQL(), where.Args...).Scan(&total); err != nil {
			return err
		}
		result.Total = &total
	}
	return httpx.Respond(w, http.StatusOK, result, nil)
}

// expandRoutes fills the shape the reviews page reads: expand.route_id.{id,name,expand.location.name}.
func (m *module) expandRoutes(ctx context.Context, items []Rating) error {
	routeIDs := make([]string, len(items))
	for i, r := range items {
		routeIDs[i] = r.RouteID
	}
	rows, err := m.app.DB.Query(ctx, `SELECT r.id, r.name, COALESCE(l.name, '') FROM routes r LEFT JOIN locations l ON l.id = r.location WHERE r.id = ANY ($1)`, routeIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	routes := map[string]map[string]any{}
	for rows.Next() {
		var id, name, location string
		if err := rows.Scan(&id, &name, &location); err != nil {
			return err
		}
		route := map[string]any{"id": id, "name": name}
		if location != "" {
			route["expand"] = map[string]any{"location": map[string]string{"name": location}}
		}
		routes[id] = route
	}
	for i, r := range items {
		if route, ok := routes[r.RouteID]; ok {
			items[i].Expand = map[string]any{"route_id": route}
		}
	}
	return rows.Err()
}

func (m *module) getStats(w http.ResponseWriter, r *http.Request) error {
	gym, err := tenancy.ResolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	stats, err := ratingStats(r.Context(), m.app.DB, gym)
	return httpx.Respond(w, http.StatusOK, stats, err)
}

func (m *module) postRating(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	var in ratingInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	route, err := findRoute(ctx, m.app.DB, r.PathValue("id"))
	if err != nil {
		return err
	}
	if err := tenancy.RequireGym(ctx, m.app.DB, route.Gym); err != nil {
		return err
	}
	rating := Rating{ID: ids.New(), Gym: route.Gym, RouteID: route.ID, Created: time.Now()}
	if viewer, ok := auth.From(ctx); ok {
		rating.User = viewer.UserID
	} else if auth.StaleBearer(r) {
		return httpx.ErrUnauthorized
	} else if err := captcha.Request(ctx, m.app.DB, r, "rating"); err != nil {
		return err
	}
	if err := in.applyTo(&rating); err != nil {
		return err
	}
	if rating.User == "" && rating.Rating == 0 && httpx.Blank(rating.Comment) && strings.TrimSpace(rating.Grade) == "" {
		return httpx.BadRequest("A review needs stars, a comment or a grade.").
			Field("rating", "validation_required", "A review needs stars, a comment or a grade.")
	}
	created, err := m.saveRating(ctx, nil, func(tx pgx.Tx) error {
		if err := insertRating(ctx, tx, rating); err != nil {
			return err
		}
		return events.PublishAs(ctx, tx, auth.UserID(ctx), TopicRatingCreated, TopicRatingCreated,
			RatingCreated{ID: rating.ID, Gym: rating.Gym, Route: rating.RouteID, User: rating.User}, events.Audience{})
	}, rating.ID)
	if db.IsUnique(err, "ratings_route_user_idx") {
		return httpx.NewError(http.StatusConflict, "You already reviewed this route.").Field("rating", "validation_already_reviewed", "You already reviewed this route.")
	}
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusCreated, created, nil)
}

func (m *module) patchRating(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	var in ratingInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	rating, err := findRating(ctx, m.app.DB, r.PathValue("id"))
	if err != nil {
		return err
	}
	// One review per climber and route, so the author edits it instead of writing a second one; staff edit any.
	if rating.User == "" || rating.User != auth.UserID(ctx) {
		if err := m.perms.Require(ctx, rating.Gym, tenancy.PermManageComments); err != nil {
			return err
		}
	}
	before := rating
	if err := in.applyTo(&rating); err != nil {
		return err
	}
	updated, err := m.saveRating(ctx, &before, func(tx pgx.Tx) error { return updateRating(ctx, tx, rating) }, rating.ID)
	return httpx.Respond(w, http.StatusOK, updated, err)
}

func (m *module) deleteRating(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	viewer, err := auth.Require(ctx)
	if err != nil {
		return err
	}
	rating, err := findRating(ctx, m.app.DB, r.PathValue("id"))
	if err != nil {
		return err
	}
	if rating.User != viewer.UserID && !m.perms.Has(ctx, rating.Gym, tenancy.PermManageComments) {
		return httpx.ErrForbidden
	}
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if err := deleteRow(ctx, tx, "ratings", rating.ID); err != nil {
			return err
		}
		return m.publishRatingChange(ctx, tx, auth.UserID(ctx), "delete", rating, nil)
	})
	if err != nil {
		return err
	}
	return httpx.NoContent(w, nil)
}

// saveRating publishes a create when before is nil, otherwise an update with the fields that changed.
func (m *module) saveRating(ctx context.Context, before *Rating, write func(pgx.Tx) error, id string) (Rating, error) {
	var saved Rating
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if err := write(tx); err != nil {
			return err
		}
		var err error
		if saved, err = findRating(ctx, tx, id); err != nil {
			return err
		}
		if before == nil {
			return m.publishRatingChange(ctx, tx, auth.UserID(ctx), "create", saved, nil)
		}
		return m.publishRatingChange(ctx, tx, auth.UserID(ctx), "update", saved, events.ChangedFields(*before, saved, derivedFields...))
	})
	if err != nil {
		return saved, err
	}
	items := []Rating{saved}
	err = m.enrichRatings(ctx, items, true)
	return items[0], err
}

type importedRating struct {
	RouteID string `json:"route_id"`
	ratingInput
	Created string `json:"created"`
}

func (m *module) importRatings(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	gym, err := tenancy.ResolveGym(ctx, m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	if err := m.perms.Require(ctx, gym, tenancy.PermManageRoutes); err != nil {
		return err
	}
	var body struct {
		Ratings []json.RawMessage `json:"ratings"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if len(body.Ratings) > maxImportedRatings {
		return httpx.BadRequest("Too many ratings in one request.")
	}
	failed := 0
	for _, raw := range body.Ratings {
		if m.importRating(ctx, gym, raw) != nil {
			failed++
		}
	}
	return httpx.Respond(w, http.StatusOK, map[string]int{"failed": failed}, nil)
}

func (m *module) importRating(ctx context.Context, gym string, raw json.RawMessage) error {
	var in importedRating
	if err := json.Unmarshal(raw, &in); err != nil {
		return err
	}
	route, err := findRoute(ctx, m.app.DB, in.RouteID)
	if err != nil {
		return err
	}
	if route.Gym != gym {
		return httpx.ErrForbidden
	}
	rating := Rating{ID: ids.New(), Gym: gym, RouteID: route.ID, Created: importedDate(in.Created, time.Now())}
	if err := in.applyTo(&rating); err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if err := insertRating(ctx, tx, rating); err != nil {
			return err
		}
		saved, err := findRating(ctx, tx, rating.ID)
		if err != nil {
			return err
		}
		return m.publishRatingChange(ctx, tx, auth.UserID(ctx), "create", saved, nil)
	})
}

// importedDate keeps a past review date; missing, unparsable or future dates become now.
func importedDate(value string, now time.Time) time.Time {
	if at, err := apitime.ParseTimeOrDay(strings.TrimSpace(value)); err == nil && !at.IsZero() && at.Before(now) {
		return at
	}
	return now
}
