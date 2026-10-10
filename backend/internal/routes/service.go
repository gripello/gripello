package routes

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
)

type patch map[string]json.RawMessage

func (p patch) decode(field string, target any) error {
	raw, ok := p[field]
	if !ok {
		return nil
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return invalid(field, "Invalid value.")
	}
	return nil
}

func (p patch) decodeAll(targets map[string]any) error {
	for field, target := range targets {
		if err := p.decode(field, target); err != nil {
			return err
		}
	}
	return nil
}

func (p patch) rejectGymMove(current string) error {
	var gym string
	if err := p.decode("gym", &gym); err != nil {
		return err
	}
	if _, ok := p["gym"]; ok && gym != current {
		return errGymMove
	}
	return nil
}

var errGymMove = httpx.NewError(400, "Records cannot move to another gym.")

func invalid(field, message string) *httpx.Error {
	return httpx.NewError(400, message).Field(field, "validation_invalid_value", message)
}

func required(field string) *httpx.Error {
	return httpx.NewError(400, "Failed to save record.").Field(field, "validation_required", "Cannot be blank.")
}

func notFoundAs(err error, message string) error {
	if errors.Is(err, httpx.ErrNotFound) {
		return httpx.NewError(400, message)
	}
	return err
}

type routeInput struct {
	Name         string
	AnchorPoint  int
	Type         string
	Comment      string
	Creator      json.RawMessage
	Archived     bool
	Color        string
	ScrewDate    *time.Time
	Location     string
	Wall         string
	WallPosition float64
	Grade        string
	GradeSystem  string
	GradeIndex   float64
	Permanent    bool
}

