package routes

import (
	"context"
	"io"
	"net/http"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/apitime"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/db"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/tenancy"
)

const (
	defaultPageSize   = 50
	maxPageSize       = 1000
	maxTraceSize      = 10 << 20
	maxFloorPlanWalls = 200
)

var routeSorts = map[string]string{
	"name": "name", "created": "created", "updated": "updated", "screw_date": "screw_date",
	"average_rating": "average_rating", "ratings_count": "ratings_count", "grade_index": "grade_index",
	"type": "type", "anchor_point": "anchor_point", "comment": "comment", "creator": "creator::text",
	"color": "color", "archived_at": "archived_at", "wall_position": "wall_position", "removal_planned_for": "removal_planned_for",
	"location": "(SELECT l.name FROM locations l WHERE l.id = average_rating.location)",
}

func routeOrder(sort string) (string, error) {
	if sort == "" {
		sort = "-created"
	}
	var parts []string
	for _, key := range strings.Split(sort, ",") {
		direction := "ASC"
		if strings.HasPrefix(key, "-") {
			direction, key = "DESC", key[1:]
		}
		column, ok := routeSorts[key]
		if !ok {
			return "", httpx.Invalid("sort", "Unknown sort key "+key+".")
		}
		parts = append(parts, column+" "+direction+" NULLS LAST")
	}
	return " ORDER BY " + strings.Join(parts, ", ") + ", id", nil
}

func routeFilter(gym string, query map[string][]string) (*db.Where, error) {
	get := func(key string) string {
		if values := query[key]; len(values) > 0 {
			return values[0]
		}
		return ""
	}
	where := &db.Where{}
	where.Add("gym = ?", gym)
	switch get("archived") {
	case "", "false":
		where.Add("archived = ?", false)
	case "true":
		where.Add("archived = ?", true)
	case "all":
	default:
		return nil, httpx.Invalid("archived", "archived must be true, false or all.")
	}
	if location := get("location"); location != "" {
		where.Add("location = ?", location)
	}
	switch wall := get("wall"); wall {
	case "":
	case "none":
		where.Clauses = append(where.Clauses, "wall IS NULL")
	case "any":
		where.Clauses = append(where.Clauses, "wall IS NOT NULL")
	default:
		where.Add("wall = ?", wall)
	}
	for _, key := range []string{"type", "color", "grade_system"} {
		if value := get(key); value != "" {
			where.Add(key+" = ?", value)
		}
	}
	if grades := query["grade"]; len(grades) > 0 {
		lowered := make([]string, len(grades))
		for i, grade := range grades {
			lowered[i] = strings.ToLower(grade)
		}
		where.Add("lower(grade) = ANY (?)", lowered)
	}
	if q := strings.TrimSpace(get("q")); q != "" {
		where.Add("NOT EXISTS (SELECT 1 FROM unnest(?::text[]) w WHERE NOT (name ILIKE w OR creator::text ILIKE w))", db.WordPatterns(q))
	}
	if since := get("since"); since != "" {
		at, err := apitime.ParseTimeOrDay(since)
		if err != nil {
			return nil, httpx.Invalid("since", "Must be an RFC 3339 timestamp or a day as YYYY-MM-DD.")
		}
		where.Add("created >= ?", at)
	}
	switch get("removal") {
	case "":
	case "planned":
		where.Clauses = append(where.Clauses, "removal_planned_for IS NOT NULL")
	default:
		return nil, httpx.Invalid("removal", "removal must be planned.")
	}
	if list := get("ids"); list != "" {
		where.Add("id = ANY (?)", strings.Split(list, ","))
	}
	return where, nil
}

