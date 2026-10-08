package hooks

import (
	"encoding/json"
	"regexp"
	"slices"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// Mirrored in shared/utils/openingHours.ts.
var openingHoursDays = []string{"mon", "tue", "wed", "thu", "fri", "sat", "sun", "holiday"}
var openingHoursTime = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

func isValidOpeningHours(raw []byte) bool {
	if len(raw) == 0 || string(raw) == "null" {
		return true
	}
	var hours map[string][][]string
	if json.Unmarshal(raw, &hours) != nil || hours == nil {
		return false
	}
	for day, intervals := range hours {
		if !slices.Contains(openingHoursDays, day) {
			return false
		}
		for _, interval := range intervals {
			if len(interval) != 2 || interval[0] == interval[1] ||
				!openingHoursTime.MatchString(interval[0]) || !openingHoursTime.MatchString(interval[1]) {
				return false
			}
		}
	}
	return true
}

func validateOpeningHours(e *core.RecordEvent) error {
	raw, _ := json.Marshal(e.Record.Get("opening_hours"))
	if !isValidOpeningHours(raw) {
		return apis.NewBadRequestError("Opening hours must map weekdays to HH:MM intervals.", nil)
	}
	return e.Next()
}
