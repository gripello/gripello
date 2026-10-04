/// <reference path="../pb_data/types.d.ts" />
const PLATFORM_ADMIN = '@request.auth.platform_admin = true'

migrate(
    (app) => {
        app.save(
            new Collection({
                name: 'gym_stats',
                type: 'view',
                listRule: PLATFORM_ADMIN,
                viewRule: PLATFORM_ADMIN,
                viewQuery: `SELECT
    gyms.id,
    CAST((SELECT COUNT(*) FROM memberships WHERE memberships.gym = gyms.id) AS INTEGER) AS members,
    CAST((SELECT COUNT(*) FROM routes WHERE routes.gym = gyms.id AND routes.archived = FALSE) AS INTEGER) AS routes
FROM gyms`,
            }),
        )
    },
    (app) => {
        app.delete(app.findCollectionByNameOrId('gym_stats'))
    },
)
