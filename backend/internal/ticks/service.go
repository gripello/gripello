package ticks

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
)

const (
	tickDateLeeway     = 36 * time.Hour
	maxAttempts        = 999
	maxNoteLength      = 500
	maxSeasonName      = 60
	permManageSeasons  = "manage_competitions"
	duplicateIDCode    = "validation_pk_invalid"
	lockedFieldMessage = "This field can't be changed."
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

func invalid(field, message string) *httpx.Error {
	return httpx.NewError(http.StatusBadRequest, message).Field(field, "validation_invalid_value", message)
}

func required(field string) *httpx.Error {
	return httpx.NewError(http.StatusBadRequest, "Failed to save record.").Field(field, "validation_required", "Cannot be blank.")
}

func tickDateInFuture(date, now time.Time) bool {
	return date.After(now.Add(tickDateLeeway))
}

// applyEditable sets type, attempts, date and note from the body and enforces the tick rules.
func (p patch) applyEditable(t *Tick) error {
	var date string
	if err := p.decode("type", &t.Type); err != nil {
		return err
	}
	if err := p.decode("attempts", &t.Attempts); err != nil {
		return err
	}
	if err := p.decode("note", &t.Note); err != nil {
		return err
	}
	if err := p.decode("date", &date); err != nil {
		return err
	}
	if _, ok := p["date"]; ok {
		parsed, ok := parseTime(date)
		if !ok {
			return required("date")
		}
		t.Date = parsed
	}
	switch t.Type {
	case "flash":
		t.Attempts = 1
	case "top", "attempt":
	case "":
		return required("type")
	default:
		return invalid("type", "Invalid type.")
	}
	if t.Attempts < 1 || t.Attempts > maxAttempts {
		return invalid("attempts", "Attempts must be between 1 and 999.")
	}
	if utf8.RuneCountInString(t.Note) > maxNoteLength {
		return invalid("note", "The note is too long.")
	}
	if t.Date.IsZero() {
		return required("date")
	}
	if tickDateInFuture(t.Date, time.Now()) {
		return httpx.NewError(http.StatusBadRequest, "An ascent can't be logged in the future.").
			Field("date", "validation_invalid_value", "An ascent can't be logged in the future.")
	}
	return nil
}

func (m *module) createTick(ctx context.Context, p patch) (Tick, error) {
	principal, err := auth.Require(ctx)
	if err != nil {
		return Tick{}, err
	}
	tick := Tick{User: principal.UserID}
	var user string
	if err := p.decode("user", &user); err != nil {
		return Tick{}, err
	}
	if user != "" && user != principal.UserID {
		return Tick{}, httpx.ErrForbidden
	}
	if err := p.decode("id", &tick.ID); err != nil {
		return Tick{}, err
	}
	if tick.ID == "" {
		tick.ID = ids.New()
	} else if !ids.Valid(tick.ID) {
		return Tick{}, invalid("id", "Invalid id.")
	}
	if err := p.decode("route", &tick.Route); err != nil {
		return Tick{}, err
	}
	if tick.Route == "" {
		return Tick{}, required("route")
	}
	if err := p.applyEditable(&tick); err != nil {
		return Tick{}, err
	}
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		route, err := findRouteSnapshot(ctx, tx, tick.Route)
		if err != nil {
			return invalid("route", "Unknown route.")
		}
		tick.Grade, tick.GradeSystem, tick.GradeIndex, tick.RouteName = route.Grade, route.GradeSystem, route.GradeIndex, route.Name
		if err := insertTick(ctx, tx, tick); err != nil {
			if isUniqueViolation(err) {
				return httpx.NewError(http.StatusBadRequest, "Failed to create record.").Field("id", duplicateIDCode, "The id is invalid or already exists.")
			}
			return err
		}
		if tick, err = findOwnTick(ctx, tx, tick.ID, tick.User); err != nil {
			return err
		}
		return publishTick(ctx, tx, "create", tick, tick.Date)
	})
	return tick, err
}

var lockedTickFields = []string{"user", "route", "grade", "grade_system", "grade_index", "route_name"}

func rejectLockedChanges(p patch, current Tick) error {
	values := map[string]any{"user": current.User, "route": current.Route, "grade": current.Grade,
		"grade_system": current.GradeSystem, "grade_index": current.GradeIndex, "route_name": current.RouteName}
	for _, field := range lockedTickFields {
		raw, ok := p[field]
		if !ok {
			continue
		}
		want, _ := json.Marshal(values[field])
		var got any
		if json.Unmarshal(raw, &got) != nil {
			return invalid(field, lockedFieldMessage)
		}
		normalized, _ := json.Marshal(got)
		if string(normalized) != string(want) {
			return invalid(field, lockedFieldMessage)
		}
	}
	return nil
}

