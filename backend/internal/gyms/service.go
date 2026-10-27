package gyms

import (
	"bytes"
	"encoding/json"
	"net/url"
	"reflect"
	"regexp"
	"slices"
	"time"
	"unicode/utf8"

	"gripello/internal/platform/blob"
	"gripello/internal/platform/grades"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/locales"
	platformmail "gripello/internal/platform/mail"
	"gripello/internal/platform/tenancy"
)

// Mirrored in shared/utils/gymSlug.ts (fixture testdata/gymSlug.json).
var gymSlugPattern = regexp.MustCompile(`^[a-z0-9-]{3,40}$`)

var reservedGymSlugs = []string{
	"_i18n",
	"_nuxt",
	"account",
	"admin",
	"api",
	"auth",
	"climber",
	"competitions",
	"friends",
	"imprint",
	"logbook",
	"manage",
	"map",
	"offline",
	"platform",
	"privacy",
	"route",
	"routes",
	"scan",
}

// Mirrored in shared/utils/openingHours.ts (fixture testdata/openingHours.json).
var openingHoursDays = []string{"mon", "tue", "wed", "thu", "fri", "sat", "sun", "holiday"}
var openingHoursTime = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

// Mirrored in shared/utils/gymAmenities.ts.
var gymAmenities = []string{
	"toilets", "showers", "changing_rooms", "lockers", "cafe", "shop", "rental", "parking", "bike_parking",
	"public_transport", "kids_area", "training_area", "outdoor_area", "yoga", "sauna", "wheelchair", "wifi",
}

const maxFileSize = 5 << 20

var imageTypes = []string{"image/jpeg", "image/png", "image/svg+xml", "image/webp"}

var fileTypes = map[string][]string{
	"page_logo":   imageTypes,
	"page_icon":   {"image/x-icon"},
	"sign_image":  imageTypes,
	"cover_image": {"image/jpeg", "image/png", "image/webp"},
}

var thumbs = map[string][]string{"page_logo": {blob.ThumbLogo, blob.ThumbSquare}, "cover_image": {blob.ThumbCover, blob.ThumbCoverLarge}}

type field struct {
	kind     string
	min, max float64
	required bool
}

var gymFields = map[string]field{
	"slug":                  {kind: "slug", required: true},
	"name":                  {kind: "text", max: 100, required: true},
	"unit_name":             {kind: "text", max: 100},
	"short_name":            {kind: "text", max: 30},
	"active":                {kind: "bool"},
	"hidden":                {kind: "bool"},
	"page_logo":             {kind: "file"},
	"page_icon":             {kind: "file"},
	"sign_image":            {kind: "file"},
	"cover_image":           {kind: "file"},
	"contact_email":         {kind: "email"},
	"route_grade_system":    {kind: "text", max: 50},
	"boulder_grade_system":  {kind: "text", max: 50},
	"boulder_bands":         {kind: "bands", max: 5000},
	"legal_address":         {kind: "text", max: 1000},
	"legal_phone":           {kind: "text", max: 100},
	"legal_register":        {kind: "text", max: 500},
	"legal_vat_id":          {kind: "text", max: 100},
	"legal_editorial":       {kind: "text", max: 500},
	"legal_representatives": {kind: "json", max: 20000},
	"imprint_url":           {kind: "url"},
	"privacy_url":           {kind: "url"},
	"privacy_doc":           {kind: "privacy"},
	"previous_slugs":        {kind: "slugs"},
	"language":              {kind: "language"},
	"features":              {kind: "features"},
	"premoderate_betas":     {kind: "bool"},
	"description":           {kind: "text", max: 2000},
	"address":               {kind: "text", max: 300},
	"latitude":              {kind: "number", min: -90, max: 90},
	"longitude":             {kind: "number", min: -180, max: 180},
	"website_url":           {kind: "url"},
	"opening_hours":         {kind: "hours", max: 4000},
	"hours_note":            {kind: "text", max: 300},
	"amenities":             {kind: "amenities"},
	"tv_settings":           {kind: "tv", max: 16000},
	"trial_ends_at":         {kind: "time"},
}

var settingsFields = map[string]field{
	"imprint_url":           {kind: "url"},
	"privacy_url":           {kind: "url"},
	"contact_email":         {kind: "email"},
	"audit_retention_days":  {kind: "int", min: 1, max: 3650},
	"legal_name":            {kind: "text", max: 300},
	"legal_address":         {kind: "text", max: 1000},
	"legal_phone":           {kind: "text", max: 100},
	"legal_register":        {kind: "text", max: 500},
	"legal_vat_id":          {kind: "text", max: 100},
	"legal_editorial":       {kind: "text", max: 500},
	"legal_representatives": {kind: "json", max: 20000},
	"allow_registration":    {kind: "bool"},
	"privacy_doc":           {kind: "privacy"},
}

