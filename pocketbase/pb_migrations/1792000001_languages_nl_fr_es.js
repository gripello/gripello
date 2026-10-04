/// <reference path="../pb_data/types.d.ts" />
const DROPPED = ['ru', 'tr', 'uk']

function setLanguages(app, values) {
    const users = app.findCollectionByNameOrId('users')
    users.fields.getById('select_users_language').values = values
    app.save(users)
}

migrate(
    (app) => {
        app.db()
            .newQuery(
                "UPDATE users SET language = '' WHERE language IN ({:a}, {:b}, {:c})",
            )
            .bind({ a: DROPPED[0], b: DROPPED[1], c: DROPPED[2] })
            .execute()
        setLanguages(app, ['en', 'de', 'nl', 'fr', 'es'])
    },
    (app) => {
        app.db()
            .newQuery(
                "UPDATE users SET language = '' WHERE language IN ('nl', 'fr', 'es')",
            )
            .execute()
        setLanguages(app, ['en', 'de', ...DROPPED])
    },
)
