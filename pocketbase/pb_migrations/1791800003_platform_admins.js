/// <reference path="../pb_data/types.d.ts" />
const PLATFORM_ADMIN = '@request.auth.platform_admin = true'
const FLAG_UNTOUCHED = '@request.body.platform_admin:isset = false'

const orAdmin = (rule) =>
    rule === null ? PLATFORM_ADMIN : `(${rule}) || ${PLATFORM_ADMIN}`
const withoutAdmin = (rule) =>
    rule === PLATFORM_ADMIN
        ? null
        : rule.slice(1, -`) || ${PLATFORM_ADMIN}`.length)
const GYMLESS_FOR_ADMIN = `(gym = "" && ${PLATFORM_ADMIN})`
const orGymless = (rule) => `(${rule}) || ${GYMLESS_FOR_ADMIN}`
const withoutGymless = (rule) =>
    rule.slice(1, -`) || ${GYMLESS_FOR_ADMIN}`.length)
const andUntouched = (rule) => `(${rule}) && ${FLAG_UNTOUCHED}`
const withoutUntouched = (rule) =>
    rule.slice(1, -`) && ${FLAG_UNTOUCHED}`.length)

const ADMIN_RULES = {
    gyms: ['createRule', 'updateRule', 'deleteRule'],
    memberships: ['createRule', 'updateRule'],
    roles: ['createRule', 'updateRule'],
}

function rewrite(app, wrapAdmin, wrapUser, wrapAudit) {
    for (const [name, keys] of Object.entries(ADMIN_RULES)) {
        const collection = app.findCollectionByNameOrId(name)
        for (const key of keys) collection[key] = wrapAdmin(collection[key])
        app.save(collection)
    }
    const users = app.findCollectionByNameOrId('users')
    users.createRule = wrapUser(users.createRule)
    users.updateRule = wrapUser(users.updateRule)
    app.save(users)
    const auditLogs = app.findCollectionByNameOrId('audit_logs')
    auditLogs.listRule = wrapAudit(auditLogs.listRule)
    auditLogs.viewRule = wrapAudit(auditLogs.viewRule)
    app.save(auditLogs)
}

migrate(
    (app) => {
        const users = app.findCollectionByNameOrId('users')
        users.fields.add(
            new Field({
                id: 'bool_users_platform_admin',
                name: 'platform_admin',
                type: 'bool',
            }),
        )
        app.save(users)
        rewrite(app, orAdmin, andUntouched, orGymless)
    },
    (app) => {
        rewrite(app, withoutAdmin, withoutUntouched, withoutGymless)
        const users = app.findCollectionByNameOrId('users')
        users.fields.removeById('bool_users_platform_admin')
        app.save(users)
    },
)
