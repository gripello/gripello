/// <reference path="../pb_data/types.d.ts" />
const OWNER = '@request.auth.id != "" && user = @request.auth.id'

migrate(
    (app) => {
        const users = app.findCollectionByNameOrId('users')
        users.fields.add(
            new Field({
                id: 'json_users_notification_prefs',
                name: 'notification_prefs',
                type: 'json',
                maxSize: 4000,
                required: false,
            }),
        )
        users.fields.add(
            new Field({
                id: 'relation_users_followed_walls',
                name: 'followed_walls',
                type: 'relation',
                collectionId: 'pbc_walls',
                cascadeDelete: false,
                maxSelect: 999,
                required: false,
            }),
        )
        app.save(users)

        app.save(
            new Collection({
                id: 'pbc_push_subscriptions',
                name: 'push_subscriptions',
                type: 'base',
                listRule: OWNER,
                viewRule: OWNER,
                createRule:
                    '@request.auth.id != "" && @request.body.user = @request.auth.id',
                updateRule: null,
                deleteRule: OWNER,
                fields: [
                    {
                        id: 'relation_push_user',
                        name: 'user',
                        type: 'relation',
                        collectionId: '_pb_users_auth_',
                        cascadeDelete: true,
                        maxSelect: 1,
                        required: true,
                    },
                    {
                        id: 'text_push_endpoint',
                        name: 'endpoint',
                        type: 'url',
                        required: true,
                    },
                    {
                        id: 'text_push_p256dh',
                        name: 'p256dh',
                        type: 'text',
                        max: 200,
                        required: true,
                    },
                    {
                        id: 'text_push_auth',
                        name: 'auth',
                        type: 'text',
                        max: 100,
                        required: true,
                    },
                    {
                        id: 'text_push_device',
                        name: 'device',
                        type: 'text',
                        max: 100,
                        required: false,
                    },
                    {
                        id: 'autodate_push_created',
                        name: 'created',
                        type: 'autodate',
                        onCreate: true,
                        onUpdate: false,
                    },
                ],
                indexes: [
                    'CREATE UNIQUE INDEX `idx_push_subscriptions_endpoint` ON `push_subscriptions` (`endpoint`)',
                    'CREATE INDEX `idx_push_subscriptions_user` ON `push_subscriptions` (`user`)',
                ],
            }),
        )
    },
    (app) => {
        app.delete(app.findCollectionByNameOrId('push_subscriptions'))
        const users = app.findCollectionByNameOrId('users')
        users.fields.removeById('json_users_notification_prefs')
        users.fields.removeById('relation_users_followed_walls')
        app.save(users)
    },
)
