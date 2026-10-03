/// <reference path="../pb_data/types.d.ts" />
migrate(
    (app) => {
        app.save(
            new Collection({
                id: 'retired_slugs_col_id',
                name: 'retired_slugs',
                type: 'base',
                listRule: null,
                viewRule: null,
                createRule: null,
                updateRule: null,
                deleteRule: null,
                fields: [
                    {
                        autogeneratePattern: '[a-z0-9]{15}',
                        id: 'text_retired_slugs_id',
                        max: 15,
                        min: 15,
                        name: 'id',
                        pattern: '^[a-z0-9]+$',
                        primaryKey: true,
                        required: true,
                        system: true,
                        type: 'text',
                    },
                    {
                        id: 'text_retired_slugs_slug',
                        name: 'slug',
                        type: 'text',
                        max: 40,
                        required: true,
                    },
                    {
                        id: 'text_retired_slugs_gym_name',
                        name: 'gym_name',
                        type: 'text',
                        max: 200,
                    },
                    {
                        id: 'autodate_retired_slugs_retired_at',
                        name: 'retired_at',
                        type: 'autodate',
                        onCreate: true,
                        onUpdate: false,
                    },
                ],
                indexes: [
                    'CREATE UNIQUE INDEX `idx_retired_slugs_slug` ON `retired_slugs` (`slug`)',
                ],
            }),
        )
    },
    (app) => {
        app.delete(app.findCollectionByNameOrId('retired_slugs_col_id'))
    },
)
