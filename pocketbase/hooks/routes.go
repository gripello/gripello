package hooks

import (
	"net/http"
	"slices"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

func registerRouteArchiveStamp(app core.App) {
	stamp := func(e *core.RecordEvent) error {
		e.Record.Set("archived_at", archivedAt(
			e.Record.Original().GetBool("archived"),
			e.Record.GetBool("archived"),
			e.Record.Original().GetDateTime("archived_at"),
			types.NowDateTime(),
		))
		return e.Next()
	}
	app.OnRecordCreate("routes").BindFunc(stamp)
	app.OnRecordUpdate("routes").BindFunc(stamp)

	app.OnRecordUpdateRequest("routes").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() || (e.Auth != nil && hasPermission(e.App, e.Auth.Id, e.Record.Original().GetString("gym"), "manage_routes")) {
			return e.Next()
		}
		if !onlyArchiveChanged(changedFieldNames(e.Record.Original().FieldsData(), e.Record.FieldsData())) {
			return apis.NewForbiddenError("Inventory may only archive or restore routes.", nil)
		}
		return e.Next()
	})
}

func onlyArchiveChanged(changedFields []string) bool {
	return !slices.ContainsFunc(changedFields, func(field string) bool {
		return field != "archived"
	})
}

func archivedAt(wasArchived, isArchived bool, current, now types.DateTime) types.DateTime {
	if !isArchived {
		return types.DateTime{}
	}
	if !wasArchived || current.IsZero() {
		return now
	}
	return current
}

const maxImportedRatings = 500

func registerRatingImport(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.POST("/api/import/ratings", func(e *core.RequestEvent) error {
			var body struct {
				Gym     string           `json:"gym"`
				Ratings []map[string]any `json:"ratings"`
			}
			if err := e.BindBody(&body); err != nil {
				return e.BadRequestError("Invalid import payload.", err)
			}
			if !hasPermission(e.App, e.Auth.Id, body.Gym, "manage_routes") {
				return e.ForbiddenError("Importing ratings requires manage_routes.", nil)
			}
			if len(body.Ratings) > maxImportedRatings {
				return e.BadRequestError("Too many ratings in one request.", nil)
			}
			collection, err := e.App.FindCachedCollectionByNameOrId("ratings")
			if err != nil {
				return err
			}
			failed := 0
			for _, data := range body.Ratings {
				created := importedRatingDate(data["created"], types.NowDateTime())
				for _, key := range []string{"id", "gym", "user", "created", "updated"} {
					delete(data, key)
				}
				record := core.NewRecord(collection)
				record.Load(data)
				if !created.IsZero() {
					record.SetRaw("created", created)
					record.SetRaw("updated", created)
				}
				if route, err := e.App.FindRecordById("routes", record.GetString("route_id")); err != nil || route.GetString("gym") != body.Gym {
					failed++
					continue
				}
				if err := e.App.Save(record); err != nil {
					failed++
				}
			}
			return e.JSON(http.StatusOK, map[string]int{"failed": failed})
		}).Bind(apis.RequireAuth("users"))
		return se.Next()
	})
}

func importedRatingDate(value any, now types.DateTime) types.DateTime {
	date, err := types.ParseDateTime(value)
	if err != nil || date.IsZero() || date.After(now) {
		return types.DateTime{}
	}
	return date
}