func (m *module) listRoutes(w http.ResponseWriter, r *http.Request) error {
	gym, err := tenancy.ResolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	query := r.URL.Query()
	where, err := routeFilter(gym, query)
	if err != nil {
		return err
	}
	order, err := routeOrder(query.Get("sort"))
	if err != nil {
		return err
	}
	page := httpx.Page(r, defaultPageSize, maxPageSize)
	items, err := queryRoutes(r.Context(), m.app.DB, where, order+page.SQL())
	if err != nil {
		return err
	}
	if err := m.expand(r.Context(), items, query.Get("include")); err != nil {
		return err
	}
	result := httpx.PageOf[Route]{Items: items, Page: page.Page, Limit: page.Limit}
	if query.Get("total") == "true" {
		total, err := countRoutes(r.Context(), m.app.DB, where)
		if err != nil {
			return err
		}
		result.Total = &total
	}
	return httpx.Respond(w, http.StatusOK, result, nil)
}

// expand fills `expand`, so `route.expand.location.name` keeps working.
func (m *module) expand(ctx context.Context, items []Route, include string) error {
	if include == "" || len(items) == 0 {
		return nil
	}
	collect := func(value func(Route) string) []string {
		var out []string
		for _, route := range items {
			if v := value(route); v != "" {
				out = append(out, v)
			}
		}
		return out
	}
	set := func(i int, key string, value any) {
		if items[i].Expand == nil {
			items[i].Expand = map[string]any{}
		}
		items[i].Expand[key] = value
	}
	relations := strings.Split(include, ",")
	slices.Sort(relations)
	for _, relation := range slices.Compact(relations) {
		switch relation {
		case "location":
			where := &db.Where{}
			where.Add("id = ANY (?)", collect(func(r Route) string { return r.Location }))
			locations, err := queryLocations(ctx, m.app.DB, where)
			if err != nil {
				return err
			}
			byID := map[string]Location{}
			for _, l := range locations {
				byID[l.ID] = l
			}
			for i, route := range items {
				if l, ok := byID[route.Location]; ok {
					set(i, "location", l)
				}
			}
		case "wall":
			where := &db.Where{}
			where.Add("id = ANY (?)", collect(func(r Route) string { return r.Wall }))
			walls, err := queryWalls(ctx, m.app.DB, where)
			if err != nil {
				return err
			}
			byID := map[string]Wall{}
			for _, w := range walls {
				byID[w.ID] = w
			}
			for i, route := range items {
				if w, ok := byID[route.Wall]; ok {
					set(i, "wall", w)
				}
			}
		case "gym":
			gyms, err := gymRefs(ctx, m.app.DB, collect(func(r Route) string { return r.Gym }))
			if err != nil {
				return err
			}
			for i, route := range items {
				set(i, "gym", gyms[route.Gym])
			}
		default:
			return httpx.Invalid("include", "Unknown include "+relation+".")
		}
	}
	return nil
}

const maxIDs = 200

func idList(r *http.Request) ([]string, error) {
	list := strings.Split(r.URL.Query().Get("ids"), ",")
	if list[0] == "" || len(list) > maxIDs {
		return nil, httpx.Invalid("ids", "Pass 1 to 200 comma-separated ids.")
	}
	return list, nil
}

func (m *module) listRoutesByID(w http.ResponseWriter, r *http.Request) error {
	list, err := idList(r)
	if err != nil {
		return err
	}
	where := &db.Where{}
	where.Add("id = ANY (?)", list)
	where.Add("gym_visible(gym, ?)", auth.UserID(r.Context()))
	items, err := queryRoutes(r.Context(), m.app.DB, where, " ORDER BY created DESC, id")
	if err != nil {
		return err
	}
	if err := m.expand(r.Context(), items, r.URL.Query().Get("include")); err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, map[string]any{"items": items}, nil)
}

func (m *module) listWallsByID(w http.ResponseWriter, r *http.Request) error {
	list, err := idList(r)
	if err != nil {
		return err
	}
	walls, err := wallsWithLocation(r.Context(), m.app.DB, list, auth.UserID(r.Context()))
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, map[string]any{"items": walls}, nil)
}

func (m *module) getRoute(w http.ResponseWriter, r *http.Request) error {
	route, err := findRoute(r.Context(), m.app.DB, r.PathValue("id"))
	if err != nil {
		return err
	}
	if err := tenancy.RequireGym(r.Context(), m.app.DB, route.Gym); err != nil {
		return err
	}
	route.SendsCount = new(int)
	if err := m.app.DB.QueryRow(r.Context(), `SELECT COUNT(DISTINCT "user") FROM ticks WHERE route = $1 AND type <> 'attempt'`, route.ID).Scan(route.SendsCount); err != nil {
		return err
	}
	items := []Route{route}
	if err := m.expand(r.Context(), items, r.URL.Query().Get("include")); err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, items[0], nil)
}

