package hooks

import (
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

func TestUserLanguagesMatchLocaleFiles(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	values := slices.Clone(users.Fields.GetByName("language").(*core.SelectField).Values)

	files, _ := filepath.Glob(filepath.Join("..", "..", "i18n", "locales", "*.json"))
	locales := []string{}
	for _, file := range files {
		locales = append(locales, strings.TrimSuffix(filepath.Base(file), ".json"))
	}

	slices.Sort(values)
	slices.Sort(locales)
	if !slices.Equal(values, locales) {
		t.Errorf("users.language = %v, locale files = %v", values, locales)
	}
}

func TestDroppedLanguagesAreCleared(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()

	runner := core.NewMigrationsRunner(app, core.AppMigrations)
	if _, err := runner.Down(1); err != nil {
		t.Fatal(err)
	}
	russian := saveRecord(t, app, "users", map[string]any{"email": "ru@example.com", "password": "pw12345678", "language": "ru"})
	german := saveRecord(t, app, "users", map[string]any{"email": "de@example.com", "password": "pw12345678", "language": "de"})
	if _, err := runner.Up(); err != nil {
		t.Fatal(err)
	}

	for user, want := range map[*core.Record]string{russian: "", german: "de"} {
		stored, err := app.FindRecordById("users", user.Id)
		if err != nil {
			t.Fatal(err)
		}
		if got := stored.GetString("language"); got != want {
			t.Errorf("%s language = %q, want %q", stored.Email(), got, want)
		}
	}
}
