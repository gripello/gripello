package hooks

import (
	"slices"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

const guardianConsentAge = 16

var inactiveEntryStatuses = []string{"disqualified", "withdrawn"}

var ownerLockedEntryFields = []string{"competition", "user", "bib", "paid"}

var lockedScoreFields = []string{"competition", "entry", "comp_route"}

var formatsByDiscipline = map[string][]string{
	"boulder": {"dynamic", "fixed", "ifsc", "tops"},
	"rope":    {"route_points", "lead_height", "dynamic"},
}

var routeTypeByDiscipline = map[string]string{
	"boulder": "Boulder",
	"rope":    "Route",
}

const judgeOnlyFormat = "lead_height"

func registerCompetitions(app core.App) {
	app.OnRecordDelete("competitions").BindFunc(func(e *core.RecordEvent) error {
		entries, err := e.App.FindAllRecords("competition_entries", dbx.HashExp{"competition": e.Record.Id})
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := e.App.Delete(entry); err != nil {
				return err
			}
		}
		return e.Next()
	})

	app.OnRecordUpdate("competition_categories", "competition_routes", "competition_entries").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetString("competition") != e.Record.Original().GetString("competition") {
			return apis.NewBadRequestError("Records cannot move to another competition.", nil)
		}
		return e.Next()
	})

	app.OnRecordCreateRequest("competition_entries").BindFunc(func(e *core.RecordRequestEvent) error {
		competition, err := e.App.FindRecordById("competitions", e.Record.GetString("competition"))
		if err != nil {
			return apis.NewBadRequestError("Competition not found.", nil)
		}
		manager := isCompetitionManager(e)
		if !manager {
			if competition.GetString("status") != "open" || !time.Now().Before(competition.GetDateTime("ends_at").Time()) {
				return apis.NewBadRequestError("Registration is closed.", nil)
			}
			e.Record.Set("user", requestUserID(e))
			e.Record.Set("status", "registered")
			e.Record.Set("paid", false)
		}
		if e.Record.GetString("status") == "" {
			e.Record.Set("status", "registered")
		}
		if err := validateEntry(e.App, e.Record, time.Now().Year(), !manager); err != nil {
			return err
		}
		if e.Record.GetInt("bib") == 0 || !manager {
			e.Record.Set("bib", nextBib(e.App, competition.Id))
		}
		return e.Next()
	})

	app.OnRecordUpdateRequest("competition_entries").BindFunc(func(e *core.RecordRequestEvent) error {
		manager := isCompetitionManager(e)
		original := e.Record.Original()
		if !manager {
			for _, field := range ownerLockedEntryFields {
				e.Record.Set(field, original.Get(field))
			}
			competition, err := e.App.FindRecordById("competitions", e.Record.GetString("competition"))
			if err != nil {
				return apis.NewBadRequestError("Competition not found.", nil)
			}
			registrationOpen := competition.GetString("status") == "open" && time.Now().Before(competition.GetDateTime("ends_at").Time())
			e.Record.Set("status", ownerEntryStatus(original.GetString("status"), e.Record.GetString("status"), registrationOpen))
			if e.Record.GetString("category") != original.GetString("category") && !registrationOpen {
				return apis.NewBadRequestError("Categories can only change while registration is open.", nil)
			}
		}
		if err := validateEntry(e.App, e.Record, time.Now().Year(), !manager); err != nil {
			return err
		}
		return e.Next()
	})

	app.OnRecordCreateRequest("competitions").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := validateCompetitionFormat(e.Record); err != nil {
			return err
		}
		return e.Next()
	})

	app.OnRecordUpdateRequest("competitions").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := validateCompetitionFormat(e.Record); err != nil {
			return err
		}
		return e.Next()
	})

	app.OnRecordCreate("competitions").BindFunc(func(e *core.RecordEvent) error {
		stampFreezeAt(e.Record)
		return e.Next()
	})

	app.OnRecordUpdate("competitions").BindFunc(func(e *core.RecordEvent) error {
		stampFreezeAt(e.Record)
		return e.Next()
	})

	app.OnRecordCreateRequest("competition_routes").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := validateCompetitionRoute(e.App, e.Record); err != nil {
			return err
		}
		return e.Next()
	})

	app.OnRecordUpdateRequest("competition_routes").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := validateCompetitionRoute(e.App, e.Record); err != nil {
			return err
		}
		return e.Next()
	})

	app.OnRecordCreateRequest("competition_scores").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := guardScore(e); err != nil {
			return err
		}
		return e.Next()
	})

	app.OnRecordUpdateRequest("competition_scores").BindFunc(func(e *core.RecordRequestEvent) error {
		original := e.Record.Original()
		for _, field := range lockedScoreFields {
			e.Record.Set(field, original.Get(field))
		}
		if err := guardScore(e); err != nil {
			return err
		}
		return e.Next()
	})
}

