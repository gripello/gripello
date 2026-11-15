package gyms

import (
	"encoding/json"
	"slices"
	"strings"
	"unicode/utf8"

	platformmail "gripello/internal/platform/mail"
)

// Mirrored in shared/utils/gymContacts.ts (fixture testdata/gymContacts.json).
var (
	gymContactKinds    = []string{"front_desk", "privacy", "routesetting", "competitions", "courses", "other"}
	gymMaxContacts     = 10
	gymContactLabelMax = 50
	gymContactNameMax  = 100
	gymContactPhoneMax = 100
)

type gymContact struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
	Name  string `json:"name"`
	Email string `json:"email"`
	Phone string `json:"phone"`
}

func isValidGymContacts(raw []byte) bool {
	if isNull(raw) {
		return true
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	var contacts []gymContact
	if decoder.Decode(&contacts) != nil || decoder.More() || contacts == nil || hasNestedNull(raw) {
		return false
	}
	if len(contacts) > gymMaxContacts {
		return false
	}
	for _, contact := range contacts {
		if !slices.Contains(gymContactKinds, contact.Kind) ||
			utf8.RuneCountInString(contact.Label) > gymContactLabelMax ||
			utf8.RuneCountInString(contact.Name) > gymContactNameMax ||
			utf8.RuneCountInString(contact.Phone) > gymContactPhoneMax ||
			(contact.Email != "" && !validContactEmail(contact.Email)) ||
			(contact.Email == "" && contact.Phone == "") {
			return false
		}
	}
	return true
}

func validContactEmail(email string) bool {
	return platformmail.ValidAddress(email) && strings.Contains(email[strings.LastIndex(email, "@"):], ".")
}