func validateGymSlug(slug string) string {
	if !gymSlugPattern.MatchString(slug) {
		return "The slug may only contain 3 to 40 lowercase letters, digits and dashes."
	}
	if slices.Contains(reservedGymSlugs, slug) {
		return "This slug is reserved."
	}
	return ""
}

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

func isNull(raw json.RawMessage) bool { return len(raw) == 0 || string(raw) == "null" }

// validateFields turns a request body into column → value changes; creating requires every required field.
func validateFields(body map[string]json.RawMessage, fields map[string]field, creating bool) (map[string]any, error) {
	changes := map[string]any{}
	invalid := httpx.BadRequest("Failed to validate.")
	for name, spec := range fields {
		raw, given := body[name]
		if !given {
			if creating && spec.required {
				invalid.Field(name, "validation_required", "Cannot be blank.")
			}
			continue
		}
		value, message := validateValue(spec, raw)
		if text, isText := value.(string); message == "" && spec.required && isText && httpx.Blank(text) {
			message = "Cannot be blank."
		}
		if message != "" {
			invalid.Field(name, "validation_invalid_"+name, message)
			continue
		}
		changes[name] = value
	}
	if len(invalid.Data) > 0 {
		invalid.Message = firstMessage(invalid)
		return nil, invalid
	}
	return changes, nil
}

func firstMessage(e *httpx.Error) string {
	if len(e.Data) == 1 {
		for _, field := range e.Data {
			return field.Message
		}
	}
	return e.Message
}

func validateValue(spec field, raw json.RawMessage) (any, string) {
	switch spec.kind {
	case "text", "email", "url", "slug", "language", "file":
		var s string
		if isNull(raw) && spec.kind == "file" {
			return "", ""
		}
		if json.Unmarshal(raw, &s) != nil {
			return nil, "Must be a string."
		}
		return s, validateString(spec, s)
	case "bool":
		var b bool
		if json.Unmarshal(raw, &b) != nil {
			return nil, "Must be true or false."
		}
		return b, ""
	case "number", "int":
		var n float64
		if json.Unmarshal(raw, &n) != nil {
			return nil, "Must be a number."
		}
		if spec.kind == "int" && n != float64(int(n)) {
			return nil, "Must be a whole number."
		}
		if (n != 0 || spec.kind == "number") && (n < spec.min || n > spec.max) {
			return nil, "Out of range."
		}
		if spec.kind == "int" {
			return int(n), ""
		}
		return n, ""
	case "json":
		if len(raw) > int(spec.max) {
			return nil, "Too large."
		}
		if isNull(raw) {
			return nil, ""
		}
		return raw, ""
	case "bands":
		if len(raw) > int(spec.max) {
			return nil, "Too large."
		}
		if isNull(raw) {
			return nil, ""
		}
		if !validBoulderBands(raw) {
			return nil, "Bands are a list of at most 12 entries with a hex colour, a name of at most 50 characters and a grade."
		}
		return raw, ""
	case "privacy":
		if !isValidPrivacyDoc(raw) {
			return nil, "The privacy page must be an editor document that keeps the controller and rights sections and lists every section once."
		}
		if isNull(raw) {
			return nil, ""
		}
		return raw, ""
	case "hours":
		if len(raw) > int(spec.max) || !isValidOpeningHours(raw) {
			return nil, "Opening hours must map weekdays to HH:MM intervals."
		}
		if isNull(raw) {
			return nil, ""
		}
		return raw, ""
	case "tv":
		if len(raw) > int(spec.max) || !isValidTvSettings(raw) {
			return nil, "TV settings are invalid."
		}
		if isNull(raw) {
			return nil, ""
		}
		return raw, ""
	case "slugs":
		slugs := []string{}
		if !isNull(raw) && json.Unmarshal(raw, &slugs) != nil {
			return nil, "previous_slugs must be a list of slugs."
		}
		return slugs, ""
	case "features":
		var features map[string]any
		if json.Unmarshal(raw, &features) != nil {
			return nil, "Feature flags must be an object of true/false values."
		}
		for flag, value := range features {
			if _, ok := value.(bool); !ok {
				return nil, "Feature flags must be an object of true/false values."
			}
			if !slices.Contains(tenancy.FeatureFlags, flag) {
				return nil, "Unknown feature flag " + flag + "."
			}
		}
		if features == nil {
			features = map[string]any{}
		}
		return features, ""
	case "time":
		if isNull(raw) {
			return nil, ""
		}
		var t time.Time
		if json.Unmarshal(raw, &t) != nil {
			return nil, "Must be a date and time."
		}
		return t, ""
	case "amenities":
		var amenities []string
		if !isNull(raw) && json.Unmarshal(raw, &amenities) != nil {
			return nil, "Must be a list of amenities."
		}
		unique := []string{}
		for _, amenity := range amenities {
			if !slices.Contains(gymAmenities, amenity) {
				return nil, "Unknown amenity " + amenity + "."
			}
			if !slices.Contains(unique, amenity) {
				unique = append(unique, amenity)
			}
		}
		return unique, ""
	}
	return nil, "Unsupported field."
}

