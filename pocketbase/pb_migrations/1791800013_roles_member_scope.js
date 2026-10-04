/// <reference path="../pb_data/types.d.ts" />
const MEMBER_OR_PLATFORM_ADMIN =
    '@request.auth.memberships_via_user.gym ?= gym || @request.auth.platform_admin = true'
const SIGNED_IN = '@request.auth.id != ""'

function setReadRules(app, rule) {
    const roles = app.findCollectionByNameOrId('roles')
    roles.listRule = rule
    roles.viewRule = rule
    app.save(roles)
}

migrate(
    (app) => setReadRules(app, MEMBER_OR_PLATFORM_ADMIN),
    (app) => setReadRules(app, SIGNED_IN),
)
