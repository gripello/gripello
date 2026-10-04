package hooks

import (
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

const tickDateLeeway = 36 * time.Hour

var tickGradeFields = []string{"grade", "grade_system", "grade_index"}

func registerTicks(app core.App) {
	app.OnRecordCreate("ticks").BindFunc(func(e *core.RecordEvent) error {
		if route, err := e.App.FindRecordById("routes", e.Record.GetString("route")); err == nil {
			for _, field := range tickGradeFields {
				e.Record.Set(field, route.Get(field))
			}
			e.Record.Set("route_name", route.GetString("name"))
		}
		return saveTick(e)
	})

	app.OnRecordUpdate("ticks").BindFunc(saveTick)
}

func saveTick(e *core.RecordEvent) error {
	if tickDateInFuture(e.Record.GetDateTime("date").Time(), time.Now()) {
		return apis.NewBadRequestError("An ascent can't be logged in the future.", nil)
	}
	normalizeFlashAttempts(e.Record)
	return e.Next()
}

func tickDateInFuture(date time.Time, now time.Time) bool {
	return date.After(now.Add(tickDateLeeway))
}

func normalizeFlashAttempts(tick *core.Record) {
	if tick.GetString("type") == "flash" {
		tick.Set("attempts", 1)
	}
}
