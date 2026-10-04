/// <reference path="../pb_data/types.d.ts" />
const KINDS = ['defect', 'reset', 'maintenance', 'other']

migrate(
    (app) => {
        const tasks = app.findCollectionByNameOrId('tasks_col_id')
        tasks.fields.getByName('kind').values = [...KINDS, 'wish']
        tasks.fields.add(
            new Field({
                id: 'select_tasks_route_type',
                name: 'route_type',
                type: 'select',
                maxSelect: 1,
                required: false,
                values: ['Route', 'Boulder'],
            }),
        )
        tasks.fields.add(
            new Field({
                id: 'text_tasks_grade',
                name: 'grade',
                type: 'text',
                max: 10,
                required: false,
            }),
        )
        app.save(tasks)
    },
    (app) => {
        app.db().newQuery("DELETE FROM tasks WHERE kind = 'wish'").execute()
        const tasks = app.findCollectionByNameOrId('tasks_col_id')
        tasks.fields.getByName('kind').values = KINDS
        tasks.fields.removeById('select_tasks_route_type')
        tasks.fields.removeById('text_tasks_grade')
        app.save(tasks)
    },
)
