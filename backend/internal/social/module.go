package social

import (
	"net/http"
	"time"

	"gripello/internal/platform"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ratelimit"
)

const (
	climberLookupsPerMinute  = 120
	climberSearchesPerMinute = 30
	followChangesPerHour     = 60
)

type module struct {
	app      *platform.App
	lookups  *ratelimit.Limiter
	searches *ratelimit.Limiter
	follows  *ratelimit.Limiter
}

func Register(app *platform.App) { newModule(app) }

func newModule(app *platform.App) *module {
	m := &module{
		app:      app,
		lookups:  ratelimit.New(climberLookupsPerMinute, time.Minute),
		searches: ratelimit.New(climberSearchesPerMinute, time.Minute),
		follows:  ratelimit.New(followChangesPerHour, time.Hour),
	}
	for pattern, handler := range map[string]httpx.Handler{
		"GET /climbers":             m.limited(m.listClimbers),
		"GET /climbers/{id}":        m.limited(m.getClimber),
		"GET /me/follows":           m.listFollows,
		"POST /follows":             m.postFollow,
		"POST /follows/{id}/accept": m.acceptFollow,
		"DELETE /follows/{id}":      m.deleteFollow,
		"GET /me/blocks":            m.listBlocks,
		"POST /blocks":              m.postBlock,
		"DELETE /blocks/{id}":       m.deleteBlock,
	} {
		app.Handle(pattern, handler)
	}
	return m
}

// limited requires a signed-in caller and limits per user: PocketBase limited by IP, which a whole gym shares over its WiFi.
func (m *module) limited(h httpx.Handler) httpx.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		principal, err := auth.Require(r.Context())
		if err != nil {
			return err
		}
		if err := m.lookups.Check(w, principal.UserID); err != nil {
			return err
		}
		return h(w, r)
	}
}
