package gyms

import (
	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/tenancy"
)

type module struct {
	db    *pgxpool.Pool
	perms *tenancy.Permissions
	blob  platform.BlobStore
}

func Register(app *platform.App) {
	m := &module{db: app.DB, perms: tenancy.New(app.DB), blob: app.Blob}
	app.Handle("GET /gyms", httpx.Handler(m.listGyms))
	app.Handle("GET /gyms/{gym}", httpx.Handler(m.getGym))
	app.Handle("POST /gyms", httpx.Handler(m.createGym))
	app.Handle("PATCH /gyms/{gym}", httpx.Handler(m.updateGym))
	app.Handle("DELETE /gyms/{gym}", httpx.Handler(m.deleteGym))
	app.Handle("GET /settings", httpx.Handler(m.getSettings))
	app.Handle("PATCH /settings", httpx.Handler(m.updateSettings))
	app.Handle("GET /permissions", httpx.Handler(m.listPermissions))
}
