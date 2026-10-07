package hooks

import (
	"net/http"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

const contributionsLimit = 200

type contributionRoute struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
	Grade string `json:"grade"`
	Gym   string `json:"gym"`
}

type contribution struct {
	ID      string             `json:"id"`
	Created string             `json:"created"`
	Rating  float64            `json:"rating,omitempty"`
	Comment string             `json:"comment,omitempty"`
	URL     string             `json:"url,omitempty"`
	File    string             `json:"file,omitempty"`
	Route   *contributionRoute `json:"route"`
}

func registerContributions(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.GET("/api/account/contributions", func(e *core.RequestEvent) error {
			reviews, err := ownContributions(e.App, "ratings", "route_id", e.Auth.Id)
			if err != nil {
				return e.InternalServerError("", err)
			}
			betas, err := ownContributions(e.App, "beta_videos", "route", e.Auth.Id)
			if err != nil {
				return e.InternalServerError("", err)
			}
			return e.JSON(http.StatusOK, map[string]any{"reviews": reviews, "betas": betas})
		}).Bind(apis.RequireAuth("users"))
		return se.Next()
	})
}

func ownContributions(app core.App, collection, routeField, userID string) ([]contribution, error) {
	records, err := app.FindRecordsByFilter(collection, "user = {:user}", "-created", contributionsLimit, 0, dbx.Params{"user": userID})
	if err != nil {
		return nil, err
	}
	if errs := app.ExpandRecords(records, []string{routeField}, nil); len(errs) > 0 {
		for _, err := range errs {
			return nil, err
		}
	}
	items := make([]contribution, 0, len(records))
	for _, record := range records {
		item := contribution{
			ID:      record.Id,
			Created: record.GetDateTime("created").String(),
			Rating:  record.GetFloat("rating"),
			Comment: record.GetString("comment"),
			URL:     record.GetString("url"),
			File:    record.GetString("file"),
		}
		if route := record.ExpandedOne(routeField); route != nil {
			item.Route = &contributionRoute{ID: route.Id, Name: route.GetString("name"), Color: route.GetString("color"), Grade: route.GetString("grade"), Gym: route.GetString("gym")}
		}
		items = append(items, item)
	}
	return items, nil
}
