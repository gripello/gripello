package competitions

import (
	"bytes"
	"context"
	"encoding/json"
	"net/url"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/apitime"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/db"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/tenancy"
)

const (
	guardianConsentAge = 16
	judgeOnlyFormat    = "lead_height"
	maxScoringBytes    = 2000
)

var (
	competitionStatuses   = []string{"draft", "open", "closed", "published"}
	entryStatuses         = []string{"registered", "checked_in", "disqualified", "withdrawn"}
	inactiveEntryStatuses = []string{"disqualified", "withdrawn"}
	genders               = []string{"", "female", "male"}
	formatsByDiscipline   = map[string][]string{
		"boulder": {"dynamic", "fixed", "ifsc", "tops"},
		"rope":    {"route_points", "lead_height", "dynamic"},
	}
	routeTypeByDiscipline = map[string]string{"boulder": "Boulder", "rope": "Route"}
)

type viewer struct {
	user    string
	manager bool
	staff   bool
}

func (m *module) viewerOf(ctx context.Context, gym string) viewer {
	p, ok := auth.From(ctx)
	if !ok {
		return viewer{}
	}
	v := viewer{user: p.UserID, manager: m.perms.Has(ctx, gym, tenancy.PermManageCompetitions)}
	v.staff = v.manager || m.perms.Has(ctx, gym, tenancy.PermJudgeCompetitions)
	return v
}

// viewerFor: judges work on running competitions only, drafts stay with the managers.
func (m *module) viewerFor(ctx context.Context, c Competition) viewer {
	v := m.viewerOf(ctx, c.Gym)
	if c.Status == "draft" {
		v.staff = v.manager
	}
	return v
}

func visible(c Competition, v viewer) bool { return c.Status != "draft" || v.manager }

// loadVisible returns the competition unless it is a draft the caller may not manage (404).
func (m *module) loadVisible(ctx context.Context, id string) (Competition, viewer, error) {
	c, err := findVisibleCompetition(ctx, m.app.DB, id)
	if err != nil {
		return c, viewer{}, err
	}
	v := m.viewerFor(ctx, c)
	if !visible(c, v) {
		return c, v, httpx.ErrNotFound
	}
	return c, v, nil
}

func (m *module) loadManaged(ctx context.Context, id string) (Competition, error) {
	if _, err := auth.Require(ctx); err != nil {
		return Competition{}, err
	}
	c, v, err := m.loadVisible(ctx, id)
	if err != nil {
		return c, err
	}
	if !v.manager {
		return c, httpx.ErrForbidden
	}
	return c, nil
}

func stampFreezeAt(c *Competition) {
	if !c.LiveRanking || c.FreezeMinutes <= 0 || c.EndsAt.IsZero() {
		c.FreezeAt = nil
		return
	}
	at := c.EndsAt.Add(-time.Duration(c.FreezeMinutes) * time.Minute)
	c.FreezeAt = &at
}

func validateCompetitionFormat(c Competition) error {
	if !slices.Contains(formatsByDiscipline[c.Discipline], c.ScoringFormat) {
		return httpx.BadRequest("This scoring format does not fit the discipline.")
	}
	return nil
}

type scoringSettings struct {
	TopPool        *float64  `json:"topPool"`
	ZonePool       *float64  `json:"zonePool"`
	AttemptFactors []float64 `json:"attemptFactors"`
	BestOf         *float64  `json:"bestOf"`
	FlashBonus     *float64  `json:"flashBonus"`
	TopropeFactor  *float64  `json:"topropeFactor"`
}

// validateScoring accepts exactly the ScoringSettings keys of shared/utils/competitionScoring.ts (minus format).
func validateScoring(raw json.RawMessage) error {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	fail := httpx.Invalid("scoring", "Invalid scoring settings.")
	if len(raw) > maxScoringBytes {
		return fail
	}
	var s scoringSettings
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&s) != nil {
		return fail
	}
	inRange := func(v *float64, low, high float64) bool { return v == nil || (*v >= low && *v <= high) }
	ok := inRange(s.TopPool, 1, 1e6) && inRange(s.ZonePool, 0, 1e6) && inRange(s.FlashBonus, 0, 100) &&
		inRange(s.TopropeFactor, 0, 1) && (s.BestOf == nil || (*s.BestOf >= 1 && *s.BestOf == float64(int(*s.BestOf))))
	for _, factor := range s.AttemptFactors {
		ok = ok && factor >= 0 && factor <= 1
	}
	if !ok {
		return fail
	}
	return nil
}