func (m *module) updateTick(ctx context.Context, id string, p patch) (Tick, error) {
	principal, err := auth.Require(ctx)
	if err != nil {
		return Tick{}, err
	}
	original, err := findOwnTick(ctx, m.app.DB, id, principal.UserID)
	if err != nil {
		return Tick{}, err
	}
	if err := rejectLockedChanges(p, original); err != nil {
		return Tick{}, err
	}
	tick := original
	if err := p.applyEditable(&tick); err != nil {
		return Tick{}, err
	}
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if err := updateTick(ctx, tx, tick); err != nil {
			return err
		}
		if tick, err = findOwnTick(ctx, tx, id, principal.UserID); err != nil {
			return err
		}
		return publishTick(ctx, tx, "update", tick, tick.Date, original.Date)
	})
	return tick, err
}

func (m *module) deleteTick(ctx context.Context, id string) error {
	principal, err := auth.Require(ctx)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		tick, err := findOwnTick(ctx, tx, id, principal.UserID)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM ticks WHERE id = $1`, id); err != nil {
			return err
		}
		return publishTick(ctx, tx, "delete", tick, tick.Date)
	})
}

func (m *module) requireSeasonManager(ctx context.Context, gym string) error {
	principal, err := auth.Require(ctx)
	if err != nil {
		return err
	}
	if !m.perms.Can(ctx, principal.UserID, gym, permManageSeasons) {
		return httpx.ErrForbidden
	}
	return nil
}

func (p patch) applySeason(s *Season) error {
	if err := p.decode("name", &s.Name); err != nil {
		return err
	}
	for field, target := range map[string]*time.Time{"starts_at": &s.StartsAt, "ends_at": &s.EndsAt} {
		var value string
		if err := p.decode(field, &value); err != nil {
			return err
		}
		if _, ok := p[field]; ok {
			parsed, ok := parseTime(value)
			if !ok {
				return required(field)
			}
			*target = parsed
		}
	}
	switch {
	case s.Name == "":
		return required("name")
	case utf8.RuneCountInString(s.Name) > maxSeasonName:
		return invalid("name", "The name is too long.")
	case s.StartsAt.IsZero():
		return required("starts_at")
	case s.EndsAt.IsZero():
		return required("ends_at")
	case !s.EndsAt.After(s.StartsAt):
		return invalid("ends_at", "A season has to end after it starts.")
	}
	return nil
}

func (m *module) createSeason(ctx context.Context, gym string, p patch) (Season, error) {
	if err := m.requireSeasonManager(ctx, gym); err != nil {
		return Season{}, err
	}
	season := Season{Gym: gym}
	if err := p.rejectGymMove(gym); err != nil {
		return Season{}, err
	}
	if err := p.applySeason(&season); err != nil {
		return Season{}, err
	}
	id := ids.New()
	if _, err := m.app.DB.Exec(ctx, `INSERT INTO seasons (id, gym, name, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5)`,
		id, gym, season.Name, season.StartsAt, season.EndsAt); err != nil {
		return Season{}, err
	}
	return findSeason(ctx, m.app.DB, id)
}

func (m *module) updateSeason(ctx context.Context, id string, p patch) (Season, error) {
	season, err := findSeason(ctx, m.app.DB, id)
	if err != nil {
		return Season{}, err
	}
	if err := m.requireSeasonManager(ctx, season.Gym); err != nil {
		return Season{}, err
	}
	if err := p.rejectGymMove(season.Gym); err != nil {
		return Season{}, err
	}
	if err := p.applySeason(&season); err != nil {
		return Season{}, err
	}
	if _, err := m.app.DB.Exec(ctx, `UPDATE seasons SET name = $2, starts_at = $3, ends_at = $4, updated = now() WHERE id = $1`,
		id, season.Name, season.StartsAt, season.EndsAt); err != nil {
		return Season{}, err
	}
	return findSeason(ctx, m.app.DB, id)
}

func (m *module) deleteSeason(ctx context.Context, id string) error {
	season, err := findSeason(ctx, m.app.DB, id)
	if err != nil {
		return err
	}
	if err := m.requireSeasonManager(ctx, season.Gym); err != nil {
		return err
	}
	_, err = m.app.DB.Exec(ctx, `DELETE FROM seasons WHERE id = $1`, id)
	return err
}

func (p patch) rejectGymMove(current string) error {
	var gym string
	if err := p.decode("gym", &gym); err != nil {
		return err
	}
	if _, ok := p["gym"]; ok && gym != current {
		return httpx.NewError(http.StatusBadRequest, "Records cannot move to another gym.")
	}
	return nil
}
