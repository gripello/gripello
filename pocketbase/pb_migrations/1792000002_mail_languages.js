/// <reference path="../pb_data/types.d.ts" />
const LANGUAGES = ['en', 'de', 'nl', 'fr', 'es']
const FIELDS = [
    ['gyms', 'select_gyms_language'],
    ['reports', 'select_reports_language'],
]

migrate(
    (app) => {
        for (const [name, id] of FIELDS) {
            const collection = app.findCollectionByNameOrId(name)
            collection.fields.add(
                new Field({
                    id,
                    name: 'language',
                    type: 'select',
                    maxSelect: 1,
                    values: LANGUAGES,
                    required: false,
                }),
            )
            app.save(collection)
        }
    },
    (app) => {
        for (const [name, id] of FIELDS) {
            const collection = app.findCollectionByNameOrId(name)
            collection.fields.removeById(id)
            app.save(collection)
        }
    },
)