func isCompetitionManager(e *core.RecordRequestEvent) bool {
	return e.HasSuperuserAuth() || (e.Auth != nil && hasPermission(e.App, e.Auth.Id, competitionGym(e.App, e.Record), "manage_competitions"))
}

func isCompetitionStaff(e *core.RecordRequestEvent) bool {
	return isCompetitionManager(e) || (e.Auth != nil && hasPermission(e.App, e.Auth.Id, competitionGym(e.App, e.Record), "judge_competitions"))
}

func competitionGym(app core.App, record *core.Record) string {
	if record.Collection().Name == "competitions" {
		return record.GetString("gym")
	}
	source := record
	if original := record.Original(); original.Id != "" {
		source = original
	}
	competition, err := app.FindRecordById("competitions", source.GetString("competition"))
	if err != nil {
		return ""
	}
	return competition.GetString("gym")
}

func stampFreezeAt(competition *core.Record) {
	minutes := competition.GetInt("freeze_minutes")
	ends := competition.GetDateTime("ends_at")
	if !competition.GetBool("live_ranking") || minutes <= 0 || ends.IsZero() {
		competition.Set("freeze_at", "")
		return
	}
	competition.Set("freeze_at", ends.Add(-time.Duration(minutes)*time.Minute))
}

func validateCompetitionFormat(competition *core.Record) error {
	formats := formatsByDiscipline[competition.GetString("discipline")]
	if !slices.Contains(formats, competition.GetString("scoring_format")) {
		return apis.NewBadRequestError("This scoring format does not fit the discipline.", nil)
	}
	return nil
}

func validateCompetitionRoute(app core.App, compRoute *core.Record) error {
	competition, err := app.FindRecordById("competitions", compRoute.GetString("competition"))
	if err != nil {
		return apis.NewBadRequestError("Competition not found.", nil)
	}
	route, err := app.FindRecordById("routes", compRoute.GetString("route"))
	if err != nil || route.GetString("type") != routeTypeByDiscipline[competition.GetString("discipline")] {
		return apis.NewBadRequestError("This route does not fit the discipline.", nil)
	}
	if route.GetString("gym") != competition.GetString("gym") {
		return apis.NewBadRequestError("The route belongs to another gym.", nil)
	}
	if competition.GetString("discipline") == "rope" {
		compRoute.Set("zone", false)
	} else {
		compRoute.Set("hold_count", 0)
	}
	return nil
}

func guardScore(e *core.RecordRequestEvent) error {
	entry, err := e.App.FindRecordById("competition_entries", e.Record.GetString("entry"))
	if err != nil {
		return apis.NewBadRequestError("Entry not found.", nil)
	}
	compRoute, err := e.App.FindRecordById("competition_routes", e.Record.GetString("comp_route"))
	if err != nil || compRoute.GetString("competition") != entry.GetString("competition") {
		return apis.NewBadRequestError("Route is not part of this competition.", nil)
	}
	competition, err := e.App.FindRecordById("competitions", entry.GetString("competition"))
	if err != nil {
		return apis.NewBadRequestError("Competition not found.", nil)
	}
	e.Record.Set("competition", competition.Id)

	if !isCompetitionStaff(e) {
		if competition.GetString("scoring_format") == judgeOnlyFormat {
			return apis.NewForbiddenError("Only judges can enter scores in this competition.", nil)
		}
		if !acceptsScores(competition, time.Now()) {
			return apis.NewBadRequestError("Scoring is closed.", nil)
		}
		if slices.Contains(inactiveEntryStatuses, entry.GetString("status")) {
			return apis.NewForbiddenError("This entry can no longer score.", nil)
		}
		if compRoute.GetBool("voided") {
			return apis.NewBadRequestError("This route was removed from scoring.", nil)
		}
	}
	normalizeScore(e.Record, compRoute, competition)
	return nil
}

