/// <reference path="../pb_data/types.d.ts" />
const SUFFIX = ' || @request.auth.platform_admin = true'

function rewrite(app, wrap) {
    const auditLogs = app.findCollectionByNameOrId('audit_logs')
    auditLogs.listRule = wrap(auditLogs.listRule)
    auditLogs.viewRule = wrap(auditLogs.viewRule)
    app.save(auditLogs)
}

migrate(
    (app) => rewrite(app, (rule) => `(${rule})${SUFFIX}`),
    (app) => rewrite(app, (rule) => rule.slice(1, -`)${SUFFIX}`.length)),
)
