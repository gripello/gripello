package competitions

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
)

const (
	permManage         = "manage_competitions"
	permJudge          = "judge_competitions"
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

func badRequest(message string) *httpx.Error { return httpx.NewError(http.StatusBadRequest, message) }

func invalid(field, message string) *httpx.Error {
	return badRequest(message).Field(field, "validation_invalid_value", message)
}

func required(field string) *httpx.Error {
	return badRequest("Failed to save record.").Field(field, "validation_required", "Cannot be blank.")
}

func tooLong(field, value string, limit int) error {
	if utf8.RuneCountInString(value) > limit {
		return invalid(field, "Must be no more than "+strconv.Itoa(limit)+" characters.")
	}
	return nil
}

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
	v := viewer{user: p.UserID, manager: m.perms.Can(ctx, p.UserID, gym, permManage)}
	v.staff = v.manager || m.perms.Can(ctx, p.UserID, gym, permJudge)
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

// loadVisible returns the competition unless it is a draft the caller may not manage (404, like PocketBase's view rule).
func (m *module) loadVisible(ctx context.Context, id string) (Competition, viewer, error) {
	c, err := findCompetition(ctx, m.app.DB, id)
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
		return badRequest("This scoring format does not fit the discipline.")
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
	fail := invalid("scoring", "Invalid scoring settings.")
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
	if c.Name == "" {
		return required("name")
	}
	if err := tooLong("name", c.Name, 200); err != nil {
		return err
	}
	if err := tooLong("description", c.Description, 5000); err != nil {
		return err
	}
	if !slices.Contains(competitionStatuses, c.Status) {
		return invalid("status", "Invalid status.")
	}
	if c.StartsAt.IsZero() {
		return required("starts_at")
	}
	if c.EndsAt.IsZero() {
		return required("ends_at")
	}
	if c.EndsAt.Before(c.StartsAt) {
		return invalid("ends_at", "The end must not be before the start.")
	}
	if err := validateCompetitionFormat(c); err != nil {
		return err
	}
	if err := validateScoring(c.Scoring); err != nil {
		return err
	}
	if c.FreezeMinutes < 0 || c.FreezeMinutes > 600 {
		return invalid("freeze_minutes", "Must be between 0 and 600.")
	}
	if c.RegistrationURL != "" {
		u, err := url.Parse(c.RegistrationURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return invalid("registration_url", "Must be a valid url.")
		}
	}
	return tooLong("registration_url", c.RegistrationURL, 500)
}

func (m *module) checkLocation(ctx context.Context, q querier, c Competition) error {
	if c.Location == "" {
		return required("location")
	}
	gym, err := locationGym(ctx, q, c.Location)
	if err != nil {
		return invalid("location", "Location not found.")
	}
	if gym != c.Gym {
		return badRequest("The competition cannot belong to another gym.")
	}
	return nil
}

func (m *module) createCompetition(ctx context.Context, gym string, raw json.RawMessage) (Competition, error) {
	p, err := auth.Require(ctx)
	if err != nil {
		return Competition{}, err
	}
	if !m.perms.Can(ctx, p.UserID, gym, permManage) {
		return Competition{}, httpx.ErrForbidden
	}
	c := Competition{Status: "draft"}
	if err := unmarshalBody(raw, &c); err != nil {
		return Competition{}, err
	}
	c.ID, c.Gym, c.Expand = ids.New(), gym, nil
	if err := m.checkCompetition(ctx, &c); err != nil {
		return Competition{}, err
	}
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if err := insertCompetition(ctx, tx, c); err != nil {
			return err
		}
		if c, err = findCompetition(ctx, tx, c.ID); err != nil {
			return err
		}
		return publishChange(ctx, tx, c, "competition", "", "")
	})
	return c, err
}

func (m *module) checkCompetition(ctx context.Context, c *Competition) error {
	stampFreezeAt(c)
	if err := validateCompetition(*c); err != nil {
		return err
	}
	return m.checkLocation(ctx, m.app.DB, *c)
}

