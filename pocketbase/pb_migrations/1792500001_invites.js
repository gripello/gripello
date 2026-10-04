/// <reference path="../pb_data/types.d.ts" />
const MANAGE_USERS =
    '(@request.auth.memberships_via_user.gym ?= gym && @request.auth.memberships_via_user.role.permissions.name ?= "manage_users") || @request.auth.platform_admin = true'

// prettier-ignore
const RATE_LIMITS = [
    { label: 'POST /api/gyms/', audience: '@auth', duration: 3600, maxRequests: 50 },
    { label: 'GET /api/invites/',  audience: '', duration: 600, maxRequests: 30 },
    { label: 'POST /api/invites/', audience: '', duration: 600, maxRequests: 10 },
]

function relation(name, collectionId, cascadeDelete) {
    return {
        id: `relation_invites_${name}`,
        name,
        type: 'relation',
        collectionId,
        cascadeDelete,
        maxSelect: 1,
        required: true,
    }
}

migrate(
    (app) => {
        const invites = new Collection({
            id: 'invites_col_id',
            name: 'invites',
            type: 'base',
            listRule: MANAGE_USERS,
            viewRule: MANAGE_USERS,
            createRule: null,
            updateRule: null,
            deleteRule: MANAGE_USERS,
            fields: [
                {
                    autogeneratePattern: '[a-z0-9]{15}',
                    id: 'text3208210256',
                    max: 15,
                    min: 15,
                    name: 'id',
                    pattern: '^[a-z0-9]+$',
                    primaryKey: true,
                    required: true,
                    system: true,
                    type: 'text',
                },
                relation('gym', 'gyms_col_id', true),
                relation(
                    'role',
                    app.findCollectionByNameOrId('roles').id,
                    true,
                ),
                {
                    id: 'email_invites_email',
                    name: 'email',
                    type: 'email',
                    required: true,
                    presentable: true,
                },
                {
                    id: 'text_invites_firstname',
                    name: 'firstname',
                    type: 'text',
                    max: 100,
                },
                {
                    id: 'text_invites_name',
                    name: 'name',
                    type: 'text',
                    max: 100,
                },
                {
                    id: 'text_invites_token_hash',
                    name: 'token_hash',
                    type: 'text',
                    max: 64,
                    hidden: true,
                    required: true,
                },
                {
                    id: 'date_invites_expires_at',
                    name: 'expires_at',
                    type: 'date',
                    required: true,
                },
                {
                    id: 'autodate_invites_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'autodate_invites_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_invites_gym_email` ON `invites` (`gym`, `email`)',
                'CREATE UNIQUE INDEX `idx_invites_token_hash` ON `invites` (`token_hash`)',
            ],
        })
        app.save(invites)

        const settings = app.settings()
        const labels = RATE_LIMITS.map((rule) => rule.label)
        settings.rateLimits.rules = [
            ...settings.rateLimits.rules.filter(
                (rule) => !labels.includes(rule.label),
            ),
            ...RATE_LIMITS,
        ]
        app.save(settings)
    },
    (app) => {
        const settings = app.settings()
        const labels = RATE_LIMITS.map((rule) => rule.label)
        settings.rateLimits.rules = settings.rateLimits.rules.filter(
            (rule) => !labels.includes(rule.label),
        )
        app.save(settings)
        app.delete(app.findCollectionByNameOrId('invites_col_id'))
    },
)
