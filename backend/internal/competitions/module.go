package competitions

import (
	"gripello/internal/platform"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/tenancy"
)

type module struct {
	app   *platform.App
	perms *tenancy.Permissions
}

func Register(app *platform.App) {
	m := &module{app: app, perms: tenancy.New(app.DB)}
	for pattern, handler := range map[string]httpx.Handler{
		"GET /gyms/{gym}/competitions":        m.listCompetitions,
		"POST /gyms/{gym}/competitions":       m.postCompetition,
		"GET /competitions/{id}":              m.getCompetition,
		"PATCH /competitions/{id}":            m.patchCompetition,
		"POST /competitions/{id}/publish":     m.publishCompetition,
		"DELETE /competitions/{id}":           m.deleteCompetitionHandler,
		"GET /competitions/{id}/categories":   m.listCategories,
		"POST /competitions/{id}/categories":  m.postCategory,
		"PATCH /competition-categories/{id}":  m.patchCategory,
		"DELETE /competition-categories/{id}": m.deleteCategoryHandler,
		"GET /competitions/{id}/routes":       m.listRoutes,
		"POST /competitions/{id}/routes":      m.postRoute,
		"PATCH /competition-routes/{id}":      m.patchRoute,
		"DELETE /competition-routes/{id}":     m.deleteRouteHandler,
		"GET /competitions/{id}/entries":      m.listEntries,
		"POST /competitions/{id}/entries":     m.postEntry,
		"PATCH /competition-entries/{id}":     m.patchEntry,
		"DELETE /competition-entries/{id}":    m.deleteEntryHandler,
		"GET /competitions/{id}/scores":       m.listScores,
		"PUT /competitions/{id}/scores":       m.putScores,
		"DELETE /competition-scores/{id}":     m.deleteScoreHandler,
		"GET /competitions/{id}/standings":    m.getStandings,
		"GET /competitions/{id}/results":      m.getResults,
	} {
		app.Handle(pattern, handler)
	}
}