func (m *module) updateCompetition(ctx context.Context, id string, raw json.RawMessage) (Competition, error) {
	before, err := m.loadManaged(ctx, id)
	if err != nil {
		return Competition{}, err
	}
	c := before
	if err := unmarshalBody(raw, &c); err != nil {
		return Competition{}, err
	}
	c.ID, c.Gym, c.Created, c.Updated, c.Expand = before.ID, before.Gym, before.Created, before.Updated, nil
	if err := m.checkCompetition(ctx, &c); err != nil {
		return Competition{}, err
	}
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
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
		entries, err := list[Entry](ctx, tx, `DELETE FROM competition_entries WHERE competition = $1 RETURNING `+entryColumns, id)
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

func competitionTickDate(endsAt, now time.Time) time.Time {
	day := endsAt.UTC()
	if day.After(now) {
		day = now.UTC()
	}
	return time.Date(day.Year(), day.Month(), day.Day(), 12, 0, 0, 0, time.UTC)
}

// publishResults copies every top into the climbers' logbooks (once per climber, route and competition or day) and notifies the entrants.
func (m *module) publishResults(ctx context.Context, tx pgx.Tx, c Competition, now time.Time) error {
	date := competitionTickDate(c.EndsAt, now)
	rows, err := tx.Query(ctx, `SELECT e."user", cr.route, s.top_attempt, r.name, r.grade, r.grade_system, r.grade_index,
			u.ticks_private
		FROM competition_scores s
		JOIN competition_entries e ON e.id = s.entry
		JOIN competition_routes cr ON cr.id = s.comp_route
		JOIN routes r ON r.id = cr.route
		JOIN users u ON u.id = e."user"
		WHERE s.competition = $1 AND s.top_attempt > 0 AND NOT cr.voided
			AND NOT EXISTS (SELECT 1 FROM ticks t WHERE t."user" = e."user" AND t.route = cr.route AND (t.competition = $1 OR t.date = $2))
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
		if err := publishTick(ctx, tx, tick, c.Gym, t.private); err != nil {
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
	return publishNotify(ctx, tx, Notify{Type: "competition_published", Users: users, Gym: c.Gym,
		Params: map[string]any{"competition": c.Name}, URL: "/" + gymSlug(ctx, tx, c.Gym) + "/competitions/" + c.ID})
}

func validateCategory(c Category) error {
	if c.Name == "" {
		return required("name")
	}
	if err := tooLong("name", c.Name, 100); err != nil {
		return err
	}
	if !slices.Contains(genders, c.Gender) {
		return invalid("gender", "Invalid gender.")
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

var errMoved = badRequest("Records cannot move to another competition.")

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
	if isForeignKeyViolation(err) {
		return badRequest("This category still has entries.")
	}
	return err
}

func (m *module) validateCompRoute(ctx context.Context, c Competition, r *CompRoute) error {
	var gym, routeType string
	err := m.app.DB.QueryRow(ctx, `SELECT gym, type FROM routes WHERE id = $1`, r.Route).Scan(&gym, &routeType)
	if err != nil || routeType != routeTypeByDiscipline[c.Discipline] {
		return invalid("route", "This route does not fit the discipline.")
	}
	if gym != c.Gym {
		return invalid("route", "The route belongs to another gym.")
	}
	if c.Discipline == "rope" {
		r.Zone = false
	} else {
		r.HoldCount = 0
	}
	if r.Number < 1 {
		return invalid("number", "Must be at least 1.")
	}
	if r.Points < 0 {
		return invalid("points", "Must not be negative.")
	}
	if r.HoldCount < 0 || r.HoldCount > 200 {
		return invalid("hold_count", "Must be between 1 and 200.")
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
		if err := saveCompRoute(ctx, tx, route, id == ""); err != nil {
			return err
		}
		if route, err = findCompRoute(ctx, tx, route.ID); err != nil {
			return err
		}
		return publishChange(ctx, tx, c, "routes", "", "")
	})
	switch {
	case isUniqueViolation(err, "competition_routes_route_idx"):
		return CompRoute{}, invalid("route", "This route is already part of the competition.")
	case isUniqueViolation(err, "competition_routes_number_idx"):
		return CompRoute{}, invalid("number", "This number is already taken.")
	}
	return route, err
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
		if _, err := tx.Exec(ctx, `DELETE FROM competition_routes WHERE id = $1`, id); err != nil {
			return err
		}
		return publishChange(ctx, tx, c, "routes", "", "")
	})
}

func registrationOpen(c Competition, now time.Time) bool {
	return c.Status == "open" && now.Before(c.EndsAt)
}

func ownerEntryStatus(current, requested string, registrationOpen bool) string {
	switch {
	case requested == current:
		return current
	case requested == "withdrawn" && current != "disqualified":
		return requested
	case requested == "registered" && current == "withdrawn" && registrationOpen:
		return requested
	default:
		return current
	}
}

func needsGuardianConsent(birthYear, currentYear int) bool {
	return currentYear-birthYear < guardianConsentAge
}

func categoryFits(c Category, birthYear int) bool {
	return (c.MinBirthYear == 0 || birthYear >= c.MinBirthYear) && (c.MaxBirthYear == 0 || birthYear <= c.MaxBirthYear)
}

func validateEntry(ctx context.Context, q querier, e Entry, currentYear int, enforceCategoryAge bool) error {
	if e.DisplayName == "" {
		return required("display_name")
	}
	if err := tooLong("display_name", e.DisplayName, 60); err != nil {
		return err
	}
	if !slices.Contains(entryStatuses, e.Status) {
		return invalid("status", "Invalid status.")
	}
	if e.Bib < 0 {
		return invalid("bib", "Must be at least 1.")
	}
	if e.BirthYear < currentYear-120 || e.BirthYear > currentYear {
		return invalid("birth_year", "Invalid birth year.")
	}
	if needsGuardianConsent(e.BirthYear, currentYear) && !e.GuardianConsent {
		return invalid("guardian_consent", "Participants under 16 need a guardian's consent.")
	}
	category, err := findCategory(ctx, q, e.Category)
	if err != nil || category.Competition != e.Competition {
		return invalid("category", "Category is not part of this competition.")
	}
	if enforceCategoryAge && !categoryFits(category, e.BirthYear) {
		return invalid("birth_year", "Your birth year does not fit this category.")
	}
	return nil
}

func (m *module) createEntry(ctx context.Context, competitionID string, raw json.RawMessage) (Entry, error) {
	p, err := auth.Require(ctx)
	if err != nil {
		return Entry{}, err
	}
	c, v, err := m.loadVisible(ctx, competitionID)
	if err != nil {
		return Entry{}, err
	}
	now := time.Now()
	e := Entry{Status: "registered"}
	if err := unmarshalBody(raw, &e); err != nil {
		return Entry{}, err
	}
	e.ID, e.Competition, e.Expand = ids.New(), c.ID, nil
	if !v.manager {
		if !registrationOpen(c, now) {
			return Entry{}, badRequest("Registration is closed.")
		}
		e.User, e.Status, e.Paid, e.Bib = p.UserID, "registered", false, 0
	}
	if e.User == "" {
		e.User = p.UserID
	}
	if err := validateEntry(ctx, m.app.DB, e, now.Year(), !v.manager); err != nil {
		return Entry{}, err
	}
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT 1 FROM competitions WHERE id = $1 FOR UPDATE`, c.ID); err != nil {
			return err
		}
		if e.Bib == 0 {
			if e.Bib, err = nextBib(ctx, tx, c.ID); err != nil {
				return err
			}
		}
		if err := saveEntry(ctx, tx, e, true); err != nil {
			return err
		}
		if e, err = findEntry(ctx, tx, e.ID); err != nil {
			return err
		}
		if err := publishEntryCreated(ctx, tx, e, c.Gym); err != nil {
			return err
		}
		if e.User != p.UserID {
			if err := publishNotify(ctx, tx, Notify{Type: "competition_entry_added", Users: []string{e.User}, Gym: c.Gym,
				Params: map[string]any{"competition": c.Name}, URL: "/" + gymSlug(ctx, tx, c.Gym) + "/competitions/" + c.ID}); err != nil {
				return err
			}
		}
		return publishChange(ctx, tx, c, "entries", e.User, e.ID)
	})
	return e, entryConflict(err)
}

