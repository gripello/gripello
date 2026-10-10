package routes

import (
	"context"
	"io"
	"net/http"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
)

const (
	defaultPageSize = 50
	maxPageSize     = 1000
	maxTraceSize    = 10 << 20
	maxPage         = 1_000_000
)

type routePage struct {
	Items []Route `json:"items"`
	Page  int     `json:"page"`
	Limit int     `json:"limit"`
	Total *int    `json:"total,omitempty"`
}

var routeSorts = map[string]string{
	"name": "name", "created": "created", "updated": "updated", "screw_date": "screw_date",
	"average_rating": "average_rating", "ratings_count": "ratings_count", "grade_index": "grade_index",
	"type": "type", "anchor_point": "anchor_point", "comment": "comment", "creator": "creator::text",
	"color": "color", "archived_at": "archived_at", "wall_position": "wall_position",
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
			return "", invalid("sort", "Unknown sort key "+key+".")
		}
		parts = append(parts, column+" "+direction+" NULLS LAST")
	}
	return " ORDER BY " + strings.Join(parts, ", ") + ", id", nil
}

func routeFilter(gym string, query map[string][]string) (*conditions, error) {
	get := func(key string) string {
		if values := query[key]; len(values) > 0 {
			return values[0]
		}
		return ""
	}
	where := &conditions{}
	where.add("gym = ?", gym)
	switch get("archived") {
	case "", "false":
		where.add("archived = ?", false)
	case "true":
		where.add("archived = ?", true)
	case "all":
	default:
		return nil, invalid("archived", "archived must be true, false or all.")
	}
	if location := get("location"); location != "" {
		where.add("location = ?", location)
	}
	switch wall := get("wall"); wall {
	case "":
	case "none":
		where.clauses = append(where.clauses, "wall IS NULL")
	case "any":
		where.clauses = append(where.clauses, "wall IS NOT NULL")
	default:
		where.add("wall = ?", wall)
	}
	for _, key := range []string{"type", "color", "grade_system"} {
		if value := get(key); value != "" {
			where.add(key+" = ?", value)
		}
	}
	if grades := query["grade"]; len(grades) > 0 {
		where.add("grade = ANY (?)", grades)
	}
	if q := strings.TrimSpace(get("q")); q != "" {
		pattern := "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(q) + "%"
		placeholder := where.next(pattern)
		where.clauses = append(where.clauses, "(name ILIKE "+placeholder+" OR creator::text ILIKE "+placeholder+")")
	}
	if since := get("since"); since != "" {
		at, ok := parseTime(since)
		if !ok || at == nil {
			return nil, invalid("since", "Invalid date.")
		}
		where.add("created >= ?", *at)
	}
	if list := get("ids"); list != "" {
		where.add("id = ANY (?)", strings.Split(list, ","))
	}
	return where, nil
}

func (m *module) listRoutes(w http.ResponseWriter, r *http.Request) error {
	gym, err := resolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
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
	page := min(maxPage, max(1, atoi(query.Get("page"), 1)))
	limit := min(maxPageSize, max(1, atoi(query.Get("limit"), defaultPageSize)))
	tail := order + " LIMIT " + strconv.Itoa(limit) + " OFFSET " + strconv.Itoa((page-1)*limit)
	items, err := queryRoutes(r.Context(), m.app.DB, where, tail)
	if err != nil {
		return err
	}
	if err := m.expand(r.Context(), items, query.Get("include")); err != nil {
		return err
	}
	result := routePage{Items: items, Page: page, Limit: limit}
	if query.Get("total") == "true" {
		total, err := countRoutes(r.Context(), m.app.DB, where)
		if err != nil {
			return err
		}
		result.Total = &total
	}
	httpx.JSON(w, http.StatusOK, result)
	return nil
}

func atoi(value string, fallback int) int {
	if n, err := strconv.Atoi(value); err == nil {
		return n
	}
	return fallback
}

// expand fills `expand` like PocketBase did, so `route.expand.location.name` keeps working.
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
			where := &conditions{}
			where.add("id = ANY (?)", collect(func(r Route) string { return r.Location }))
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
			where := &conditions{}
			where.add("id = ANY (?)", collect(func(r Route) string { return r.Wall }))
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
			return invalid("include", "Unknown include "+relation+".")
		}
	}
	return nil
}

const maxIDs = 200

func idList(r *http.Request) ([]string, error) {
	list := strings.Split(r.URL.Query().Get("ids"), ",")
	if list[0] == "" || len(list) > maxIDs {
		return nil, invalid("ids", "Pass 1 to 200 comma-separated ids.")
	}
	return list, nil
}

func (m *module) listRoutesByID(w http.ResponseWriter, r *http.Request) error {
	list, err := idList(r)
	if err != nil {
		return err
	}
	where := &conditions{}
	where.add("id = ANY (?)", list)
	items, err := queryRoutes(r.Context(), m.app.DB, where, " ORDER BY created DESC, id")
	if err != nil {
		return err
	}
	if err := m.expand(r.Context(), items, r.URL.Query().Get("include")); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	return nil
}