func validateCompetition(c Competition) error {
	if httpx.Blank(c.Name) {
		return httpx.Required("name")
	}
	if err := httpx.TooLong("name", c.Name, 200); err != nil {
		return err
	}
	if err := httpx.TooLong("description", c.Description, 5000); err != nil {
		return err
	}
	if !slices.Contains(competitionStatuses, c.Status) {
		return httpx.Invalid("status", "Invalid status.")
	}
	if c.StartsAt.IsZero() {
		return httpx.Required("starts_at")
	}
	if c.EndsAt.IsZero() {
		return httpx.Required("ends_at")
	}
	if c.EndsAt.Before(c.StartsAt) {
		return httpx.Invalid("ends_at", "The end must not be before the start.")
	}
	if err := validateCompetitionFormat(c); err != nil {
		return err
	}
	if err := validateScoring(c.Scoring); err != nil {
		return err
	}
	if c.FreezeMinutes < 0 || c.FreezeMinutes > 600 {
		return httpx.Invalid("freeze_minutes", "Must be between 0 and 600.")
	}
	if c.RegistrationURL != "" {
		u, err := url.Parse(c.RegistrationURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return httpx.Invalid("registration_url", "Must be a valid url.")
		}
	}
	return httpx.TooLong("registration_url", c.RegistrationURL, 500)
}

func (m *module) checkLocation(ctx context.Context, q db.Querier, c Competition) error {
	if c.Location == "" {
		return httpx.Required("location")
	}
	gym, err := locationGym(ctx, q, c.Location)
	if err != nil {
		return httpx.Invalid("location", "Location not found.")
	}
	if gym != c.Gym {
		return httpx.BadRequest("The competition cannot belong to another gym.")
	}
	return nil
}

func (m *module) createCompetition(ctx context.Context, gym string, raw json.RawMessage) (Competition, error) {
	if err := m.perms.Require(ctx, gym, tenancy.PermManageCompetitions); err != nil {
		return Competition{}, err
	}
	c := Competition{Status: "draft"}
	if err := unmarshalBody(raw, &c); err != nil {
		return Competition{}, err
	}
	c.ID, c.Gym, c.Expand = ids.New(), gym, nil
	if err := m.checkCompetition(ctx, m.app.DB, &c); err != nil {
		return Competition{}, err
	}
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if err := insertCompetition(ctx, tx, c); err != nil {
			return err
		}
		var err error
		if c, err = findCompetition(ctx, tx, c.ID); err != nil {
			return err
		}
		return publishChange(ctx, tx, c, "competition", "", "")
	})
	return c, err
}

func (m *module) checkCompetition(ctx context.Context, q db.Querier, c *Competition) error {
	stampFreezeAt(c)
	if err := validateCompetition(*c); err != nil {
		return err
	}
	return m.checkLocation(ctx, q, *c)
}

func (m *module) updateCompetition(ctx context.Context, id string, raw json.RawMessage) (Competition, error) {
	if _, err := m.loadManaged(ctx, id); err != nil {
		return Competition{}, err
	}
	var c Competition
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		before, err := lockCompetition(ctx, tx, id, "NO KEY UPDATE")
		if err != nil {
			return err
		}
		c = before
		if err := unmarshalBody(raw, &c); err != nil {
			return err
		}
		c.ID, c.Gym, c.Created, c.Updated, c.Expand = before.ID, before.Gym, before.Created, before.Updated, nil
		if err := m.checkCompetition(ctx, tx, &c); err != nil {
			return err
		}
		if err := saveCompetition(ctx, tx, c); err != nil {
			return err
		}
		if c, err = findCompetition(ctx, tx, id); err != nil {
			return err
		}
		if before.Status != "published" && c.Status == "published" {
			if err := m.publishResults(ctx, tx, c, time.Now()); err != nil {
				return err
			}
		}
		if err := publishChange(ctx, tx, c, "competition", "", ""); err != nil {
			return err
		}
		if (before.Status == "draft") != (c.Status == "draft") {
			return publishChange(ctx, tx, before, "competition", "", "")
		}
		return nil
	})
	return c, err
}

func (m *module) deleteCompetition(ctx context.Context, id string) error {
	c, err := m.loadManaged(ctx, id)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if c, err = lockCompetition(ctx, tx, id, "UPDATE"); err != nil {
			return err
		}
		entries, err := db.List[Entry](ctx, tx, `DELETE FROM competition_entries WHERE competition = $1 RETURNING `+entryColumns, id)
		if err != nil {
			return err
		}
		for _, e := range entries {
			if err := publishEntryDeleted(ctx, tx, e, c.Gym); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `DELETE FROM competitions WHERE id = $1`, id); err != nil {
			return err
		}
		return publishChange(ctx, tx, c, "competition", "", "")
	})
}

func competitionTickType(topAttempt int) string {
	if topAttempt == 1 {
		return "flash"
	}
	return "top"
}

func competitionTickDate(endsAt, now time.Time) apitime.Date {
	if endsAt.After(now) {
		return apitime.DateOf(now)
	}
	return apitime.DateOf(endsAt)
}

