/// <reference path="../pb_data/types.d.ts" />
const PLATFORM_ADMIN = '@request.auth.platform_admin = true'
const FLAG_UNTOUCHED = '@request.body.platform_admin:isset = false'
const PERSONAL_UNTOUCHED =
    '@request.body.notification_prefs:isset = false && @request.body.followed_walls:isset = false'

const RULES = {
    updateRule: `(id = @request.auth.id || (${PLATFORM_ADMIN} && ${PERSONAL_UNTOUCHED})) && ${FLAG_UNTOUCHED}`,
    deleteRule: `id = @request.auth.id || ${PLATFORM_ADMIN}`,
    manageRule: PLATFORM_ADMIN,
}

const PREVIOUS = {
    updateRule: `(id = @request.auth.id) && ${FLAG_UNTOUCHED}`,
    deleteRule: 'id = @request.auth.id',
    manageRule: null,
}

function apply(app, rules) {
    const users = app.findCollectionByNameOrId('users')
    for (const [key, rule] of Object.entries(rules)) users[key] = rule
    app.save(users)
}

migrate(
    (app) => apply(app, RULES),
    (app) => apply(app, PREVIOUS),
)
