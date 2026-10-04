/// <reference path="../pb_data/types.d.ts" />
const SELF = ' || user = @request.auth.id'

function setDeleteRule(app, wrap) {
    const memberships = app.findCollectionByNameOrId('memberships')
    memberships.deleteRule = wrap(memberships.deleteRule)
    app.save(memberships)
}

migrate(
    (app) => setDeleteRule(app, (rule) => `${rule}${SELF}`),
    (app) => setDeleteRule(app, (rule) => rule.slice(0, -SELF.length)),
)
