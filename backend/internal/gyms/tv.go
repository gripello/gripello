package gyms

import (
	"encoding/json"
	"math"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

// Mirrored in shared/utils/tvSettings.ts (fixture testdata/tvSettings.json).
var (
	tvSlides             = []string{"new_routes", "leaderboard", "resets", "info", "announcements"}
	tvMinSeconds         = 5.0
	tvMaxSeconds         = 120.0
	tvMaxScreens         = 10
	tvMaxScreenNameLen   = 50
	tvMaxAnnouncements   = 10
	tvMaxAnnouncementLen = 120
	tvScreenID           = regexp.MustCompile(`^[a-z0-9]{1,15}$`)
	tvLocation           = regexp.MustCompile(`^[a-z0-9]{0,15}$`)
)

type tvAnnouncement struct {
	Text  string `json:"text"`
	Until string `json:"until,omitempty"`
}

type tvScreen struct {
	ID       *string   `json:"id"`
	Name     *string   `json:"name"`
	Slides   *[]string `json:"slides"`
	Seconds  *float64  `json:"seconds"`
	Location *string   `json:"location"`
	Takeover *bool     `json:"takeover"`
}

type tvSettings struct {
	Screens       *[]tvScreen       `json:"screens"`
	Announcements *[]tvAnnouncement `json:"announcements"`
}

func isValidTvScreen(screen tvScreen) bool {
	if screen.ID == nil || !tvScreenID.MatchString(*screen.ID) {
		return false
	}
	if screen.Name != nil && utf8.RuneCountInString(*screen.Name) > tvMaxScreenNameLen {
		return false
	}
	if screen.Slides != nil {
		for i, slide := range *screen.Slides {
			if !slices.Contains(tvSlides, slide) || slices.Index(*screen.Slides, slide) != i {
				return false
			}
		}
	}
	if seconds := screen.Seconds; seconds != nil &&
		(*seconds != math.Trunc(*seconds) || *seconds < tvMinSeconds || *seconds > tvMaxSeconds) {
		return false
	}
	return screen.Location == nil || tvLocation.MatchString(*screen.Location)
}

func isValidTvSettings(raw []byte) bool {
	if isNull(raw) {
		return true
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	var settings tvSettings
	if decoder.Decode(&settings) != nil || decoder.More() || hasNestedNull(raw) {
		return false
	}
	if settings.Screens != nil {
		if len(*settings.Screens) > tvMaxScreens {
			return false
		}
		ids := map[string]bool{}
		for _, screen := range *settings.Screens {
			if !isValidTvScreen(screen) || ids[*screen.ID] {
				return false
			}
			ids[*screen.ID] = true
		}
	}
	if settings.Announcements != nil {
		if len(*settings.Announcements) > tvMaxAnnouncements {
			return false
		}
		for _, announcement := range *settings.Announcements {
			length := utf8.RuneCountInString(strings.TrimSpace(announcement.Text))
			if length == 0 || length > tvMaxAnnouncementLen {
				return false
			}
			if announcement.Until != "" {
				if _, err := time.Parse(time.DateOnly, announcement.Until); err != nil {
					return false
				}
			}
		}
	}
	return true
}

func hasNestedNull(raw []byte) bool {
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return true
	}
	var walk func(any) bool
	walk = func(value any) bool {
		switch value := value.(type) {
		case nil:
			return true
		case map[string]any:
			for _, child := range value {
				if walk(child) {
					return true
				}
			}
		case []any:
			for _, child := range value {
				if walk(child) {
					return true
				}
			}
		}
		return false
	}
	return walk(value)
}