// publishResults replaces the competition's ticks with every top of an active entry (skipping climbers who already logged
// the route that day) and notifies the entrants.
func (m *module) publishResults(ctx context.Context, tx pgx.Tx, c Competition, now time.Time) error {
	if err := deleteCompetitionTicks(ctx, tx, c); err != nil {
		return err
	}
	date := competitionTickDate(c.EndsAt, now)
	rows, err := tx.Query(ctx, `SELECT e."user", cr.route, s.top_attempt, r.name, r.grade, r.grade_system, r.grade_index,
			u.ticks_private
		FROM competition_scores s
		JOIN competition_entries e ON e.id = s.entry
		JOIN competition_routes cr ON cr.id = s.comp_route
		JOIN routes r ON r.id = cr.route
		JOIN users u ON u.id = e."user"
		WHERE s.competition = $1 AND s.top_attempt > 0 AND NOT cr.voided AND e.status IN ('registered', 'checked_in')
			AND NOT EXISTS (SELECT 1 FROM ticks t WHERE t."user" = e."user" AND t.route = cr.route AND t.date = $2)
		ORDER BY s.created, s.id`, c.ID, date)
	if err != nil {
		return err
	}
	type top struct {
		tick    Tick
		private bool
	}
	tops, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (top, error) {
		var t top
		var attempt int
		err := row.Scan(&t.tick.User, &t.tick.Route, &attempt, &t.tick.RouteName, &t.tick.Grade, &t.tick.GradeSystem,
			&t.tick.GradeIndex, &t.private)
		t.tick.Type, t.tick.Attempts = competitionTickType(attempt), attempt
		return t, err
	})
	if err != nil {
		return err
	}
	for _, t := range tops {
		tick := t.tick
		tick.ID, tick.Date, tick.Note = ids.New(), date, c.Name
		err := tx.QueryRow(ctx, `INSERT INTO ticks (id, "user", route, type, attempts, date, note, grade, grade_system,
			grade_index, route_name, competition) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING created, updated`,
			tick.ID, tick.User, tick.Route, tick.Type, tick.Attempts, tick.Date, tick.Note, tick.Grade, tick.GradeSystem,
			tick.GradeIndex, tick.RouteName, c.ID).Scan(&tick.Created, &tick.Updated)
		if err != nil {
			return err
		}
		if err := publishTick(ctx, tx, "create", tick, c.Gym, t.private); err != nil {
			return err
		}
	}
	userRows, err := tx.Query(ctx, `SELECT DISTINCT "user" FROM competition_entries
		WHERE competition = $1 AND status <> 'withdrawn' ORDER BY 1`, c.ID)
	if err != nil {
		return err
	}
	users, err := pgx.CollectRows(userRows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	return events.PublishNotify(ctx, tx, auth.UserID(ctx), events.Notify{Type: "competition_published", Users: users, Gym: c.Gym,
		Params: map[string]any{"competition": c.Name}, URL: tenancy.GymPath(ctx, tx, c.Gym, "/competitions/"+c.ID)})
}

func deleteCompetitionTicks(ctx context.Context, tx pgx.Tx, c Competition) error {
	rows, err := tx.Query(ctx, `DELETE FROM ticks t USING users u WHERE t.competition = $1 AND u.id = t."user"
		RETURNING t.id, t.created, t.updated, t."user", COALESCE(t.route, ''), t.type, t.attempts, t.date, t.note, t.grade, t.grade_system,
			t.grade_index, t.route_name, u.ticks_private`, c.ID)
	if err != nil {
		return err
	}
	type deleted struct {
		tick    Tick
		private bool
	}
	ticks, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (deleted, error) {
		var d deleted
		t := &d.tick
		err := row.Scan(&t.ID, &t.Created, &t.Updated, &t.User, &t.Route, &t.Type, &t.Attempts, &t.Date, &t.Note, &t.Grade,
			&t.GradeSystem, &t.GradeIndex, &t.RouteName, &d.private)
		return d, err
	})
	if err != nil {
		return err
	}
	for _, d := range ticks {
		if err := publishTick(ctx, tx, "delete", d.tick, c.Gym, d.private); err != nil {
			return err
		}
	}
	return nil
}

func validateCategory(c Category) error {
	if httpx.Blank(c.Name) {
		return httpx.Required("name")
	}
	if err := httpx.TooLong("name", c.Name, 100); err != nil {
		return err
	}
	if !slices.Contains(genders, c.Gender) {
		return httpx.Invalid("gender", "Invalid gender.")
	}
	return nil
}