func entryConflict(err error) error {
	switch {
	case isUniqueViolation(err, "competition_entries_user_idx"):
		return invalid("user", "Already registered for this competition.")
	case isUniqueViolation(err, "competition_entries_bib_idx"):
		return invalid("bib", "This bib is already taken.")
	case isForeignKeyViolation(err):
		return invalid("user", "User not found.")
	}
	return err
}

func (m *module) loadOwnedEntry(ctx context.Context, id string) (Entry, Competition, viewer, error) {
	p, err := auth.Require(ctx)
	if err != nil {
		return Entry{}, Competition{}, viewer{}, err
	}
	e, err := findEntry(ctx, m.app.DB, id)
	if err != nil {
		return e, Competition{}, viewer{}, err
	}
	c, err := findCompetition(ctx, m.app.DB, e.Competition)
	if err != nil {
		return e, c, viewer{}, err
	}
	v := m.viewerFor(ctx, c)
	if !v.manager && e.User != p.UserID {
		if v.staff || (c.Status != "draft" && !e.Hidden) {
			return e, c, v, httpx.ErrForbidden
		}
		return e, c, v, httpx.ErrNotFound
	}
	return e, c, v, nil
}

func (m *module) updateEntry(ctx context.Context, id string, raw json.RawMessage) (Entry, error) {
	before, c, v, err := m.loadOwnedEntry(ctx, id)
	if err != nil {
		return Entry{}, err
	}
	e := before
	if err := unmarshalBody(raw, &e); err != nil {
		return Entry{}, err
	}
	now := time.Now()
	if !v.manager {
		open := registrationOpen(c, now)
		e.Competition, e.User, e.Bib, e.Paid = before.Competition, before.User, before.Bib, before.Paid
		e.Status = ownerEntryStatus(before.Status, e.Status, open)
		if e.Category != before.Category && !open {
			return Entry{}, invalid("category", "Categories can only change while registration is open.")
		}
	}
	if e.Competition != before.Competition {
		return Entry{}, errMoved
	}
	if e.User != before.User {
		return Entry{}, invalid("user", "This field can't be changed.")
	}
	e.ID, e.Expand = before.ID, nil
	if err := validateEntry(ctx, m.app.DB, e, now.Year(), !v.manager); err != nil {
		return Entry{}, err
	}
	if e.DisplayName != before.DisplayName || e.Hidden != before.Hidden {
		if err := refuseWhileHidden(ctx, m.app.DB, "competition_entry", id); err != nil {
			return Entry{}, err
		}
	}
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if err := saveEntry(ctx, tx, e, false); err != nil {
			return err
		}
		if e, err = findEntry(ctx, tx, id); err != nil {
			return err
		}
		return publishChange(ctx, tx, c, "entries", e.User, e.ID)
	})
	return e, entryConflict(err)
}

