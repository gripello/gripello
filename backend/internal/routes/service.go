package routes

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/apitime"
	"gripello/internal/platform/db"
	"gripello/internal/platform/grades"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/tenancy"
)

type patch map[string]json.RawMessage

func (p patch) decode(field string, target any) error {
	raw, ok := p[field]
	if !ok {
		return nil
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return httpx.Invalid(field, "Invalid value.")
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

func notFoundAs(err error, message string) error {
	if errors.Is(err, httpx.ErrNotFound) {
		return httpx.BadRequest(message)
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
	ScrewDate    *apitime.Date
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
		date, ok := parseDay(deref(screwDate))
		if !ok {
			return httpx.Invalid("screw_date", "Must be a day as YYYY-MM-DD.")
		}
		in.ScrewDate = date
	}
	in.Name = strings.TrimSpace(in.Name)
	if httpx.Blank(in.Name) {
		return httpx.Required("name")
	}
	if httpx.Blank(in.Grade) {
		return httpx.Required("grade")
	}
	in.Grade = grades.Canonical(in.GradeSystem, in.Grade)
	for field, limit := range map[string]struct {
		value string
		max   int
	}{"name": {in.Name, 100}, "comment": {in.Comment, 2000}, "grade": {in.Grade, grades.MaxLength}, "grade_system": {in.GradeSystem, grades.MaxSystemLength}, "color": {in.Color, 50}} {
		if err := httpx.TooLong(field, limit.value, limit.max); err != nil {
			return err
		}
	}
	if in.GradeIndex < 0 || in.GradeIndex > grades.MaxIndex {
		return httpx.Invalid("grade_index", "Grade index must be between 0 and 40.")
	}
	if !slices.Contains([]string{"", "Route", "Boulder"}, in.Type) {
		return httpx.Invalid("type", "Invalid route type.")
	}
	var creators []string
	if len(in.Creator) == 0 || string(in.Creator) == "null" {
		in.Creator = json.RawMessage("[]")
	} else if json.Unmarshal(in.Creator, &creators) != nil {
		return httpx.Invalid("creator", "Creators must be a list of names.")
	}
	if len(creators) > 20 || slices.ContainsFunc(creators, func(name string) bool { return utf8.RuneCountInString(name) > 100 }) {
		return httpx.Invalid("creator", "Up to 20 names of at most 100 characters.")
	}
	return nil
}

// refuseWhileHidden keeps moderation's hide in force: only a restore brings the hidden fields back.
func refuseWhileHidden(ctx context.Context, q db.Querier, original Route, in routeInput) error {
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
func checkRouteParents(ctx context.Context, q db.Querier, gym string, original *Route, in *routeInput) error {
	if in.Location != "" {
		location, err := findLocation(ctx, q, in.Location)
		if err != nil {
			return notFoundAs(err, "Unknown location.")
		}
		if location.Gym != gym {
			if original != nil {
				return tenancy.ErrGymMove
			}
			return httpx.BadRequest("The location belongs to another gym.")
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
		return httpx.BadRequest("The wall belongs to another location.")
	}
	in.WallPosition = clampUnit(in.WallPosition)
	return nil
}

func (m *module) createRoute(ctx context.Context, gym string, p patch) (Route, error) {
	if err := m.perms.Require(ctx, gym, tenancy.PermManageRoutes); err != nil {
		return Route{}, err
	}
	if err := tenancy.RejectGymMove(p, gym); err != nil {
		return Route{}, httpx.BadRequest("The location belongs to another gym.")
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
	if err := m.perms.Require(ctx, original.Gym, tenancy.PermManageRoutes); err != nil {
		return Route{}, err
	}
	if err := tenancy.RejectGymMove(p, original.Gym); err != nil {
		return Route{}, err
	}
	var route Route
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if original, err = lockRoute(ctx, tx, id); err != nil {
			return err
		}
		in := inputOf(original)
		if err := in.apply(p); err != nil {
			return err
		}
		route, err = m.saveRoute(ctx, tx, original, in)
		return err
	})
	return route, err
}

func (m *module) archiveRoutes(ctx context.Context, gym string, routeIDs []string, archived bool) ([]Route, error) {
	if err := m.perms.Require(ctx, gym, tenancy.PermManageRoutes, tenancy.PermRunInventory); err != nil {
		return nil, err
	}
	out := []Route{}
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if err := lockRoutes(ctx, tx, routeIDs); err != nil {
			return err
		}
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
	Route        string   `json:"route"`
	Wall         string   `json:"wall"`
	WallPosition *float64 `json:"wall_position"`
}

func (m *module) placeRoutes(ctx context.Context, gym string, placements []placement) ([]Route, error) {
	if err := m.perms.Require(ctx, gym, tenancy.PermManageRoutes); err != nil {
		return nil, err
	}
	out := []Route{}
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		routeIDs := make([]string, len(placements))
		for i, placed := range placements {
			routeIDs[i] = placed.Route
		}
		if err := lockRoutes(ctx, tx, routeIDs); err != nil {
			return err
		}
		for _, placed := range placements {
			original, err := findRoute(ctx, tx, placed.Route)
			if err != nil || original.Gym != gym {
				return httpx.ErrNotFound
			}
			in := inputOf(original)
			in.Wall = placed.Wall
			if placed.WallPosition != nil {
				in.WallPosition = *placed.WallPosition
			}
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
	if err := m.perms.Require(ctx, route.Gym, tenancy.PermManageRoutes); err != nil {
		return err
	}
	var files []string
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT 1 FROM routes WHERE id = $1 FOR UPDATE`, id); err != nil {
			return err
		}
		if route, err = findRoute(ctx, tx, id); err != nil {
			return err
		}
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