func inputOf(r Route) routeInput {
	in := routeInput{
		Name: r.Name, AnchorPoint: r.AnchorPoint, Type: r.Type, Comment: r.Comment, Creator: r.Creator,
		Archived: r.Archived, Color: r.Color, Location: r.Location, Wall: r.Wall, WallPosition: r.WallPosition,
		Grade: r.Grade, GradeSystem: r.GradeSystem, GradeIndex: r.GradeIndex, Permanent: r.Permanent, ScrewDate: r.ScrewDate,
	}
	return in
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func (in *routeInput) apply(p patch) error {
	var screwDate *string
	err := p.decodeAll(map[string]any{
		"name": &in.Name, "anchor_point": &in.AnchorPoint, "type": &in.Type, "comment": &in.Comment,
		"creator": &in.Creator, "archived": &in.Archived, "color": &in.Color, "screw_date": &screwDate,
		"location": &in.Location, "wall": &in.Wall, "wall_position": &in.WallPosition, "grade": &in.Grade,
		"grade_system": &in.GradeSystem, "grade_index": &in.GradeIndex, "permanent": &in.Permanent,
	})
	if err != nil {
		return err
	}
	if _, ok := p["screw_date"]; ok {
		date, ok := parseTime(deref(screwDate))
		if !ok {
			return invalid("screw_date", "Invalid date.")
		}
		in.ScrewDate = date
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return required("name")
	}
	if strings.TrimSpace(in.Grade) == "" {
		return required("grade")
	}
	for field, limit := range map[string]struct {
		value string
		max   int
	}{"name": {in.Name, 100}, "comment": {in.Comment, 2000}, "grade": {in.Grade, 20}, "grade_system": {in.GradeSystem, 30}, "color": {in.Color, 50}} {
		if err := tooLong(field, limit.value, limit.max); err != nil {
			return err
		}
	}
	if !slices.Contains([]string{"", "Route", "Boulder"}, in.Type) {
		return invalid("type", "Invalid route type.")
	}
	var creators []string
	if len(in.Creator) == 0 || string(in.Creator) == "null" {
		in.Creator = json.RawMessage("[]")
	} else if json.Unmarshal(in.Creator, &creators) != nil {
		return invalid("creator", "Creators must be a list of names.")
	}
	if len(creators) > 20 || slices.ContainsFunc(creators, func(name string) bool { return utf8.RuneCountInString(name) > 100 }) {
		return invalid("creator", "Up to 20 names of at most 100 characters.")
	}
	return nil
}

func tooLong(field, value string, limit int) error {
	if utf8.RuneCountInString(value) > limit {
		return invalid(field, "Must be no more than "+strconv.Itoa(limit)+" characters.")
	}
	return nil
}

// refuseWhileHidden keeps moderation's hide in force: only a restore brings the hidden fields back.
func refuseWhileHidden(ctx context.Context, q querier, original Route, in routeInput) error {
	if in.Name == original.Name && in.Comment == original.Comment && in.Archived == original.Archived {
		return nil
	}
	var hidden bool
	if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM moderation_items WHERE content_type = 'route' AND content_id = $1
		AND state = 'hidden')`, original.ID).Scan(&hidden); err != nil {
		return err
	}
	if hidden {
		return httpx.NewError(http.StatusForbidden, "This route was hidden by moderation.")
	}
	return nil
}

// checkRouteParents copies the tenancy rules: the location decides the gym, and the wall must hang in that location.
func checkRouteParents(ctx context.Context, q querier, gym string, original *Route, in *routeInput) error {
	if in.Location != "" {
		location, err := findLocation(ctx, q, in.Location)
		if err != nil {
			return notFoundAs(err, "Unknown location.")
		}
		if location.Gym != gym {
			if original != nil {
				return errGymMove
			}
			return httpx.NewError(400, "The location belongs to another gym.")
		}
	}
	if in.Wall == "" {
		in.WallPosition = 0
		return nil
	}
	wall, err := findWall(ctx, q, in.Wall)
	if err != nil {
		return notFoundAs(err, "Unknown wall.")
	}
	if wall.Location != in.Location {
		if original != nil && original.Location != in.Location && original.Wall == in.Wall {
			in.Wall, in.WallPosition = "", 0
			return nil
		}
		return httpx.NewError(400, "The wall belongs to another location.")
	}
	in.WallPosition = clampUnit(in.WallPosition)
	return nil
}

func (m *module) createRoute(ctx context.Context, gym string, p patch) (Route, error) {
	if err := m.require(ctx, gym, permManageRoutes); err != nil {
		return Route{}, err
	}
	if err := p.rejectGymMove(gym); err != nil {
		return Route{}, httpx.NewError(400, "The location belongs to another gym.")
	}
	in := routeInput{}
	if err := in.apply(p); err != nil {
		return Route{}, err
	}
	var route Route
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if err := checkRouteParents(ctx, tx, gym, nil, &in); err != nil {
			return err
		}
		id := ids.New()
		if err := insertRoute(ctx, tx, id, gym, in); err != nil {
			return err
		}
		var err error
		if route, err = findRoute(ctx, tx, id); err != nil {
			return err
		}
		return publishGymChange(ctx, tx, gym, "routes", "create", route)
	})
	return route, err
}

func (m *module) saveRoute(ctx context.Context, tx pgx.Tx, original Route, in routeInput) (Route, error) {
	if err := refuseWhileHidden(ctx, tx, original, in); err != nil {
		return Route{}, err
	}
	if err := checkRouteParents(ctx, tx, original.Gym, &original, &in); err != nil {
		return Route{}, err
	}
	if err := updateRoute(ctx, tx, original.ID, in); err != nil {
		return Route{}, err
	}
	return m.afterRouteUpdate(ctx, tx, original)
}

func (m *module) afterRouteUpdate(ctx context.Context, tx pgx.Tx, original Route) (Route, error) {
	route, err := findRoute(ctx, tx, original.ID)
	if err != nil {
		return Route{}, err
	}
	if err := publishUpdate(ctx, tx, route.Gym, "routes", original, route); err != nil {
		return Route{}, err
	}
	if route.Archived && !original.Archived {
		err = publishRouteArchived(ctx, tx, route)
	}
	return route, err
}

func (m *module) updateRoute(ctx context.Context, id string, p patch) (Route, error) {
	original, err := findRoute(ctx, m.app.DB, id)
	if err != nil {
		return Route{}, err
	}
	if err := m.require(ctx, original.Gym, permManageRoutes); err != nil {
		return Route{}, err
	}
	if err := p.rejectGymMove(original.Gym); err != nil {
		return Route{}, err
	}
	in := inputOf(original)
	if err := in.apply(p); err != nil {
		return Route{}, err
	}
	var route Route
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		route, err = m.saveRoute(ctx, tx, original, in)
		return err
	})
	return route, err
}

func (m *module) archiveRoutes(ctx context.Context, gym string, routeIDs []string, archived bool) ([]Route, error) {
	if err := m.require(ctx, gym, permManageRoutes, permRunInventory); err != nil {
		return nil, err
	}
	out := []Route{}
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		for _, id := range routeIDs {
			original, err := findRoute(ctx, tx, id)
			if err != nil || original.Gym != gym {
				return httpx.ErrNotFound
			}
			in := inputOf(original)
			in.Archived = archived
			if err := refuseWhileHidden(ctx, tx, original, in); err != nil {
				return err
			}
			if err := setArchived(ctx, tx, id, archived); err != nil {
				return err
			}
			route, err := m.afterRouteUpdate(ctx, tx, original)
			if err != nil {
				return err
			}
			out = append(out, route)
		}
		return nil
	})
	return out, err
}

type placement struct {
	Route        string  `json:"route"`
	Wall         string  `json:"wall"`
	WallPosition float64 `json:"wall_position"`
}

func (m *module) placeRoutes(ctx context.Context, gym string, placements []placement) ([]Route, error) {
	if err := m.require(ctx, gym, permManageRoutes); err != nil {
		return nil, err
	}
	out := []Route{}
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		for _, placed := range placements {
			original, err := findRoute(ctx, tx, placed.Route)
			if err != nil || original.Gym != gym {
				return httpx.ErrNotFound
			}
			in := inputOf(original)
			in.Wall, in.WallPosition = placed.Wall, placed.WallPosition
			route, err := m.saveRoute(ctx, tx, original, in)
			if err != nil {
				return err
			}
			out = append(out, route)
		}
		return nil
	})
	return out, err
}

// deleteRoute refuses to take reviews, betas and competition history down with the route unless forced;
// the files of cascaded betas and tasks go once the delete has committed.
func (m *module) deleteRoute(ctx context.Context, id string, force bool) error {
	route, err := findRoute(ctx, m.app.DB, id)
	if err != nil {
		return err
	}
	if err := m.require(ctx, route.Gym, permManageRoutes); err != nil {
		return err
	}
	var files []string
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if !force {
			var used bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ratings WHERE route_id = $1)
				OR EXISTS (SELECT 1 FROM beta_videos WHERE route = $1) OR EXISTS (SELECT 1 FROM competition_routes WHERE route = $1)`,
				id).Scan(&used); err != nil {
				return err
			}
			if used {
				return httpx.NewError(http.StatusConflict, "The route has reviews, betas or competition results; archive it or delete with force.")
			}
		}
		rows, err := tx.Query(ctx, `SELECT 'beta_videos/' || id FROM beta_videos WHERE route = $1 AND file <> ''
			UNION ALL SELECT 'tasks/' || id FROM tasks WHERE route = $1 AND photo <> ''`, id)
		if err != nil {
			return err
		}
		if files, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
			return err
		}
		if err := deleteRow(ctx, tx, "routes", id); err != nil {
			return err
		}
		return publishGymChange(ctx, tx, route.Gym, "routes", "delete", route)
	})
	if err == nil && m.app.Blob != nil {
		for _, key := range files {
			m.app.Blob.Delete(ctx, key)
		}
	}
	return err
}

