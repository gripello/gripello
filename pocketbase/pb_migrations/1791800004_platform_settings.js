/// <reference path="../pb_data/types.d.ts" />
const OLD_ID = 'settings_123456'
const NEW_ID = 'platformsetting'
const PLATFORM_ADMIN = '@request.auth.platform_admin = true'

function renameSettings(app, from, to) {
    app.db()
        .newQuery('UPDATE settings SET id = {:to} WHERE id = {:from}')
        .bind({ from, to })
        .execute()
    app.db()
        .newQuery(
            "UPDATE audit_logs SET record_id = {:to} WHERE collection_name = 'settings' AND record_id = {:from}",
        )
        .bind({ from, to })
        .execute()
}

function setUpdateRule(app, rule) {
    const settings = app.findCollectionByNameOrId('settings')
    settings.updateRule = rule
    app.save(settings)
}

migrate(
    (app) => {
        renameSettings(app, OLD_ID, NEW_ID)
        setUpdateRule(app, PLATFORM_ADMIN)
    },
    (app) => {
        setUpdateRule(app, null)
        renameSettings(app, NEW_ID, OLD_ID)
    },
)
