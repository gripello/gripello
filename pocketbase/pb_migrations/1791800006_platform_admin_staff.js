/// <reference path="../pb_data/types.d.ts" />
const PLATFORM_ADMIN = '@request.auth.platform_admin = true'
const SUFFIX = ` || ${PLATFORM_ADMIN}`

const RULES = {
    users: ['listRule', 'viewRule'],
    memberships: ['listRule', 'viewRule', 'deleteRule'],
    roles: ['deleteRule'],
    locations: ['createRule', 'updateRule', 'deleteRule'],
    walls: ['createRule', 'updateRule', 'deleteRule'],
}

const orAdmin = (rule) =>
    rule === null ? PLATFORM_ADMIN : `(${rule})${SUFFIX}`
const withoutAdmin = (rule) =>
    rule === PLATFORM_ADMIN ? null : rule.slice(1, -`)${SUFFIX}`.length)

function rewrite(app, wrap) {
    for (const [name, keys] of Object.entries(RULES)) {
        const collection = app.findCollectionByNameOrId(name)
        for (const key of keys) collection[key] = wrap(collection[key])
        app.save(collection)
    }
}

migrate(
    (app) => rewrite(app, orAdmin),
    (app) => rewrite(app, withoutAdmin),
)
