/// <reference path="../pb_data/types.d.ts" />
function setRoleCascade(app, cascadeDelete) {
    const memberships = app.findCollectionByNameOrId('memberships')
    memberships.fields.getByName('role').cascadeDelete = cascadeDelete
    app.save(memberships)
}

migrate(
    (app) => setRoleCascade(app, false),
    (app) => setRoleCascade(app, true),
)
