package routes

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/tenancy"
)

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
	if httpx.Blank(in.Name) {
		return httpx.Required("name")
	}
	if err := httpx.TooLong("name", in.Name, 100); err != nil {
		return err
	}
	_, err := parseGymMap(in.Map)
	return err
}

func (m *module) createLocation(ctx context.Context, gym string, p patch) (Location, error) {
	if err := m.perms.Require(ctx, gym, tenancy.PermManageSettings); err != nil {
		return Location{}, err
	}
	if err := tenancy.RejectGymMove(p, gym); err != nil {
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
	return location, m.perms.Require(ctx, location.Gym, tenancy.PermManageSettings)
}

func (m *module) updateLocation(ctx context.Context, id string, p patch) (Location, error) {
	original, err := m.editableLocation(ctx, id)
	if err != nil {
		return Location{}, err
	}
	if err := tenancy.RejectGymMove(p, original.Gym); err != nil {
		return Location{}, err
	}
	var location Location
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if original, err = lockLocation(ctx, tx, id); err != nil {
			return err
		}
		in := locationInput{Name: original.Name, MapArea: original.MapArea, Map: original.Map}
		if err := in.apply(p); err != nil {
			return err
		}
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
		if _, err := tx.Exec(ctx, `SELECT 1 FROM locations WHERE id = $1 FOR UPDATE`, id); err != nil {
			return err
		}
		routes, err := count(ctx, tx, `SELECT COUNT(*) FROM routes WHERE location = $1`, id)
		if err != nil {
			return err
		}
		if routes > 0 {
			return httpx.BadRequest("Location is still used by routes.")
		}
		walls, err := count(ctx, tx, `SELECT COUNT(*) FROM walls WHERE location = $1`, id)
		if err != nil {
			return err
		}
		if walls > 0 {
			return httpx.BadRequest("Location still has walls.")
		}
		competitions, err := count(ctx, tx, `SELECT COUNT(*) FROM competitions WHERE location = $1`, id)
		if err != nil {
			return err
		}
		if competitions > 0 {
			return httpx.BadRequest("Location is still used by competitions.")
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