type locationInput struct {
	Name    string
	MapArea json.RawMessage
	Map     json.RawMessage
}

func (in *locationInput) apply(p patch) error {
	if err := p.decodeAll(map[string]any{"name": &in.Name, "map_area": &in.MapArea, "map": &in.Map}); err != nil {
		return err
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return required("name")
	}
	if err := tooLong("name", in.Name, 100); err != nil {
		return err
	}
	_, err := parseGymMap(in.Map)
	return err
}

func (m *module) createLocation(ctx context.Context, gym string, p patch) (Location, error) {
	if err := m.require(ctx, gym, permManageSettings); err != nil {
		return Location{}, err
	}
	if err := p.rejectGymMove(gym); err != nil {
		return Location{}, err
	}
	in := locationInput{}
	if err := in.apply(p); err != nil {
		return Location{}, err
	}
	var location Location
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		id := ids.New()
		if err := insertLocation(ctx, tx, id, gym, in); err != nil {
			return uniqueViolation(err)
		}
		var err error
		if location, err = findLocation(ctx, tx, id); err != nil {
			return err
		}
		return publishGymChange(ctx, tx, gym, "locations", "create", location)
	})
	return location, err
}

func (m *module) editableLocation(ctx context.Context, id string) (Location, error) {
	location, err := findLocation(ctx, m.app.DB, id)
	if err != nil {
		return Location{}, err
	}
	return location, m.require(ctx, location.Gym, permManageSettings)
}

func (m *module) updateLocation(ctx context.Context, id string, p patch) (Location, error) {
	original, err := m.editableLocation(ctx, id)
	if err != nil {
		return Location{}, err
	}
	if err := p.rejectGymMove(original.Gym); err != nil {
		return Location{}, err
	}
	in := locationInput{Name: original.Name, MapArea: original.MapArea, Map: original.Map}
	if err := in.apply(p); err != nil {
		return Location{}, err
	}
	var location Location
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		location, err = m.saveLocation(ctx, tx, original, in)
		return err
	})
	return location, err
}

