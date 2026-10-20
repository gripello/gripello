package grades

import "strings"

const (
	MaxLength       = 20
	MaxSystemLength = 30
	MaxIndex        = 40
)

// Canonical spells a grade the way its system writes it: Font and V upper case, French lower case.
func Canonical(system, grade string) string {
	grade = strings.TrimSpace(grade)
	switch system {
	case "font", "v":
		return strings.ToUpper(grade)
	case "french":
		return strings.ToLower(grade)
	}
	return grade
}
