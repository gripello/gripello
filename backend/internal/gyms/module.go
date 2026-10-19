package gyms

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/tenancy"
)

type module struct {
	app   *platform.App
	db    *pgxpool.Pool
	perms *tenancy.Permissions
	blob  platform.BlobStore
}

func Register(app *platform.App) {
	m := &module{app: app, db: app.DB, perms: tenancy.New(app.DB), blob: app.Blob}
	app.Handle("GET /gyms", httpx.Handler(m.listGyms))
	app.Handle("GET /gyms/{gym}", httpx.Handler(m.getGym))
	app.Handle("POST /gyms", httpx.Handler(m.createGym))
	app.Handle("PATCH /gyms/{gym}", httpx.Handler(m.updateGym))
	app.Handle("DELETE /gyms/{gym}", httpx.Handler(m.deleteGym))
	app.Handle("GET /settings", httpx.Handler(m.getSettings))
	app.Handle("PATCH /settings", httpx.Handler(m.updateSettings))
	app.Handle("GET /permissions", httpx.Handler(m.listPermissions))
	app.Handle("GET /platform/retired-slugs", httpx.Handler(m.listRetiredSlugs))
	app.Handle("DELETE /platform/retired-slugs/{id}", httpx.Handler(m.freeRetiredSlug))
	app.Handle("GET /platform/gym-onboardings", httpx.Handler(m.listOnboardings))
	app.Handle("POST /platform/gym-onboardings", httpx.Handler(m.createOnboarding))
	app.Handle("DELETE /platform/gym-onboardings/{id}", httpx.Handler(m.deleteOnboarding))
	app.Handle("GET /gym-onboardings/{token}", httpx.Handler(m.showOnboarding))
	app.Handle("POST /gym-onboardings/{token}/redeem", httpx.Handler(m.redeemOnboarding))
	app.Cron.Add("gymTrials", "41 * * * *", func(ctx context.Context) error {
		if err := pruneOnboardings(ctx, app.DB); err != nil {
			return err
		}
		return m.remindTrials(ctx)
	})
}