func (m *module) deleteEntry(ctx context.Context, id string) error {
	e, c, v, err := m.loadOwnedEntry(ctx, id)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if !v.manager {
			var scored bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM competition_scores WHERE entry = $1)`, id).Scan(&scored); err != nil {
				return err
			}
			if scored || e.Status == "disqualified" {
				return httpx.NewError(http.StatusForbidden, "This entry can no longer be deleted; withdraw instead.")
			}
		}
		if _, err := tx.Exec(ctx, `DELETE FROM competition_entries WHERE id = $1`, id); err != nil {
			return err
		}
		if err := publishEntryDeleted(ctx, tx, e, c.Gym); err != nil {
			return err
		}
		return publishChange(ctx, tx, c, "entries", e.User, e.ID)
	})
}

func acceptsScores(c Competition, now time.Time) bool {
	return c.Status == "open" && !now.Before(c.StartsAt) && !now.After(c.EndsAt)
}

func normalizeScore(s *Score, r CompRoute, c Competition) {
	if c.Discipline == "rope" {
		normalizeRopeScore(s, r.HoldCount, c.ScoringFormat)
		return
	}
	s.Style, s.Height, s.HeightPlus = "", 0, false
	zone := s.ZoneAttempt
	if !r.Zone {
		zone = 0
	} else if s.TopAttempt > 0 && (zone == 0 || zone > s.TopAttempt) {
		zone = s.TopAttempt
	}
	s.ZoneAttempt = zone
	s.Attempts = max(s.Attempts, s.TopAttempt, zone)
}

func normalizeRopeScore(s *Score, holdCount int, format string) {
	s.ZoneAttempt = 0
	if format == judgeOnlyFormat {
		height := max(s.Height, 0)
		if holdCount > 0 {
			height = min(height, holdCount)
		}
		topped := holdCount > 0 && height == holdCount
		s.Style, s.Height, s.HeightPlus, s.TopAttempt, s.Attempts = "lead", height, s.HeightPlus && !topped, 0, 1
		if topped {
			s.TopAttempt = 1
		}
		return
	}
	if s.Style != "toprope" {
		s.Style = "lead"
	}
	s.Height, s.HeightPlus = 0, false
	s.Attempts = max(s.Attempts, s.TopAttempt)
}

func validateScoreNumbers(s Score) error {
	for field, value := range map[string]int{"attempts": s.Attempts, "zone_attempt": s.ZoneAttempt, "top_attempt": s.TopAttempt, "height": s.Height} {
		if value < 0 || value > 999 {
			return invalid(field, "Must be between 0 and 999.")
		}
	}
	if !slices.Contains([]string{"", "lead", "toprope"}, s.Style) {
		return invalid("style", "Invalid style.")
	}
	return nil
}

// guardScore is the PocketBase hook: entry and route must share the competition; climbers score only their own
// active entry, on open competitions inside the window, never voided routes or judge-only formats.
func guardScore(s *Score, e Entry, r CompRoute, c Competition, v viewer, now time.Time) error {
	if e.Competition != c.ID {
		return invalid("entry", "Entry not found.")
	}
	if r.Competition != c.ID {
		return invalid("comp_route", "Route is not part of this competition.")
	}
	if !v.staff {
		if e.User != v.user {
			return httpx.ErrForbidden
		}
		if c.ScoringFormat == judgeOnlyFormat {
			return httpx.NewError(http.StatusForbidden, "Only judges can enter scores in this competition.")
		}
		if !acceptsScores(c, now) {
			return badRequest("Scoring is closed.")
		}
		if slices.Contains(inactiveEntryStatuses, e.Status) {
			return httpx.NewError(http.StatusForbidden, "This entry can no longer score.")
		}
		if r.Voided {
			return badRequest("This route was removed from scoring.")
		}
	}
	if err := validateScoreNumbers(*s); err != nil {
		return err
	}
	s.Competition = c.ID
	normalizeScore(s, r, c)
	return nil
}

func (m *module) upsertScores(ctx context.Context, competitionID string, inputs []Score) ([]Score, error) {
	if _, err := auth.Require(ctx); err != nil {
		return nil, err
	}
	c, err := findCompetition(ctx, m.app.DB, competitionID)
	if err != nil {
		return nil, err
	}
	v := m.viewerFor(ctx, c)
	now := time.Now()
	saved := []Score{}
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		entries := map[string]bool{}
		for _, s := range inputs {
			e, err := findEntry(ctx, tx, s.Entry)
			if err != nil {
				return invalid("entry", "Entry not found.")
			}
			r, err := findCompRoute(ctx, tx, s.CompRoute)
			if err != nil {
				return invalid("comp_route", "Route is not part of this competition.")
			}
			if err := guardScore(&s, e, r, c, v, now); err != nil {
				return err
			}
			s.ID, s.ScoredBy = ids.New(), v.user
			stored, err := upsertScore(ctx, tx, s, v.staff)
			if errors.Is(err, httpx.ErrNotFound) {
				return httpx.NewError(http.StatusForbidden, "A judge already scored this route.")
			}
			if err != nil {
				return err
			}
			saved = append(saved, stored)
			entries[e.ID] = true
		}
		for entry := range entries {
			if err := publishChange(ctx, tx, c, "scores", "", entry); err != nil {
				return err
			}
		}
		return nil
	})
	return saved, err
}

func (m *module) deleteScore(ctx context.Context, id string) error {
	s, err := findScore(ctx, m.app.DB, id)
	if err != nil {
		return err
	}
	c, err := m.loadManaged(ctx, s.Competition)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM competition_scores WHERE id = $1`, id); err != nil {
			return err
		}
		return publishChange(ctx, tx, c, "scores", "", s.Entry)
	})
}
