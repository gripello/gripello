package hooks

import (
	"regexp"
	"slices"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

const platformSettingsID = "platformsetting"

var gymSlugPattern = regexp.MustCompile(`^[a-z0-9-]{3,40}$`)

var reservedGymSlugs = []string{
	"_i18n",
	"_nuxt",
	"account",
	"admin",
	"api",
	"auth",
	"competitions",
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

var gymOwnedTables = []string{"locations", "walls", "routes", "ratings", "tasks", "reports", "competitions", "roles"}

type gymParent struct {
	collection string
	field      string
}

var gymParents = map[string]gymParent{
	"walls":        {"locations", "location"},
	"routes":       {"locations", "location"},
	"ratings":      {"routes", "route_id"},
	"competitions": {"locations", "location"},
}

type seededRole struct {
	name        string
	description string
	color       string
	permissions []string
}

var seededGymRoles = []seededRole{
	{name: "admin", description: "Full access", color: "#7C4DFF"},
	{
		name:        "routesetter",
		description: "Can manage routes, comments, and inventory",
		color:       "#26A69A",
		permissions: []string{"manage_routes", "view_analytics", "manage_comments", "run_inventory", "manage_tasks", "manage_competitions", "judge_competitions"},
	},
}

func registerGyms(app core.App) {
	validateSlug := func(e *core.RecordEvent) error {
		if err := validateGymSlug(e.Record.GetString("slug")); err != nil {
			return err
		}
		if err := recordSlugHistory(e.Record); err != nil {
			return err
		}
		used, err := slugUsedByAnotherGym(e.App, e.Record.Id, e.Record.GetString("slug"))
		if err != nil {
			return err
		}
		if used {
			return apis.NewBadRequestError("This slug was used by another gym.", nil)
		}
		return e.Next()
	}
	app.OnRecordCreate("gyms").BindFunc(validateSlug)
	app.OnRecordUpdate("gyms").BindFunc(validateSlug)

	app.OnRecordUpdateRequest("gyms").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() || isPlatformAdmin(e.Auth) {
			return e.Next()
		}
		if e.Record.GetString("slug") != e.Record.Original().GetString("slug") {
			return apis.NewForbiddenError("Only platform admins may change the slug.", nil)
		}
		before, _ := previousSlugs(e.Record.Original())
		after, _ := previousSlugs(e.Record)
		if !slices.Equal(before, after) {
			return apis.NewForbiddenError("Only platform admins may release previous slugs.", nil)
		}
		return e.Next()
	})

	app.OnRecordCreateExecute("gyms").BindFunc(func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		if err := adoptOrphans(e.App, e.Record.Id); err != nil {
			return err
		}
		return seedGymRoles(e.App, e.Record.Id)
	})

	for collection, parent := range gymParents {
		inherit := func(e *core.RecordEvent) error {
			if err := copyGymFrom(e.App, e.Record, parent.collection, parent.field); err != nil {
				return err
			}
			return e.Next()
		}
		app.OnRecordCreate(collection).BindFunc(inherit)
		app.OnRecordUpdate(collection).BindFunc(inherit)
	}

	keepGym := func(e *core.RecordEvent) error {
		if err := rejectGymMove(e.Record); err != nil {
			return err
		}
		return e.Next()
	}
	app.OnRecordUpdate("locations", "roles", "reports").BindFunc(keepGym)

	app.OnRecordCreate("reports").BindFunc(func(e *core.RecordEvent) error {
		if gym := reportedContentGym(e.App, e.Record); gym != "" {
			e.Record.Set("gym", gym)
		}
		return e.Next()
	})
}

func validateGymSlug(slug string) error {
	if !gymSlugPattern.MatchString(slug) {
		return apis.NewBadRequestError("The slug may only contain 3 to 40 lowercase letters, digits and dashes.", nil)
	}
	if slices.Contains(reservedGymSlugs, slug) {
		return apis.NewBadRequestError("This slug is reserved.", nil)
	}
	return nil
}

func previousSlugs(record *core.Record) ([]string, error) {
	slugs := []string{}
	if raw := record.GetString("previous_slugs"); raw != "" && raw != "null" {
		if err := record.UnmarshalJSONField("previous_slugs", &slugs); err != nil {
			return nil, apis.NewBadRequestError("previous_slugs must be a list of slugs.", nil)
		}
	}
	return slugs, nil
}

