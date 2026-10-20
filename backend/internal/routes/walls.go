package routes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/climbers"
	"gripello/internal/platform/db"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/tenancy"
)

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

func checkWall(ctx context.Context, q db.Querier, gym string, isNew bool, in *wallInput) error {
	in.Name = strings.TrimSpace(in.Name)
	if httpx.Blank(in.Name) {
		return httpx.Required("name")
	}
	if err := httpx.TooLong("name", in.Name, 100); err != nil {
		return err
	}
	if in.Location == "" {
		return httpx.Required("location")
	}
	location, err := findLocation(ctx, q, in.Location)
	if err != nil {
		return notFoundAs(err, "Unknown location.")
	}
	if location.Gym != gym {
		if isNew {
			return httpx.BadRequest("The location belongs to another gym.")
		}
		return tenancy.ErrGymMove
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
	where := &db.Where{}
	where.Add("wall = ?", wall.ID)
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

func (m *module) removeWall(ctx context.Context, tx pgx.Tx, id string) error {
	if err := lockWallRoutes(ctx, tx, id); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `SELECT 1 FROM walls WHERE id = $1 FOR UPDATE`, id); err != nil {
		return err
	}
	wall, err := findWall(ctx, tx, id)
	if err != nil {
		return err
	}
	active, err := count(ctx, tx, `SELECT COUNT(*) FROM routes WHERE wall = $1 AND NOT archived`, wall.ID)
	if err != nil {
		return err
	}
	if active > 0 {
		return httpx.BadRequest("Wall still has routes.").Field("routes", "validation_wall_has_routes", "Wall still has routes.")
	}
	if err := climbers.UnfollowWalls(ctx, tx, auth.UserID(ctx), []string{wall.ID}); err != nil {
		return err
	}
	if err := deleteRow(ctx, tx, "walls", wall.ID); err != nil {
		return err
	}
	return publishGymChange(ctx, tx, wall.Gym, "walls", "delete", wall)
}

func (m *module) createWall(ctx context.Context, gym string, p patch) (Wall, error) {
	if err := m.perms.Require(ctx, gym, tenancy.PermManageSettings); err != nil {
		return Wall{}, err
	}
	if err := tenancy.RejectGymMove(p, gym); err != nil {
		return Wall{}, httpx.BadRequest("The location belongs to another gym.")
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
	return wall, m.perms.Require(ctx, wall.Gym, tenancy.PermManageSettings)
}

func (m *module) updateWall(ctx context.Context, id string, p patch) (Wall, error) {
	original, err := m.editableWall(ctx, id)
	if err != nil {
		return Wall{}, err
	}
	if err := tenancy.RejectGymMove(p, original.Gym); err != nil {
		return Wall{}, err
	}
	var wall Wall
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if err := lockWallRoutes(ctx, tx, id); err != nil {
			return err
		}
		if original, err = lockWall(ctx, tx, id); err != nil {
			return err
		}
		in := inputOfWall(original)
		if err := in.apply(p); err != nil {
			return err
		}
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
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error { return m.removeWall(ctx, tx, wall.ID) })
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

// atIndex re-keys a validation error as walls.{i}.{field} so the editor can mark the wall that failed.
func atIndex(list string, index int, err error) error {
	var failure *httpx.Error
	if !errors.As(err, &failure) {
		return err
	}
	keyed := httpx.NewError(failure.Status, failure.Message)
	prefix := fmt.Sprintf("%s.%d", list, index)
	if len(failure.Data) == 0 {
		keyed.Field(prefix, "validation_invalid_value", failure.Message)
	}
	for field, fieldError := range failure.Data {
		keyed.Data[prefix+"."+field] = fieldError
	}
	return keyed
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
		if original, err = lockLocation(ctx, tx, id); err != nil {
			return err
		}
		in := locationInput{Name: original.Name, MapArea: original.MapArea, Map: plan.Map}
		if result.Location, err = m.saveLocation(ctx, tx, original, in); err != nil {
			return err
		}
		for index, wallID := range plan.Removed {
			wall, err := findWall(ctx, tx, wallID)
			if err != nil || wall.Location != id {
				return httpx.ErrNotFound
			}
			if err := m.removeWall(ctx, tx, wall.ID); err != nil {
				return atIndex("removed", index, err)
			}
		}
		existing := map[string]Wall{}
		renamed := []string{}
		for _, in := range plan.Walls {
			if in.ID == "" {
				continue
			}
			wall, err := lockWall(ctx, tx, in.ID)
			if err != nil || wall.Location != id {
				return httpx.ErrNotFound
			}
			existing[in.ID] = wall
			if !strings.EqualFold(strings.TrimSpace(in.Name), wall.Name) {
				renamed = append(renamed, wall.ID)
			}
		}
		// Renamed walls step aside first, so a batch may swap two names without hitting the unique index.
		if len(renamed) > 0 {
			if _, err := tx.Exec(ctx, `UPDATE walls SET name = '~' || id WHERE id = ANY($1)`, renamed); err != nil {
				return err
			}
		}
		for index, in := range plan.Walls {
			in.Location = id
			var wall Wall
			if in.ID == "" {
				wall, err = m.insertWall(ctx, tx, original.Gym, in)
			} else {
				wall, err = m.saveWall(ctx, tx, existing[in.ID], in)
			}
			if err != nil {
				return atIndex("walls", index, err)
			}
			result.Walls = append(result.Walls, wall)
		}
		return nil
	})
	return result, err
}
