package routes

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
		"GET /gyms/{gym}/routes":           m.listRoutes,
		"POST /gyms/{gym}/routes":          m.postRoute,
		"GET /gyms/{gym}/routes/colors":    m.listColors,
		"POST /gyms/{gym}/routes/archive":  m.archiveGymRoutes,
		"PUT /gyms/{gym}/map/placements":   m.putPlacements,
		"GET /routes":                      m.listRoutesByID,
		"GET /walls":                       m.listWallsByID,
		"GET /routes/{id}":                 m.getRoute,
		"PATCH /routes/{id}":               m.patchRoute,
		"POST /routes/{id}/archive":        m.archiveRoute,
		"DELETE /routes/{id}":              m.deleteRouteHandler,
		"GET /gyms/{gym}/locations":        m.listLocations,
		"POST /gyms/{gym}/locations":       m.postLocation,
		"PATCH /locations/{id}":            m.patchLocation,
		"DELETE /locations/{id}":           m.deleteLocationHandler,
		"PUT /locations/{id}/floor-plan":   m.putFloorPlan,
		"PUT /locations/{id}/map-trace":    m.putMapTrace,
		"DELETE /locations/{id}/map-trace": m.deleteMapTrace,
		"GET /gyms/{gym}/walls":            m.listWalls,
		"POST /gyms/{gym}/walls":           m.postWall,
		"PATCH /walls/{id}":                m.patchWall,
		"DELETE /walls/{id}":               m.deleteWallHandler,
	} {
		app.Handle(pattern, handler)
	}
}