func (m *module) listWallsByID(w http.ResponseWriter, r *http.Request) error {
	list, err := idList(r)
	if err != nil {
		return err
	}
	walls, err := wallsWithLocation(r.Context(), m.app.DB, list)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": walls})
	return nil
}

func (m *module) getRoute(w http.ResponseWriter, r *http.Request) error {
	route, err := findRoute(r.Context(), m.app.DB, r.PathValue("id"))
	if err != nil {
		return err
	}
	items := []Route{route}
	if err := m.expand(r.Context(), items, r.URL.Query().Get("include")); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, items[0])
	return nil
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
	httpx.JSON(w, http.StatusOK, routes[0])
	return nil
}

func (m *module) archiveGymRoutes(w http.ResponseWriter, r *http.Request) error {
	gym, err := resolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
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
	httpx.JSON(w, http.StatusOK, map[string]any{"items": routes})
	return nil
}

func (m *module) deleteRouteHandler(w http.ResponseWriter, r *http.Request) error {
	if err := m.deleteRoute(r.Context(), r.PathValue("id"), r.URL.Query().Get("force") == "true"); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (m *module) listColors(w http.ResponseWriter, r *http.Request) error {
	gym, err := resolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	colors, err := usedColors(r.Context(), m.app.DB, gym)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": colors})
	return nil
}

func (m *module) putPlacements(w http.ResponseWriter, r *http.Request) error {
	gym, err := resolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
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
	httpx.JSON(w, http.StatusOK, map[string]any{"items": routes})
	return nil
}

func (m *module) listLocations(w http.ResponseWriter, r *http.Request) error {
	gym, err := resolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	where := &conditions{}
	where.add("gym = ?", gym)
	locations, err := queryLocations(r.Context(), m.app.DB, where)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": locations})
	return nil
}

func (m *module) postLocation(w http.ResponseWriter, r *http.Request) error {
	return m.createInGym(w, r, func(ctx context.Context, gym string, p patch) (any, error) { return m.createLocation(ctx, gym, p) })
}

func (m *module) patchLocation(w http.ResponseWriter, r *http.Request) error {
	return m.patchByID(w, r, func(ctx context.Context, id string, p patch) (any, error) { return m.updateLocation(ctx, id, p) })
}

func (m *module) deleteLocationHandler(w http.ResponseWriter, r *http.Request) error {
	if err := m.deleteLocation(r.Context(), r.PathValue("id")); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (m *module) putFloorPlan(w http.ResponseWriter, r *http.Request) error {
	var body floorPlan
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	result, err := m.saveFloorPlan(r.Context(), r.PathValue("id"), body)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, result)
	return nil
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
		return required("map_trace")
	}
	defer file.Close()
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if _, ok := traceTypes[ext]; !ok || header.Size > maxTraceSize || !traceContentMatches(file, ext) {
		return invalid("map_trace", "Upload a JPEG, PNG, WebP or SVG image up to 10 MB.")
	}
	base := unsafeFileChars.ReplaceAllString(strings.ToLower(strings.TrimSuffix(header.Filename, filepath.Ext(header.Filename))), "_")
	name := strings.Trim(base[:min(len(base), 50)], "_") + "_" + ids.New()[:10] + ext
	if m.app.Blob != nil {
		if err := m.app.Blob.Put(r.Context(), traceKey(location.ID, name), file); err != nil {
			return err
		}
	}
	updated, err := m.replaceMapTrace(r.Context(), location, name)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, updated)
	return nil
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
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, updated)
	return nil
}

func (m *module) replaceMapTrace(ctx context.Context, location Location, file string) (Location, error) {
	var updated Location
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if err := setMapTrace(ctx, tx, location.ID, file); err != nil {
			return err
		}
		var err error
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
	gym, err := resolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	where := &conditions{}
	where.add("gym = ?", gym)
	if location := r.URL.Query().Get("location"); location != "" {
		where.add("location = ?", location)
	}
	walls, err := queryWalls(r.Context(), m.app.DB, where)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": walls})
	return nil
}

func (m *module) postWall(w http.ResponseWriter, r *http.Request) error {
	return m.createInGym(w, r, func(ctx context.Context, gym string, p patch) (any, error) { return m.createWall(ctx, gym, p) })
}

func (m *module) patchWall(w http.ResponseWriter, r *http.Request) error {
	return m.patchByID(w, r, func(ctx context.Context, id string, p patch) (any, error) { return m.updateWall(ctx, id, p) })
}

func (m *module) deleteWallHandler(w http.ResponseWriter, r *http.Request) error {
	if err := m.deleteWall(r.Context(), r.PathValue("id")); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (m *module) createInGym(w http.ResponseWriter, r *http.Request, create func(context.Context, string, patch) (any, error)) error {
	gym, err := resolveGym(r.Context(), m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	var body patch
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	record, err := create(r.Context(), gym, body)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, record)
	return nil
}

func (m *module) patchByID(w http.ResponseWriter, r *http.Request, update func(context.Context, string, patch) (any, error)) error {
	var body patch
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	record, err := update(r.Context(), r.PathValue("id"), body)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, record)
	return nil
}