func (m *module) saveCategory(ctx context.Context, competitionID, id string, raw json.RawMessage) (Category, error) {
	var before Category
	if id != "" {
		var err error
		if before, err = findCategory(ctx, m.app.DB, id); err != nil {
			return Category{}, err
		}
		competitionID = before.Competition
	}
	c, err := m.loadManaged(ctx, competitionID)
	if err != nil {
		return Category{}, err
	}
	category := before
	if err := unmarshalBody(raw, &category); err != nil {
		return Category{}, err
	}
	if id != "" && category.Competition != before.Competition {
		return Category{}, errMoved
	}
	category.ID, category.Competition = before.ID, c.ID
	if id == "" {
		category.ID = ids.New()
	}
	if err := validateCategory(category); err != nil {
		return Category{}, err
	}
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if err := saveCategory(ctx, tx, category, id == ""); err != nil {
			return err
		}
		if category, err = findCategory(ctx, tx, category.ID); err != nil {
			return err
		}
		return publishChange(ctx, tx, c, "categories", "", "")
	})
	return category, err
}

var errMoved = httpx.BadRequest("Records cannot move to another competition.")

func (m *module) deleteCategory(ctx context.Context, id string) error {
	category, err := findCategory(ctx, m.app.DB, id)
	if err != nil {
		return err
	}
	c, err := m.loadManaged(ctx, category.Competition)
	if err != nil {
		return err
	}
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM competition_categories WHERE id = $1`, id); err != nil {
			return err
		}
		return publishChange(ctx, tx, c, "categories", "", "")
	})
	if db.IsFKViolation(err) {
		return httpx.BadRequest("This category still has entries.")
	}
	return err
}

func (m *module) validateCompRoute(ctx context.Context, c Competition, r *CompRoute) error {
	var gym, routeType string
	err := m.app.DB.QueryRow(ctx, `SELECT gym, type FROM routes WHERE id = $1`, r.Route).Scan(&gym, &routeType)
	if err != nil || routeType != routeTypeByDiscipline[c.Discipline] {
		return httpx.Invalid("route", "This route does not fit the discipline.")
	}
	if gym != c.Gym {
		return httpx.Invalid("route", "The route belongs to another gym.")
	}
	if c.Discipline == "rope" {
		r.Zone = false
	} else {
		r.HoldCount = 0
	}
	if r.Number < 1 {
		return httpx.Invalid("number", "Must be at least 1.")
	}
	if r.Points < 0 {
		return httpx.Invalid("points", "Must not be negative.")
	}
	if r.HoldCount < 0 || r.HoldCount > 200 {
		return httpx.Invalid("hold_count", "Must be between 1 and 200.")
	}
	return nil
}

func (m *module) saveCompRoute(ctx context.Context, competitionID, id string, raw json.RawMessage) (CompRoute, error) {
	var before CompRoute
	if id != "" {
		var err error
		if before, err = findCompRoute(ctx, m.app.DB, id); err != nil {
			return CompRoute{}, err
		}
		competitionID = before.Competition
	}
	c, err := m.loadManaged(ctx, competitionID)
	if err != nil {
		return CompRoute{}, err
	}
	route := before
	if err := unmarshalBody(raw, &route); err != nil {
		return CompRoute{}, err
	}
	if id != "" && route.Competition != before.Competition {
		return CompRoute{}, errMoved
	}
	route.ID, route.Competition, route.Expand = before.ID, c.ID, nil
	if id == "" {
		route.ID = ids.New()
	}
	if err := m.validateCompRoute(ctx, c, &route); err != nil {
		return CompRoute{}, err
	}
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if err := refuseWhilePublished(ctx, tx, &c); err != nil {
			return err
		}
		if err := saveCompRoute(ctx, tx, route, id == ""); err != nil {
			return err
		}
		if route, err = findCompRoute(ctx, tx, route.ID); err != nil {
			return err
		}
		return publishChange(ctx, tx, c, "routes", "", "")
	})
	switch {
	case db.IsUnique(err, "competition_routes_route_idx"):
		return CompRoute{}, httpx.Invalid("route", "This route is already part of the competition.")
	case db.IsUnique(err, "competition_routes_number_idx"):
		return CompRoute{}, httpx.Invalid("number", "This number is already taken.")
	}
	return route, err
}

// refuseWhilePublished locks the competition so published results only change after unpublishing.
func refuseWhilePublished(ctx context.Context, tx pgx.Tx, c *Competition) error {
	var err error
	if *c, err = lockCompetition(ctx, tx, c.ID, "SHARE"); err != nil {
		return err
	}
	if c.Status == "published" {
		return httpx.BadRequest("Results are published; unpublish the competition first.")
	}
	return nil
}

func (m *module) deleteCompRoute(ctx context.Context, id string) error {
	route, err := findCompRoute(ctx, m.app.DB, id)
	if err != nil {
		return err
	}
	c, err := m.loadManaged(ctx, route.Competition)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if err := refuseWhilePublished(ctx, tx, &c); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM competition_routes WHERE id = $1`, id); err != nil {
			return err
		}
		return publishChange(ctx, tx, c, "routes", "", "")
	})
}