func recordSlugHistory(record *core.Record) error {
	slugs, err := previousSlugs(record)
	if err != nil {
		return err
	}
	slug := record.GetString("slug")
	if !record.IsNew() {
		if old := record.Original().GetString("slug"); old != "" && old != slug && !slices.Contains(slugs, old) {
			slugs = append(slugs, old)
		}
	}
	record.Set("previous_slugs", slices.DeleteFunc(slugs, func(previous string) bool { return previous == slug }))
	return nil
}

func slugUsedByAnotherGym(app core.App, gymID, slug string) (bool, error) {
	var used bool
	err := app.DB().NewQuery(
		"SELECT EXISTS (SELECT 1 FROM {{gyms}} g, json_each(CASE WHEN json_valid(g.previous_slugs) THEN g.previous_slugs ELSE '[]' END) " +
			"WHERE g.id != {:id} AND json_each.value = {:slug})",
	).Bind(dbx.Params{"id": gymID, "slug": slug}).Row(&used)
	return used, err
}

func copyGymFrom(app core.App, record *core.Record, parentCollection, parentField string) error {
	if parentID := record.GetString(parentField); parentID != "" {
		parent, err := app.FindRecordById(parentCollection, parentID)
		if err != nil {
			return apis.NewBadRequestError("Unknown "+parentField+".", nil)
		}
		if record.IsNew() && record.GetString("gym") != "" && record.GetString("gym") != parent.GetString("gym") {
			return apis.NewBadRequestError("The "+parentField+" belongs to another gym.", nil)
		}
		record.Set("gym", parent.GetString("gym"))
	}
	return rejectGymMove(record)
}

func rejectGymMove(record *core.Record) error {
	if !record.IsNew() && record.Original().GetString("gym") != record.GetString("gym") {
		return apis.NewBadRequestError("Records cannot move to another gym.", nil)
	}
	return nil
}

func reportedContentGym(app core.App, report *core.Record) string {
	content, err := app.FindRecordById(reportedContentCollection(report), report.GetString("content_id"))
	if err != nil {
		return ""
	}
	return content.GetString("gym")
}

func adoptOrphans(app core.App, gymID string) error {
	for _, table := range gymOwnedTables {
		if _, err := app.DB().NewQuery("UPDATE {{" + table + "}} SET [[gym]] = {:gym} WHERE [[gym]] = ''").
			Bind(dbx.Params{"gym": gymID}).Execute(); err != nil {
			return err
		}
	}
	return nil
}

func seedGymRoles(app core.App, gymID string) error {
	roles, err := app.FindCollectionByNameOrId("roles")
	if err != nil {
		return err
	}
	permissions, err := app.FindAllRecords("permissions")
	if err != nil {
		return err
	}
	for _, seed := range seededGymRoles {
		if _, err := app.FindFirstRecordByFilter(roles, "gym = {:gym} && name = {:name}", dbx.Params{"gym": gymID, "name": seed.name}); err == nil {
			continue
		}
		granted := []string{}
		for _, permission := range permissions {
			if seed.permissions == nil || slices.Contains(seed.permissions, permission.GetString("name")) {
				granted = append(granted, permission.Id)
			}
		}
		role := core.NewRecord(roles)
		role.Set("gym", gymID)
		role.Set("name", seed.name)
		role.Set("description", seed.description)
		role.Set("color", seed.color)
		role.Set("permissions", granted)
		if err := app.Save(role); err != nil {
			return err
		}
	}
	return nil
}

func gymSlug(app core.App, gymID string) string {
	gym, err := app.FindRecordById("gyms", gymID)
	if err != nil {
		return ""
	}
	return gym.GetString("slug")
}

func gymName(app core.App, gymID string) string {
	gym, err := app.FindRecordById("gyms", gymID)
	if err != nil {
		return ""
	}
	return gym.GetString("name")
}

func mailSubject(text, gymName, appName string) string {
	if gymName != "" {
		return text + " - " + gymName
	}
	return text + " - " + appName
}

func gymMailSubject(app core.App, gymID, text string) string {
	return mailSubject(text, gymName(app, gymID), app.Settings().Meta.AppName)
}

func gymPath(app core.App, gymID, path string) string {
	if slug := gymSlug(app, gymID); slug != "" {
		return "/" + slug + path
	}
	return path
}

func contactEmail(app core.App, gymID string) string {
	if gym, err := app.FindRecordById("gyms", gymID); err == nil && gym.GetString("contact_email") != "" {
		return gym.GetString("contact_email")
	}
	settings, err := app.FindRecordById("settings", platformSettingsID)
	if err != nil {
		return ""
	}
	return settings.GetString("contact_email")
}
