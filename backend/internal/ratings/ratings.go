package ratings

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/captcha"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
)

const (
	defaultPageSize    = 50
	maxPageSize        = 500
	maxCommentLength   = 5000
	maxGradeIndex      = 40
	maxImportedRatings = 500
)

type ratingPage struct {
	Items []Rating `json:"items"`
	Page  int      `json:"page"`
	Limit int      `json:"limit"`
	Total *int     `json:"total,omitempty"`
}

type ratingInput struct {
	Rating      *int     `json:"rating"`
	Comment     *string  `json:"comment"`
	Grade       *string  `json:"grade"`
	GradeSystem *string  `json:"grade_system"`
	GradeIndex  *float64 `json:"grade_index"`
}

func invalid(field, message string) *httpx.Error {
	return httpx.NewError(http.StatusBadRequest, message).Field(field, "validation_invalid_value", message)
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
	if r.Rating < 0 || r.Rating > 5 {
		return invalid("rating", "Rating must be between 0 and 5.")
	}
	if len([]rune(r.Comment)) > maxCommentLength {
		return invalid("comment", "Comment must be at most 5000 characters.")
	}
	if r.GradeIndex < 0 || r.GradeIndex > maxGradeIndex {
		return invalid("grade_index", "Grade index must be between 0 and 40.")
	}
	return nil
}

func pageParams(r *http.Request) (int, int, string) {
	atoi := func(value string, fallback int) int {
		if n, err := strconv.Atoi(value); err == nil {
			return n
		}
		return fallback
	}
	page := max(1, atoi(r.URL.Query().Get("page"), 1))
	limit := min(maxPageSize, max(1, atoi(r.URL.Query().Get("limit"), defaultPageSize)))
	return page, limit, " LIMIT " + strconv.Itoa(limit) + " OFFSET " + strconv.Itoa((page-1)*limit)
}

func (m *module) listRouteRatings(w http.ResponseWriter, r *http.Request) error {
	page, limit, tail := pageParams(r)
	where := &conditions{}
	where.add("route_id = ?", r.PathValue("id"))
	items, err := queryRatings(r.Context(), m.app.DB, where, " ORDER BY created DESC, id"+tail)
	if err != nil {
		return err
	}
	if err := m.enrichRatings(r.Context(), items, true); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, ratingPage{Items: items, Page: page, Limit: limit})
	return nil
}

var gymRatingSorts = map[string]string{
	"newest": "created DESC", "oldest": "created ASC", "highest": "rating DESC, created DESC", "lowest": "rating ASC, created DESC",
}