func (m *module) saveLocation(ctx context.Context, tx pgx.Tx, original Location, in locationInput) (Location, error) {
	if err := updateLocation(ctx, tx, original.ID, in); err != nil {
		return Location{}, uniqueViolation(err)
	}
	location, err := findLocation(ctx, tx, original.ID)
	if err != nil {
		return Location{}, err
	}
	return location, publishUpdate(ctx, tx, location.Gym, "locations", original, location)
}

func (m *module) deleteLocation(ctx context.Context, id string) error {
	location, err := m.editableLocation(ctx, id)
	if err != nil {
		return err
	}
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		routes, err := count(ctx, tx, `SELECT COUNT(*) FROM routes WHERE location = $1`, id)
		if err != nil {
			return err
		}
		if routes > 0 {
			return httpx.NewError(400, "Location is still used by routes.")
		}
		walls, err := count(ctx, tx, `SELECT COUNT(*) FROM walls WHERE location = $1`, id)
		if err != nil {
			return err
		}
		if walls > 0 {
			return httpx.NewError(400, "Location still has walls.")
		}
		if err := deleteRow(ctx, tx, "locations", id); err != nil {
			return err
		}
		return publishGymChange(ctx, tx, location.Gym, "locations", "delete", location)
	})
	if err == nil && location.MapTrace != "" && m.app.Blob != nil {
		m.app.Blob.Delete(ctx, traceKey(id, location.MapTrace))
	}
	return err
}

func traceKey(locationID, file string) string { return "locations/" + locationID + "/" + file }

type wallInput struct {
	ID         string          `json:"id"`
	Location   string          `json:"location"`
	Name       string          `json:"name"`
	Outline    json.RawMessage `json:"outline"`
	Edge       json.RawMessage `json:"edge"`
	Label      json.RawMessage `json:"label"`
	Sort       int             `json:"sort"`
	AnchorFrom int             `json:"anchor_from"`
	AnchorTo   int             `json:"anchor_to"`
}

func (in *wallInput) apply(p patch) error {
	return p.decodeAll(map[string]any{
		"location": &in.Location, "name": &in.Name, "outline": &in.Outline, "edge": &in.Edge, "label": &in.Label,
		"sort": &in.Sort, "anchor_from": &in.AnchorFrom, "anchor_to": &in.AnchorTo,
	})
}

func inputOfWall(w Wall) wallInput {
	return wallInput{ID: w.ID, Location: w.Location, Name: w.Name, Outline: w.Outline, Edge: w.Edge, Label: w.Label,
		Sort: w.Sort, AnchorFrom: w.AnchorFrom, AnchorTo: w.AnchorTo}
}

func checkWall(ctx context.Context, q querier, gym string, isNew bool, in *wallInput) error {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return required("name")
	}
	if err := tooLong("name", in.Name, 100); err != nil {
		return err
	}
	if in.Location == "" {
		return required("location")
	}
	location, err := findLocation(ctx, q, in.Location)
	if err != nil {
		return notFoundAs(err, "Unknown location.")
	}
	if location.Gym != gym {
		if isNew {
			return httpx.NewError(400, "The location belongs to another gym.")
		}
		return errGymMove
	}
	floorPlan, err := parseGymMap(location.Map)
	if err != nil {
		return err
	}
	return validateWallShape(in, floorPlan)
}

func (m *module) insertWall(ctx context.Context, tx pgx.Tx, gym string, in wallInput) (Wall, error) {
	if err := checkWall(ctx, tx, gym, true, &in); err != nil {
		return Wall{}, err
	}
	id := ids.New()
	if err := insertWall(ctx, tx, id, gym, in); err != nil {
		return Wall{}, uniqueViolation(err)
	}
	wall, err := findWall(ctx, tx, id)
	if err != nil {
		return Wall{}, err
	}
	return wall, publishGymChange(ctx, tx, gym, "walls", "create", wall)
}

func (m *module) saveWall(ctx context.Context, tx pgx.Tx, original Wall, in wallInput) (Wall, error) {
	if err := checkWall(ctx, tx, original.Gym, false, &in); err != nil {
		return Wall{}, err
	}
	if err := updateWall(ctx, tx, original.ID, in); err != nil {
		return Wall{}, uniqueViolation(err)
	}
	wall, err := findWall(ctx, tx, original.ID)
	if err != nil {
		return Wall{}, err
	}
	if wall.Location != original.Location {
		if err := m.moveWallRoutes(ctx, tx, wall); err != nil {
			return Wall{}, err
		}
	}
	return wall, publishUpdate(ctx, tx, wall.Gym, "walls", original, wall)
}