func (m *module) postRoute(w http.ResponseWriter, r *http.Request) error {
	return m.createInGym(w, r, func(ctx context.Context, gym string, p patch) (any, error) { return m.createRoute(ctx, gym, p) })
}

func (m *module) patchRoute(w http.ResponseWriter, r *http.Request) error {
	return m.patchByID(w, r, func(ctx context.Context, id string, p patch) (any, error) { return m.updateRoute(ctx, id, p) })
}

type archiveBody struct {
	IDs      []string `json:"ids"`
	Archived *bool    `json:"archived"`
}

func (b archiveBody) archived() bool { return b.Archived == nil || *b.Archived }

func decodeOptional(r *http.Request, v any) error {
	if r.ContentLength == 0 {
		return nil
	}
	return httpx.Decode(r, v)
}

func (m *module) archiveRoute(w http.ResponseWriter, r *http.Request) error {
	var body archiveBody
	if err := decodeOptional(r, &body); err != nil {
		return err
	}
	route, err := findRoute(r.Context(), m.app.DB, r.PathValue("id"))
	if err != nil {
		return err
	}
	routes, err := m.archiveRoutes(r.Context(), route.Gym, []string{route.ID}, body.archived())
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, routes[0], nil)
}

func (m *module) archiveGymRoutes(w http.ResponseWriter, r *http.Request) error {
	gym, err := tenancy.ResolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	var body archiveBody
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	routes, err := m.archiveRoutes(r.Context(), gym, body.IDs, body.archived())
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, map[string]any{"items": routes}, nil)
}

func (m *module) deleteRouteHandler(w http.ResponseWriter, r *http.Request) error {
	return httpx.NoContent(w, m.deleteRoute(r.Context(), r.PathValue("id"), r.URL.Query().Get("force") == "true"))
}

func (m *module) listColors(w http.ResponseWriter, r *http.Request) error {
	gym, err := tenancy.ResolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	colors, err := usedColors(r.Context(), m.app.DB, gym)
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, map[string]any{"items": colors}, nil)
}

