/// <reference path="../pb_data/types.d.ts" />
const AVERAGE_RATING_VIEW = 'vcfw600rzblhed3'

function setViewColumn(app, from, to) {
    const view = app.findCollectionByNameOrId(AVERAGE_RATING_VIEW)
    view.viewQuery = view.viewQuery.replace(from, to)
    app.save(view)
}

migrate(
    (app) => {
        const routes = app.findCollectionByNameOrId('routes')
        routes.fields.add(
            new Field({
                id: 'bool_routes_permanent',
                name: 'permanent',
                type: 'bool',
                required: false,
            }),
        )
        app.save(routes)
        setViewColumn(
            app,
            '    routes.archived,\n',
            '    routes.archived,\n    routes.permanent,\n',
        )
    },
    (app) => {
        setViewColumn(app, '    routes.permanent,\n', '')
        const routes = app.findCollectionByNameOrId('routes')
        routes.fields.removeById('bool_routes_permanent')
        app.save(routes)
    },
)
