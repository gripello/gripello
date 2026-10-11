package ticks

import (
	"encoding/json"

	"gripello/internal/platform"
	"gripello/internal/platform/climbers"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/tenancy"
)

type module struct {
	app      *platform.App
	perms    *tenancy.Permissions
	climbers *climbers.Lookup
	boards   *boardCache
}

func Register(app *platform.App) { newModule(app) }

func newModule(app *platform.App) *module {
	m := &module{app: app, perms: tenancy.New(app.DB), climbers: climbers.New(app.DB), boards: newBoardCache()}
	for pattern, handler := range map[string]httpx.Handler{
		"GET /me/ticks":               m.listOwnTicks,
		"GET /me/ticks/sends":         m.listSends,
		"POST /me/ticks":              m.postTick,
		"PATCH /ticks/{id}":           m.patchTick,
		"DELETE /ticks/{id}":          m.deleteTickHandler,
		"GET /me/feed":                m.listFeed,
		"GET /climbers/{id}/ticks":    m.listClimberTicks,
		"GET /gyms/{gym}/leaderboard": m.getLeaderboard,
		"GET /gyms/{gym}/seasons":     m.listSeasons,
		"POST /gyms/{gym}/seasons":    m.postSeason,
		"PATCH /seasons/{id}":         m.patchSeason,
		"DELETE /seasons/{id}":        m.deleteSeasonHandler,
	} {
		app.Handle(pattern, handler)
	}
	app.Bus.Subscribe(TopicTickChanged, m.onTickChanged)
	app.Bus.Subscribe("user:", m.onUserEvent)
	return m
}

func (m *module) onTickChanged(e events.Event) {
	var change TickChanged
	if json.Unmarshal(e.Payload, &change) == nil {
		m.boards.forgetCovering(change.Gym, change.Date)
	}
}

// user.updated carries {record, changed}; without `changed` every profile update forgets the boards.
func (m *module) onUserEvent(e events.Event) {
	if e.Kind != "user.updated" {
		return
	}
	var update struct {
		Record struct {
			ID string `json:"id"`
		} `json:"record"`
		Changed []string `json:"changed"`
	}
	if json.Unmarshal(e.Payload, &update) != nil {
		return
	}
	m.climbers.Forget(update.Record.ID)
	if touchesLeaderboard(update.Changed) {
		m.boards.forgetAll()
	}
}
