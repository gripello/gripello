/// <reference path="../pb_data/types.d.ts" />
const ACCOUNT_EXPORT_RATE_LIMIT = {
    label: 'GET /api/account/export',
    audience: '@auth',
    duration: 3600,
    maxRequests: 3,
}

migrate(
    (app) => {
        const settings = app.settings()
        settings.rateLimits.rules = [
            ...settings.rateLimits.rules.filter(
                (rule) => rule.label !== ACCOUNT_EXPORT_RATE_LIMIT.label,
            ),
            ACCOUNT_EXPORT_RATE_LIMIT,
        ]
        app.save(settings)
    },
    (app) => {
        const settings = app.settings()
        settings.rateLimits.rules = settings.rateLimits.rules.filter(
            (rule) => rule.label !== ACCOUNT_EXPORT_RATE_LIMIT.label,
        )
        app.save(settings)
    },
)