func validateString(spec field, s string) string {
	switch spec.kind {
	case "text":
		if utf8.RuneCountInString(s) > int(spec.max) {
			return "Too long."
		}
	case "email":
		if s != "" {
			if !platformmail.ValidAddress(s) {
				return "Must be a valid email address."
			}
		}
	case "url":
		if s != "" {
			if u, err := url.ParseRequestURI(s); err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
				return "Must be a valid url."
			}
		}
	case "slug":
		return validateGymSlug(s)
	case "language":
		if !locales.Allowed(s) {
			return "Unknown language."
		}
	case "file":
		if s != "" {
			return "Files can only be uploaded or cleared."
		}
	}
	return ""
}

// platformOnlyChange returns why a non-platform admin may not send body; it runs before validation.
func platformOnlyChange(body map[string]json.RawMessage, current *gymState) string {
	if raw, ok := body["slug"]; ok {
		var slug string
		if json.Unmarshal(raw, &slug) != nil || slug != current.Slug {
			return "Only platform admins may change the slug."
		}
	}
	if raw, ok := body["features"]; ok && featuresChanged(current.Features, raw) {
		return "Only platform admins may change feature flags."
	}
	if raw, ok := body["previous_slugs"]; ok {
		slugs := []string{}
		if !isNull(raw) && json.Unmarshal(raw, &slugs) != nil || !slices.Equal(slugs, current.PreviousSlugs) {
			return "Only platform admins may release previous slugs."
		}
	}
	if raw, ok := body["active"]; ok {
		var active bool
		if json.Unmarshal(raw, &active) != nil || active != current.Active {
			return "Only platform admins may activate or deactivate gyms."
		}
	}
	if raw, ok := body["trial_ends_at"]; ok && trialChanged(current.TrialEndsAt, raw) {
		return "Only platform admins may change the trial."
	}
	if raw, ok := body["hidden"]; ok {
		var hidden bool
		if json.Unmarshal(raw, &hidden) != nil || hidden != current.Hidden {
			return "Only platform admins may hide gyms."
		}
	}
	return ""
}

func trialChanged(stored *time.Time, raw json.RawMessage) bool {
	if isNull(raw) {
		return stored != nil
	}
	var after time.Time
	return json.Unmarshal(raw, &after) != nil || stored == nil || !after.Equal(*stored)
}

// Compares the stored JSON values, not their bool reading: 1 is a change from true.
func featuresChanged(stored map[string]any, raw json.RawMessage) bool {
	var after map[string]any
	if json.Unmarshal(raw, &after) != nil {
		return true
	}
	return (len(stored) > 0 || len(after) > 0) && !reflect.DeepEqual(stored, after)
}

// slugHistory keeps every slug the gym had except the current one, so old links keep redirecting.
func slugHistory(current *gymState, changes map[string]any) (slug string, previous []string) {
	previous = []string{}
	if current != nil {
		slug = current.Slug
		previous = append(previous, current.PreviousSlugs...)
	}
	if v, ok := changes["slug"].(string); ok {
		slug = v
	}
	if v, ok := changes["previous_slugs"].([]string); ok {
		previous = v
	}
	if current != nil && current.Slug != slug && !slices.Contains(previous, current.Slug) {
		previous = append(previous, current.Slug)
	}
	return slug, slices.DeleteFunc(previous, func(p string) bool { return p == slug })
}

var hexColorPattern = regexp.MustCompile(`^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$`)

const maxBoulderBands = 12

// validBoulderBands mirrors BoulderBandSetting in shared/utils/gradeReference.ts; the colour reaches every visitor's CSS, so only hex passes.
func validBoulderBands(raw json.RawMessage) bool {
	var bands []struct {
		Name  string `json:"name"`
		Color string `json:"color"`
		To    string `json:"to"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&bands) != nil || len(bands) > maxBoulderBands {
		return false
	}
	for _, band := range bands {
		if utf8.RuneCountInString(band.Name) > 50 || utf8.RuneCountInString(band.To) > grades.MaxLength || !hexColorPattern.MatchString(band.Color) {
			return false
		}
	}
	return true
}
