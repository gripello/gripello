/// <reference path="../pb_data/types.d.ts" />
migrate(
    (app) => {
        const gyms = app.findCollectionByNameOrId('gyms_col_id')
        gyms.fields.addAt(
            gyms.fields.length,
            new Field({
                id: 'json_gyms_previous_slugs',
                name: 'previous_slugs',
                type: 'json',
                maxSize: 5000,
            }),
        )
        app.save(gyms)
        app.db().newQuery("UPDATE gyms SET previous_slugs = '[]'").execute()
    },
    (app) => {
        const gyms = app.findCollectionByNameOrId('gyms_col_id')
        gyms.fields.removeById('json_gyms_previous_slugs')
        app.save(gyms)
    },
)