func (m *module) putPlacements(w http.ResponseWriter, r *http.Request) error {
	gym, err := tenancy.ResolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	var body struct {
		Placements []placement `json:"placements"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	routes, err := m.placeRoutes(r.Context(), gym, body.Placements)
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, map[string]any{"items": routes}, nil)
}

func (m *module) listLocations(w http.ResponseWriter, r *http.Request) error {
	gym, err := tenancy.ResolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	where := &db.Where{}
	where.Add("gym = ?", gym)
	locations, err := queryLocations(r.Context(), m.app.DB, where)
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, map[string]any{"items": locations}, nil)
}

func (m *module) postLocation(w http.ResponseWriter, r *http.Request) error {
	return m.createInGym(w, r, func(ctx context.Context, gym string, p patch) (any, error) { return m.createLocation(ctx, gym, p) })
}

func (m *module) patchLocation(w http.ResponseWriter, r *http.Request) error {
	return m.patchByID(w, r, func(ctx context.Context, id string, p patch) (any, error) { return m.updateLocation(ctx, id, p) })
}

func (m *module) deleteLocationHandler(w http.ResponseWriter, r *http.Request) error {
	return httpx.NoContent(w, m.deleteLocation(r.Context(), r.PathValue("id")))
}

func (m *module) putFloorPlan(w http.ResponseWriter, r *http.Request) error {
	var body floorPlan
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	result, err := m.saveFloorPlan(r.Context(), r.PathValue("id"), body)
	return httpx.Respond(w, http.StatusOK, result, err)
}

var traceTypes = map[string]string{".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml"}

var unsafeFileChars = regexp.MustCompile(`[^a-z0-9_]+`)

func (m *module) putMapTrace(w http.ResponseWriter, r *http.Request) error {
	location, err := m.editableLocation(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxTraceSize+1<<20)
	file, header, err := r.FormFile("map_trace")
	if err != nil {
		return httpx.Required("map_trace")
	}
	defer file.Close()
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if _, ok := traceTypes[ext]; !ok || header.Size > maxTraceSize || !traceContentMatches(file, ext) {
		return httpx.Invalid("map_trace", "Upload a JPEG, PNG, WebP or SVG image up to 10 MB.")
	}
	base := unsafeFileChars.ReplaceAllString(strings.ToLower(strings.TrimSuffix(header.Filename, filepath.Ext(header.Filename))), "_")
	name := strings.Trim(base[:min(len(base), 50)], "_") + "_" + ids.New()[:10] + ext
	if m.app.Blob != nil {
		if err := m.app.Blob.Put(r.Context(), traceKey(location.ID, name), file); err != nil {
			return err
		}
	}
	updated, err := m.replaceMapTrace(r.Context(), location, name)
	return httpx.Respond(w, http.StatusOK, updated, err)
}

func traceContentMatches(file io.ReadSeeker, ext string) bool {
	head := make([]byte, 512)
	n, _ := io.ReadFull(file, head)
	file.Seek(0, io.SeekStart)
	if ext == ".svg" {
		return strings.Contains(strings.ToLower(string(head[:n])), "<svg")
	}
	return http.DetectContentType(head[:n]) == traceTypes[ext]
}

func (m *module) deleteMapTrace(w http.ResponseWriter, r *http.Request) error {
	location, err := m.editableLocation(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	updated, err := m.replaceMapTrace(r.Context(), location, "")
	return httpx.Respond(w, http.StatusOK, updated, err)
}

func (m *module) replaceMapTrace(ctx context.Context, location Location, file string) (Location, error) {
	var updated Location
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		var err error
		if location, err = lockLocation(ctx, tx, location.ID); err != nil {
			return err
		}
		if err := setMapTrace(ctx, tx, location.ID, file); err != nil {
			return err
		}
		if updated, err = findLocation(ctx, tx, location.ID); err != nil {
			return err
		}
		return publishUpdate(ctx, tx, updated.Gym, "locations", location, updated)
	})
	if err == nil && location.MapTrace != "" && m.app.Blob != nil {
		m.app.Blob.Delete(ctx, traceKey(location.ID, location.MapTrace))
	}
	return updated, err
}

func (m *module) listWalls(w http.ResponseWriter, r *http.Request) error {
	gym, err := tenancy.ResolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	where := &db.Where{}
	where.Add("gym = ?", gym)
	if location := r.URL.Query().Get("location"); location != "" {
		where.Add("location = ?", location)
	}
	walls, err := queryWalls(r.Context(), m.app.DB, where)
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, map[string]any{"items": walls}, nil)
}

func (m *module) postWall(w http.ResponseWriter, r *http.Request) error {
	return m.createInGym(w, r, func(ctx context.Context, gym string, p patch) (any, error) { return m.createWall(ctx, gym, p) })
}

func (m *module) patchWall(w http.ResponseWriter, r *http.Request) error {
	return m.patchByID(w, r, func(ctx context.Context, id string, p patch) (any, error) { return m.updateWall(ctx, id, p) })
}

func (m *module) deleteWallHandler(w http.ResponseWriter, r *http.Request) error {
	return httpx.NoContent(w, m.deleteWall(r.Context(), r.PathValue("id")))
}

func (m *module) createInGym(w http.ResponseWriter, r *http.Request, create func(context.Context, string, patch) (any, error)) error {
	gym, err := tenancy.ResolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	var body patch
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	record, err := create(r.Context(), gym, body)
	return httpx.Respond(w, http.StatusCreated, record, err)
}

func (m *module) patchByID(w http.ResponseWriter, r *http.Request, update func(context.Context, string, patch) (any, error)) error {
	var body patch
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	record, err := update(r.Context(), r.PathValue("id"), body)
	return httpx.Respond(w, http.StatusOK, record, err)
}
