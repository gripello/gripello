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
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
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

func checkWall(in *wallInput, floorPlan *gymMap) error {
	in.Name = strings.TrimSpace(in.Name)
	if httpx.Blank(in.Name) {
		return httpx.Required("name")
	}
	if err := httpx.TooLong("name", in.Name, 100); err != nil {
		return err
	}
	return validateWallShape(in, floorPlan)
}

func (m *module) insertWall(ctx context.Context, tx pgx.Tx, gym string, floorPlan *gymMap, in wallInput) (Wall, error) {
	if err := checkWall(&in, floorPlan); err != nil {
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

func (m *module) saveWall(ctx context.Context, tx pgx.Tx, original Wall, floorPlan *gymMap, in wallInput) (Wall, error) {
	if err := checkWall(&in, floorPlan); err != nil {
		return Wall{}, err
	}
	if err := updateWall(ctx, tx, original.ID, in); err != nil {
		return Wall{}, uniqueViolation(err)
	}
	wall, err := findWall(ctx, tx, original.ID)
	if err != nil {
		return Wall{}, err
	}
	return wall, publishUpdate(ctx, tx, wall.Gym, "walls", original, wall)
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
	floorMap, err := parseGymMap(plan.Map)
	if err != nil {
		return floorPlanResult{}, err
	}
	if len(plan.Walls) > maxFloorPlanWalls {
		return floorPlanResult{}, httpx.Invalid("walls", fmt.Sprintf("At most %d walls per floor plan.", maxFloorPlanWalls))
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
				wall, err = m.insertWall(ctx, tx, original.Gym, floorMap, in)
			} else {
				wall, err = m.saveWall(ctx, tx, existing[in.ID], floorMap, in)
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
