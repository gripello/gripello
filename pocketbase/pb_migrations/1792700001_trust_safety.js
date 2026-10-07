/// <reference path="../pb_data/types.d.ts" />
const SIGNED_IN = '@request.auth.id != ""'
const PLATFORM_ADMIN = '@request.auth.platform_admin = true'
const MEMBER_WITH = (gym, permission) =>
    `@request.auth.memberships_via_user.gym ?= ${gym} && @request.auth.memberships_via_user.role.permissions.name ?= "${permission}"`
const MODERATORS = `${PLATFORM_ADMIN} || (gym != "" && ${MEMBER_WITH('gym', 'manage_comments')})`
const OWN_BLOCK = `${SIGNED_IN} && blocker = @request.auth.id`
const SUSPENSION_UNTOUCHED =
    '@request.body.suspended_until:isset = false && @request.body.suspension_reason:isset = false'
const REPORT_TYPES = ['rating', 'route', 'beta_video']
const REPORT_ADMIN_RULES = ['listRule', 'viewRule', 'updateRule']

const created = (collection) => ({
    id: `autodate_${collection}_created`,
    name: 'created',
    type: 'autodate',
    onCreate: true,
    onUpdate: false,
})
const updated = (collection) => ({
    id: `autodate_${collection}_updated`,
    name: 'updated',
    type: 'autodate',
    onCreate: true,
    onUpdate: true,
})
const userRelation = (id, name, extra = {}) => ({
    id,
    name,
    type: 'relation',
    collectionId: '_pb_users_auth_',
    cascadeDelete: true,
    maxSelect: 1,
    ...extra,
})

migrate(
    (app) => {
        app.save(
            new Collection({
                id: 'pbc_moderation_items',
                name: 'moderation_items',
                type: 'base',
                listRule: MODERATORS,
                viewRule: MODERATORS,
                createRule: null,
                updateRule: null,
                deleteRule: null,
                fields: [
                    {
                        id: 'relation_moderation_gym',
                        name: 'gym',
                        type: 'relation',
                        collectionId: 'gyms_col_id',
                        cascadeDelete: true,
                        maxSelect: 1,
                    },
                    {
                        id: 'select_moderation_content_type',
                        name: 'content_type',
                        type: 'select',
                        maxSelect: 1,
                        required: true,
                        values: [
                            'rating',
                            'beta_video',
                            'profile',
                            'competition_entry',
                            'task',
                        ],
                    },
                    {
                        id: 'text_moderation_content_id',
                        name: 'content_id',
                        type: 'text',
                        required: true,
                        max: 30,
                    },
                    userRelation('relation_moderation_author', 'author'),
                    {
                        id: 'json_moderation_snapshot',
                        name: 'snapshot',
                        type: 'json',
                        maxSize: 1000000,
                    },
                    {
                        id: 'file_moderation_files',
                        name: 'files',
                        type: 'file',
                        maxSelect: 4,
                        maxSize: 30 * 1024 * 1024,
                        protected: true,
                    },
                    {
                        id: 'select_moderation_state',
                        name: 'state',
                        type: 'select',
                        maxSelect: 1,
                        required: true,
                        values: ['unreviewed', 'approved', 'pending', 'hidden'],
                    },
                    {
                        id: 'select_moderation_hidden_by',
                        name: 'hidden_by',
                        type: 'select',
                        maxSelect: 1,
                        values: ['gym', 'platform'],
                    },
                    {
                        id: 'number_moderation_reports_count',
                        name: 'reports_count',
                        type: 'number',
                        min: 0,
                        onlyInt: true,
                    },
                    {
                        id: 'text_moderation_reason',
                        name: 'reason',
                        type: 'text',
                        max: 2000,
                    },
                    userRelation(
                        'relation_moderation_reviewed_by',
                        'reviewed_by',
                        {
                            cascadeDelete: false,
                        },
                    ),
                    {
                        id: 'date_moderation_reviewed_at',
                        name: 'reviewed_at',
                        type: 'date',
                    },
                    created('moderation'),
                    updated('moderation'),
                ],
                indexes: [
                    'CREATE UNIQUE INDEX `idx_moderation_content` ON `moderation_items` (`content_type`, `content_id`)',
                    'CREATE INDEX `idx_moderation_queue` ON `moderation_items` (`gym`, `state`, `reports_count`)',
                ],
            }),
        )

        app.save(
            new Collection({
                id: 'pbc_blocks',
                name: 'blocks',
                type: 'base',
                listRule: OWN_BLOCK,
                viewRule: OWN_BLOCK,
                createRule: `${SIGNED_IN} && @request.body.blocker = @request.auth.id && @request.body.blocked != @request.auth.id`,
                updateRule: null,
                deleteRule: OWN_BLOCK,
                fields: [
                    userRelation('relation_blocks_blocker', 'blocker', {
                        required: true,
                    }),
                    userRelation('relation_blocks_blocked', 'blocked', {
                        required: true,
                    }),
                    created('blocks'),
                ],
                indexes: [
                    'CREATE UNIQUE INDEX `idx_blocks_pair` ON `blocks` (`blocker`, `blocked`)',
                    'CREATE INDEX `idx_blocks_blocked` ON `blocks` (`blocked`)',
                ],
            }),
        )

        const users = app.findCollectionByNameOrId('users')
        users.fields.add(
            new Field({
                id: 'date_users_suspended_until',
                name: 'suspended_until',
                type: 'date',
            }),
            new Field({
                id: 'text_users_suspension_reason',
                name: 'suspension_reason',
                type: 'text',
                max: 2000,
            }),
        )
        users.updateRule = `(${users.updateRule}) && ${SUSPENSION_UNTOUCHED}`
        app.save(users)

        const gyms = app.findCollectionByNameOrId('gyms')
        gyms.fields.add(
            new Field({
                id: 'bool_gyms_premoderate_betas',
                name: 'premoderate_betas',
                type: 'bool',
            }),
        )
        app.save(gyms)

        const reports = app.findCollectionByNameOrId('reports')
        reports.fields.getByName('content_type').values = [
            ...REPORT_TYPES,
            'profile',
        ]
        reports.fields.getByName('gym').required = false
        for (const key of REPORT_ADMIN_RULES)
            reports[key] = `(${reports[key]}) || ${PLATFORM_ADMIN}`
        app.save(reports)
    },
    (app) => {
        app.db()
            .newQuery(
                "DELETE FROM reports WHERE content_type = 'profile' OR gym = ''",
            )
            .execute()
        const reports = app.findCollectionByNameOrId('reports')
        reports.fields.getByName('content_type').values = REPORT_TYPES
        reports.fields.getByName('gym').required = true
        for (const key of REPORT_ADMIN_RULES)
            reports[key] = reports[key].slice(
                1,
                -`) || ${PLATFORM_ADMIN}`.length,
            )
        app.save(reports)

        const gyms = app.findCollectionByNameOrId('gyms')
        gyms.fields.removeById('bool_gyms_premoderate_betas')
        app.save(gyms)

        const users = app.findCollectionByNameOrId('users')
        users.updateRule = users.updateRule.slice(
            1,
            -`) && ${SUSPENSION_UNTOUCHED}`.length,
        )
        users.fields.removeById('date_users_suspended_until')
        users.fields.removeById('text_users_suspension_reason')
        app.save(users)

        for (const id of ['pbc_blocks', 'pbc_moderation_items']) {
            app.delete(app.findCollectionByNameOrId(id))
        }
    },
)