func acceptsScores(competition *core.Record, now time.Time) bool {
	return competition.GetString("status") == "open" &&
		!now.Before(competition.GetDateTime("starts_at").Time()) &&
		!now.After(competition.GetDateTime("ends_at").Time())
}

func normalizeScore(score, compRoute, competition *core.Record) {
	if competition.GetString("discipline") == "rope" {
		normalizeRopeScore(score, compRoute.GetInt("hold_count"), competition.GetString("scoring_format"))
		return
	}
	score.Set("style", "")
	score.Set("height", 0)
	score.Set("height_plus", false)
	top := score.GetInt("top_attempt")
	zone := score.GetInt("zone_attempt")
	if !compRoute.GetBool("zone") {
		zone = 0
	} else if top > 0 && (zone == 0 || zone > top) {
		zone = top
	}
	score.Set("zone_attempt", zone)
	score.Set("attempts", max(score.GetInt("attempts"), top, zone))
}

func normalizeRopeScore(score *core.Record, holdCount int, format string) {
	score.Set("zone_attempt", 0)
	if format == judgeOnlyFormat {
		height := max(score.GetInt("height"), 0)
		if holdCount > 0 {
			height = min(height, holdCount)
		}
		topped := holdCount > 0 && height == holdCount
		score.Set("style", "lead")
		score.Set("height", height)
		score.Set("height_plus", score.GetBool("height_plus") && !topped)
		score.Set("top_attempt", 0)
		if topped {
			score.Set("top_attempt", 1)
		}
		score.Set("attempts", 1)
		return
	}
	if score.GetString("style") != "toprope" {
		score.Set("style", "lead")
	}
	score.Set("height", 0)
	score.Set("height_plus", false)
	score.Set("attempts", max(score.GetInt("attempts"), score.GetInt("top_attempt")))
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

func categoryFits(category *core.Record, birthYear int) bool {
	minYear := category.GetInt("min_birth_year")
	maxYear := category.GetInt("max_birth_year")
	return (minYear == 0 || birthYear >= minYear) && (maxYear == 0 || birthYear <= maxYear)
}

func validateEntry(app core.App, entry *core.Record, currentYear int, enforceCategoryAge bool) error {
	birthYear := entry.GetInt("birth_year")
	if birthYear < currentYear-120 || birthYear > currentYear {
		return apis.NewBadRequestError("Invalid birth year.", nil)
	}
	if needsGuardianConsent(birthYear, currentYear) && !entry.GetBool("guardian_consent") {
		return apis.NewBadRequestError("Participants under 16 need a guardian's consent.", nil)
	}
	category, err := app.FindRecordById("competition_categories", entry.GetString("category"))
	if err != nil || category.GetString("competition") != entry.GetString("competition") {
		return apis.NewBadRequestError("Category is not part of this competition.", nil)
	}
	if enforceCategoryAge && !categoryFits(category, birthYear) {
		return apis.NewBadRequestError("Your birth year does not fit this category.", nil)
	}
	return nil
}

func nextBib(app core.App, competitionID string) int {
	var result struct {
		Bib int `db:"bib"`
	}
	err := app.DB().
		NewQuery("SELECT COALESCE(MAX(bib), 0) AS bib FROM competition_entries WHERE competition = {:competition}").
		Bind(dbx.Params{"competition": competitionID}).
		One(&result)
	if err != nil {
		app.Logger().Error("competitions: failed to read highest bib", "competition", competitionID, "error", err)
	}
	return result.Bib + 1
}