func (m *module) listGymRatings(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	gym, err := resolveGym(ctx, m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	if err := m.require(ctx, gym, permManageComments); err != nil {
		return err
	}
	query := r.URL.Query()
	where := &conditions{}
	where.add("gym = ?", gym)
	for key, clause := range map[string]string{"rating": "rating = ?", "min_rating": "rating >= ?", "max_rating": "rating <= ?"} {
		if value := query.Get(key); value != "" {
			n, err := strconv.Atoi(value)
			if err != nil {
				return invalid(key, "Must be a number.")
			}
			where.add(clause, n)
		}
	}
	for key, clause := range map[string]string{
		"grade_system": "grade_system = ?", "grade": "grade = ?",
		"location": "route_id IN (SELECT id FROM routes WHERE location = ?)",
	} {
		if value := query.Get(key); value != "" {
			where.add(clause, value)
		}
	}
	for key, clause := range map[string]string{"route": "route_id = ANY (?)", "ids": "id = ANY (?)"} {
		if value := query.Get(key); value != "" {
			where.add(clause, strings.Split(value, ","))
		}
	}
	if since := query.Get("since"); since != "" {
		at, ok := parseDate(since)
		if !ok {
			return invalid("since", "Invalid date.")
		}
		where.add("created >= ?", at)
	}
	if q := strings.TrimSpace(query.Get("q")); q != "" {
		pattern := "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(q) + "%"
		where.add("(comment ILIKE ? OR route_id IN (SELECT id FROM routes WHERE name ILIKE $"+strconv.Itoa(len(where.args)+1)+"))", pattern)
	}
	sort := query.Get("sort")
	if sort == "" {
		sort = "newest"
	}
	order, ok := gymRatingSorts[sort]
	if !ok {
		return invalid("sort", "Unknown sort key "+sort+".")
	}
	page, limit, tail := pageParams(r)
	items, err := queryRatings(ctx, m.app.DB, where, " ORDER BY "+order+", id"+tail)
	if err != nil {
		return err
	}
	if err := m.enrichRatings(ctx, items, false); err != nil {
		return err
	}
	if err := m.expandRoutes(ctx, items); err != nil {
		return err
	}
	result := ratingPage{Items: items, Page: page, Limit: limit}
	if query.Get("total") == "true" {
		var total int
		if err := m.app.DB.QueryRow(ctx, `SELECT COUNT(*) FROM ratings`+where.sql(), where.args...).Scan(&total); err != nil {
			return err
		}
		result.Total = &total
	}
	httpx.JSON(w, http.StatusOK, result)
	return nil
}

// expandRoutes keeps the shape the reviews page read from PocketBase: expand.route_id.{id,name,expand.location.name}.
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
	gym, err := resolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	stats, err := ratingStats(r.Context(), m.app.DB, gym)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, stats)
	return nil
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
	rating := Rating{ID: ids.New(), Gym: route.Gym, RouteID: route.ID, Created: time.Now()}
	if viewer, ok := auth.From(ctx); ok {
		rating.User = viewer.UserID
	} else if err := captcha.Request(ctx, m.app.DB, r, "rating"); err != nil {
		return err
	}
	if err := in.applyTo(&rating); err != nil {
		return err
	}
	created, err := m.saveRating(ctx, nil, func(tx pgx.Tx) error {
		if err := insertRating(ctx, tx, rating); err != nil {
			return err
		}
		return events.PublishAs(ctx, tx, actorOf(ctx), TopicRatingCreated, TopicRatingCreated,
			RatingCreated{ID: rating.ID, Gym: rating.Gym, Route: rating.RouteID, User: rating.User}, events.Audience{})
	}, rating.ID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, created)
	return nil
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
	if err := m.require(ctx, rating.Gym, permManageComments); err != nil {
		return err
	}
	before := rating
	if err := in.applyTo(&rating); err != nil {
		return err
	}
	updated, err := m.saveRating(ctx, &before, func(tx pgx.Tx) error { return updateRating(ctx, tx, rating) }, rating.ID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, updated)
	return nil
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
	if rating.User != viewer.UserID && !m.can(ctx, rating.Gym, permManageComments) {
		return httpx.ErrForbidden
	}
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if err := deleteRow(ctx, tx, "ratings", rating.ID); err != nil {
			return err
		}
		return m.publishRatingChange(ctx, tx, actorOf(ctx), "delete", rating, nil)
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
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
			return m.publishRatingChange(ctx, tx, actorOf(ctx), "create", saved, nil)
		}
		return m.publishRatingChange(ctx, tx, actorOf(ctx), "update", saved, changedFields(*before, saved))
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
	gym, err := resolveGym(ctx, m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	if err := m.require(ctx, gym, permManageRoutes); err != nil {
		return err
	}
	var body struct {
		Ratings []json.RawMessage `json:"ratings"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if len(body.Ratings) > maxImportedRatings {
		return httpx.NewError(http.StatusBadRequest, "Too many ratings in one request.")
	}
	failed := 0
	for _, raw := range body.Ratings {
		if m.importRating(ctx, gym, raw) != nil {
			failed++
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]int{"failed": failed})
	return nil
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
		return m.publishRatingChange(ctx, tx, "", "create", saved, nil)
	})
}

// importedDate keeps a past review date; missing, unparsable or future dates become now.
func importedDate(value string, now time.Time) time.Time {
	if at, ok := parseDate(value); ok && !at.IsZero() && at.Before(now) {
		return at
	}
	return now
}

func parseDate(value string) (time.Time, bool) {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05.000Z", "2006-01-02 15:04:05Z", "2006-01-02 15:04:05", "2006-01-02"} {
		if at, err := time.Parse(layout, strings.TrimSpace(value)); err == nil {
			return at, true
		}
	}
	return time.Time{}, false
}
