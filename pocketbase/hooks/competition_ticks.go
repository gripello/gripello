package hooks

import (
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

func registerCompetitionTicks(app core.App) {
	app.OnRecordUpdate("competitions").BindFunc(func(e *core.RecordEvent) error {
		wasPublished := e.Record.Original().GetString("status") == "published"
		if err := e.Next(); err != nil {
			return err
		}
		if !wasPublished && e.Record.GetString("status") == "published" {
			copyCompetitionTicks(e.App, e.Record)
			notifyCompetitionPublished(e.App, e.Record)
		}
		return nil
	})
}

func competitionTickType(topAttempt int) string {
	if topAttempt == 1 {
		return "flash"
	}
	return "top"
}

func competitionTickDate(endsAt, now time.Time) string {
	day := endsAt.UTC()
	if day.After(now) {
		day = now.UTC()
	}
	return day.Format("2006-01-02") + " 12:00:00.000Z"
}

func copyCompetitionTicks(app core.App, competition *core.Record) {
	scores, err := app.FindRecordsByFilter(
		"competition_scores",
		"competition = {:competition} && top_attempt > 0",
		"",
		0,
		0,
		dbx.Params{"competition": competition.Id},
	)
	if err != nil {
		app.Logger().Error("competitions: failed to load tops for logbook", "competition", competition.Id, "error", err)
		return
	}
	ticks, err := app.FindCollectionByNameOrId("ticks")
	if err != nil {
		return
	}
	date := competitionTickDate(competition.GetDateTime("ends_at").Time(), time.Now())
	for _, score := range scores {
		entry, entryErr := app.FindRecordById("competition_entries", score.GetString("entry"))
		compRoute, routeErr := app.FindRecordById("competition_routes", score.GetString("comp_route"))
		if entryErr != nil || routeErr != nil || compRoute.GetBool("voided") {
			continue
		}
		user, route := entry.GetString("user"), compRoute.GetString("route")
		existing, _ := app.FindFirstRecordByFilter(
			"ticks",
			"user = {:user} && route = {:route} && date = {:date}",
			dbx.Params{"user": user, "route": route, "date": date},
		)
		if existing != nil {
			continue
		}
		tick := core.NewRecord(ticks)
		tick.Set("user", user)
		tick.Set("route", route)
		tick.Set("type", competitionTickType(score.GetInt("top_attempt")))
		tick.Set("attempts", score.GetInt("top_attempt"))
		tick.Set("date", date)
		tick.Set("note", competition.GetString("name"))
		if err := app.Save(tick); err != nil {
			app.Logger().Error("competitions: failed to copy top to logbook", "score", score.Id, "error", err)
		}
	}
}

func notifyCompetitionPublished(app core.App, competition *core.Record) {
	entries, err := app.FindRecordsByFilter(
		"competition_entries",
		"competition = {:competition} && status != 'withdrawn'",
		"",
		0,
		0,
		dbx.Params{"competition": competition.Id},
	)
	if err != nil {
		app.Logger().Error("competitions: failed to load entrants", "competition", competition.Id, "error", err)
		return
	}
	ids := make([]string, 0, len(entries))
	for _, entry := range entries {
		ids = append(ids, entry.GetString("user"))
	}
	users, err := app.FindRecordsByIds("users", ids)
	if err != nil {
		return
	}
	gym := competition.GetString("gym")
	pushNotification(app, notification{
		Users:  users,
		Gym:    gym,
		Type:   "competition_published",
		Params: map[string]any{"competition": competition.GetString("name")},
		URL:    gymPath(app, gym, "/competitions/"+competition.Id),
	})
}
