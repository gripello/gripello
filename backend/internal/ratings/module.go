package ratings

import (
	"context"
	"encoding/json"

	"gripello/internal/platform"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/climbers"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/tenancy"
)

const (
	permManageComments = "manage_comments"
	permManageRoutes   = "manage_routes"
)

type module struct {
	app      *platform.App
	perms    *tenancy.Permissions
	climbers *climbers.Lookup
}

func Register(app *platform.App) {
	m := &module{app: app, perms: tenancy.New(app.DB), climbers: climbers.New(app.DB)}
	for pattern, handler := range map[string]httpx.Handler{
		"GET /routes/{id}/ratings":        m.listRouteRatings,
		"POST /routes/{id}/ratings":       m.postRating,
		"PATCH /ratings/{id}":             m.patchRating,
		"DELETE /ratings/{id}":            m.deleteRating,
		"GET /gyms/{gym}/ratings":         m.listGymRatings,
		"GET /gyms/{gym}/ratings/stats":   m.getStats,
		"POST /gyms/{gym}/ratings/import": m.importRatings,
		"GET /gyms/{gym}/betas":           m.listGymBetas,
		"GET /routes/{id}/betas":          m.listBetas,
		"POST /routes/{id}/betas":         m.postBeta,
		"DELETE /betas/{id}":              m.deleteBeta,
	} {
		app.Handle(pattern, handler)
	}
	app.Bus.Subscribe("user:", m.forgetClimber)
}

func (m *module) forgetClimber(e events.Event) {
	if e.Kind != "user.updated" {
		return
	}
	var change struct {
		Record struct {
			ID string `json:"id"`
		} `json:"record"`
	}
	if json.Unmarshal(e.Payload, &change) == nil && change.Record.ID != "" {
		m.climbers.Forget(change.Record.ID)
	}
}

func (m *module) can(ctx context.Context, gym, permission string) bool {
	p, ok := auth.From(ctx)
	return ok && m.perms.Can(ctx, p.UserID, gym, permission)
}

func (m *module) require(ctx context.Context, gym, permission string) error {
	if _, err := auth.Require(ctx); err != nil {
		return err
	}
	if !m.can(ctx, gym, permission) {
		return httpx.ErrForbidden
	}
	return nil
}

// authors resolves climbers for user ids; reviews drop authors who chose reviews_anonymous, betas never do.
func (m *module) authors(ctx context.Context, userIDs []string, honourAnonymous bool) (map[string]climbers.Climber, error) {
	var ids []string
	for _, id := range userIDs {
		if id != "" {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil, nil
	}
	found, err := m.climbers.Get(ctx, ids)
	if err != nil || !honourAnonymous {
		return found, err
	}
	anonymous, err := anonymousAuthors(ctx, m.app.DB, ids)
	for id := range anonymous {
		delete(found, id)
	}
	return found, err
}

// enrichRatings adds author and mine for signed-in viewers, like PocketBase's OnRecordEnrich did; staff lists pass honourAnonymous=false.
func (m *module) enrichRatings(ctx context.Context, items []Rating, honourAnonymous bool) error {
	viewer, ok := auth.From(ctx)
	if !ok {
		return nil
	}
	userIDs := make([]string, len(items))
	for i, r := range items {
		userIDs[i] = r.User
	}
	found, err := m.authors(ctx, userIDs, honourAnonymous)
	if err != nil {
		return err
	}
	for i, r := range items {
		if r.User == "" {
			continue
		}
		mine := r.User == viewer.UserID
		items[i].Mine = &mine
		if c, ok := found[r.User]; ok {
			items[i].Author = &c
		}
	}
	return nil
}

func (m *module) enrichBetas(ctx context.Context, items []BetaVideo) error {
	if _, ok := auth.From(ctx); !ok {
		return nil
	}
	userIDs := make([]string, len(items))
	for i, b := range items {
		userIDs[i] = b.User
	}
	found, err := m.authors(ctx, userIDs, false)
	if err != nil {
		return err
	}
	for i, b := range items {
		if c, ok := found[b.User]; ok {
			items[i].Author = &c
		}
	}
	return nil
}
