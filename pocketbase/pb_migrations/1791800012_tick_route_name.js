/// <reference path="../pb_data/types.d.ts" />
const LOCK = ' && @request.body.route_name:changed = false'

migrate(
    (app) => {
        const ticks = app.findCollectionByNameOrId('ticks_col_id')
        ticks.fields.add(
            new Field({
                id: 'text_tick_route_name',
                name: 'route_name',
                type: 'text',
                max: 200,
            }),
        )
        ticks.updateRule = `${ticks.updateRule}${LOCK}`
        app.save(ticks)
        app.db()
            .newQuery(
                "UPDATE ticks SET route_name = COALESCE((SELECT name FROM routes WHERE routes.id = ticks.route), '')",
            )
            .execute()
    },
    (app) => {
        const ticks = app.findCollectionByNameOrId('ticks_col_id')
        ticks.fields.removeById('text_tick_route_name')
        ticks.updateRule = ticks.updateRule.slice(0, -LOCK.length)
        app.save(ticks)
    },
)
