/// <reference path="../pb_data/types.d.ts" />
const MANAGE_USERS =
    '@request.auth.memberships_via_user.gym ?= gym && @request.auth.memberships_via_user.role.permissions.name ?= "manage_users"'
const PLATFORM_ADMIN = '@request.auth.platform_admin = true'

function setDeleteRule(app, rule) {
    const roles = app.findCollectionByNameOrId('roles')
    roles.deleteRule = rule
    app.save(roles)
}

migrate(
    (app) =>
        setDeleteRule(
            app,
            `(${MANAGE_USERS} || ${PLATFORM_ADMIN}) && name != "admin"`,
        ),
    (app) =>
        setDeleteRule(
            app,
            `(${MANAGE_USERS} && name != "admin") || ${PLATFORM_ADMIN}`,
        ),
)