// moveWallRoutes takes a wall's routes along to its new location.
func (m *module) moveWallRoutes(ctx context.Context, tx pgx.Tx, wall Wall) error {
	where := &conditions{}
	where.add("wall = ?", wall.ID)
	routes, err := queryRoutes(ctx, tx, where, "")
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE routes SET location = $2, updated = now() WHERE wall = $1`, wall.ID, wall.Location); err != nil {
		return err
	}
	for _, original := range routes {
		if _, err := m.afterRouteUpdate(ctx, tx, original); err != nil {
			return err
		}
	}
	return nil
}

func (m *module) removeWall(ctx context.Context, tx pgx.Tx, wall Wall) error {
	active, err := count(ctx, tx, `SELECT COUNT(*) FROM routes WHERE wall = $1 AND NOT archived`, wall.ID)
	if err != nil {
		return err
	}
	if active > 0 {
		return httpx.NewError(400, "Wall still has routes.")
	}
	if err := deleteRow(ctx, tx, "walls", wall.ID); err != nil {
		return err
	}
	return publishGymChange(ctx, tx, wall.Gym, "walls", "delete", wall)
}

func (m *module) createWall(ctx context.Context, gym string, p patch) (Wall, error) {
	if err := m.require(ctx, gym, permManageSettings); err != nil {
		return Wall{}, err
	}
	if err := p.rejectGymMove(gym); err != nil {
		return Wall{}, httpx.NewError(400, "The location belongs to another gym.")
	}
	in := wallInput{}
	if err := in.apply(p); err != nil {
		return Wall{}, err
	}
	var wall Wall
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) (err error) {
		wall, err = m.insertWall(ctx, tx, gym, in)
		return err
	})
	return wall, err
}

func (m *module) editableWall(ctx context.Context, id string) (Wall, error) {
	wall, err := findWall(ctx, m.app.DB, id)
	if err != nil {
		return Wall{}, err
	}
	return wall, m.require(ctx, wall.Gym, permManageSettings)
}

func (m *module) updateWall(ctx context.Context, id string, p patch) (Wall, error) {
	original, err := m.editableWall(ctx, id)
	if err != nil {
		return Wall{}, err
	}
	if err := p.rejectGymMove(original.Gym); err != nil {
		return Wall{}, err
	}
	in := inputOfWall(original)
	if err := in.apply(p); err != nil {
		return Wall{}, err
	}
	var wall Wall
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		wall, err = m.saveWall(ctx, tx, original, in)
		return err
	})
	return wall, err
}

func (m *module) deleteWall(ctx context.Context, id string) error {
	wall, err := m.editableWall(ctx, id)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error { return m.removeWall(ctx, tx, wall) })
}

type floorPlan struct {
	Map     json.RawMessage `json:"map"`
	Walls   []wallInput     `json:"walls"`
	Removed []string        `json:"removed"`
}

type floorPlanResult struct {
	Location Location `json:"location"`
	Walls    []Wall   `json:"walls"`
}

// saveFloorPlan replaces the map editor's batch: map, removed walls, then created/updated walls in request order.
func (m *module) saveFloorPlan(ctx context.Context, id string, plan floorPlan) (floorPlanResult, error) {
	original, err := m.editableLocation(ctx, id)
	if err != nil {
		return floorPlanResult{}, err
	}
	if _, err := parseGymMap(plan.Map); err != nil {
		return floorPlanResult{}, err
	}
	result := floorPlanResult{Walls: []Wall{}}
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		in := locationInput{Name: original.Name, MapArea: original.MapArea, Map: plan.Map}
		if result.Location, err = m.saveLocation(ctx, tx, original, in); err != nil {
			return err
		}
		for _, wallID := range plan.Removed {
			wall, err := findWall(ctx, tx, wallID)
			if err != nil || wall.Location != id {
				return httpx.ErrNotFound
			}
			if err := m.removeWall(ctx, tx, wall); err != nil {
				return err
			}
		}
		for _, in := range plan.Walls {
			in.Location = id
			var wall Wall
			if in.ID == "" {
				wall, err = m.insertWall(ctx, tx, original.Gym, in)
			} else {
				var existing Wall
				if existing, err = findWall(ctx, tx, in.ID); err != nil || existing.Location != id {
					return httpx.ErrNotFound
				}
				wall, err = m.saveWall(ctx, tx, existing, in)
			}
			if err != nil {
				return err
			}
			result.Walls = append(result.Walls, wall)
		}
		return nil
	})
	return result, err
}
