/// <reference path="../pb_data/types.d.ts" />
const SIGNED_IN = '@request.auth.id != ""'
const MEMBER_WITH = (gym, permission) =>
    `@request.auth.memberships_via_user.gym ?= ${gym} && @request.auth.memberships_via_user.role.permissions.name ?= "${permission}"`
const EITHER_SIDE = `${SIGNED_IN} && (follower = @request.auth.id || followee = @request.auth.id)`
const OWNER = `${SIGNED_IN} && user = @request.auth.id`
const OWN_REVIEW = `(${OWNER})`
const PERSONAL_UNTOUCHED =
    '@request.body.notification_prefs:isset = false && @request.body.followed_walls:isset = false'
const PRIVACY_UNTOUCHED = `${PERSONAL_UNTOUCHED} && @request.body.leaderboard_hidden:isset = false && @request.body.follow_policy:isset = false && @request.body.reviews_anonymous:isset = false && @request.body.ticks_private:isset = false`
const FRIEND_TICKS_QUERY =
    "SELECT ticks.id, follows.follower AS viewer, ticks.user, ticks.route, ticks.route_name, ticks.type, ticks.attempts, ticks.date, ticks.grade, ticks.grade_system, ticks.grade_index, ticks.created FROM follows JOIN ticks ON ticks.user = follows.followee JOIN users ON users.id = ticks.user WHERE follows.status = 'accepted' AND users.ticks_private = FALSE"
const REPORT_TYPES = ['rating', 'route']
const RATE_LIMITS = [
    {
        label: 'follows:create',
        audience: '@auth',
        duration: 3600,
        maxRequests: 60,
    },
    {
        label: 'beta_videos:create',
        audience: '@auth',
        duration: 3600,
        maxRequests: 10,
    },
]
const LOOKUP_INDEXES = {
    ticks: 'CREATE INDEX `idx_ticks_route` ON `ticks` (`route`)',
    routes: 'CREATE INDEX `idx_routes_wall` ON `routes` (`wall`)',
    ratings: 'CREATE INDEX `idx_ratings_user` ON `ratings` (`user`)',
    tasks: 'CREATE INDEX `idx_tasks_reporter` ON `tasks` (`reporter`)',
}
const USER_FIELDS = [
    {
        id: 'bool_users_leaderboard_hidden',
        name: 'leaderboard_hidden',
        type: 'bool',
    },
    {
        id: 'select_users_follow_policy',
        name: 'follow_policy',
        type: 'select',
        maxSelect: 1,
        values: ['approve', 'open', 'closed'],
    },
    {
        id: 'bool_users_reviews_anonymous',
        name: 'reviews_anonymous',
        type: 'bool',
    },
    { id: 'bool_users_ticks_private', name: 'ticks_private', type: 'bool' },
    {
        id: 'file_users_banner',
        name: 'banner',
        type: 'file',
        maxSelect: 1,
        maxSize: 5242880,
        mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        thumbs: ['1600x400'],
    },
]
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
const userRelation = (id, extra = {}) => ({
    id,
    name: 'user',
    type: 'relation',
    collectionId: '_pb_users_auth_',
    cascadeDelete: true,
    maxSelect: 1,
    required: true,
    ...extra,
})
const indexName = (index) => index.match(/`(idx_[a-z_]+)`/)[1]
const withoutIndex = (indexes, index) =>
    (indexes || []).filter((idx) => !idx.includes(`${indexName(index)}\``))

migrate(
    (app) => {
        const users = app.findCollectionByNameOrId('users')
        users.fields.add(...USER_FIELDS.map((field) => new Field(field)))
        users.updateRule = users.updateRule.replace(
            PERSONAL_UNTOUCHED,
            PRIVACY_UNTOUCHED,
        )
        app.save(users)

        const gyms = app.findCollectionByNameOrId('gyms')
        gyms.fields.add(
            new Field({
                id: 'json_gyms_features',
                name: 'features',
                type: 'json',
                maxSize: 2000,
            }),
        )
        app.save(gyms)

        app.save(
            new Collection({
                id: 'pbc_seasons',
                name: 'seasons',
                type: 'base',
                listRule: '',
                viewRule: '',
                createRule: MEMBER_WITH(
                    '@request.body.gym',
                    'manage_competitions',
                ),
                updateRule: MEMBER_WITH('gym', 'manage_competitions'),
                deleteRule: MEMBER_WITH('gym', 'manage_competitions'),
                fields: [
                    {
                        id: 'relation_seasons_gym',
                        name: 'gym',
                        type: 'relation',
                        collectionId: 'gyms_col_id',
                        cascadeDelete: false,
                        maxSelect: 1,
                        required: true,
                    },
                    {
                        id: 'text_seasons_name',
                        name: 'name',
                        type: 'text',
                        max: 60,
                        required: true,
                    },
                    {
                        id: 'date_seasons_starts_at',
                        name: 'starts_at',
                        type: 'date',
                        required: true,
                    },
                    {
                        id: 'date_seasons_ends_at',
                        name: 'ends_at',
                        type: 'date',
                        required: true,
                    },
                    created('seasons'),
                    updated('seasons'),
                ],
                indexes: [
                    'CREATE INDEX `idx_seasons_gym` ON `seasons` (`gym`, `starts_at`)',
                ],
            }),
        )

        app.save(
            new Collection({
                id: 'pbc_follows',
                name: 'follows',
                type: 'base',
                listRule: EITHER_SIDE,
                viewRule: EITHER_SIDE,
                createRule: `${SIGNED_IN} && @request.body.follower = @request.auth.id`,
                updateRule: `${SIGNED_IN} && followee = @request.auth.id && @request.body.follower:changed = false && @request.body.followee:changed = false`,
                deleteRule: EITHER_SIDE,
                fields: [
                    {
                        id: 'relation_follows_follower',
                        name: 'follower',
                        type: 'relation',
                        collectionId: '_pb_users_auth_',
                        cascadeDelete: true,
                        maxSelect: 1,
                        required: true,
                    },
                    {
                        id: 'relation_follows_followee',
                        name: 'followee',
                        type: 'relation',
                        collectionId: '_pb_users_auth_',
                        cascadeDelete: true,
                        maxSelect: 1,
                        required: true,
                    },
                    {
                        id: 'select_follows_status',
                        name: 'status',
                        type: 'select',
                        maxSelect: 1,
                        values: ['pending', 'accepted'],
                        required: true,
                    },
                    created('follows'),
                    updated('follows'),
                ],
                indexes: [
                    'CREATE UNIQUE INDEX `idx_follows_pair` ON `follows` (`follower`, `followee`)',
                    'CREATE INDEX `idx_follows_followee` ON `follows` (`followee`, `status`)',
                ],
            }),
        )

        app.save(
            new Collection({
                id: 'pbc_friend_ticks',
                name: 'friend_ticks',
                type: 'view',
                listRule: `${SIGNED_IN} && viewer = @request.auth.id`,
                viewRule: `${SIGNED_IN} && viewer = @request.auth.id`,
                viewQuery: FRIEND_TICKS_QUERY,
            }),
        )

        app.save(
            new Collection({
                id: 'pbc_beta_videos',
                name: 'beta_videos',
                type: 'base',
                listRule: '',
                viewRule: '',
                createRule: `${SIGNED_IN} && @request.body.user = @request.auth.id`,
                updateRule: null,
                deleteRule: `${SIGNED_IN} && (user = @request.auth.id || ${MEMBER_WITH('gym', 'manage_comments')})`,
                fields: [
                    {
                        id: 'relation_beta_gym',
                        name: 'gym',
                        type: 'relation',
                        collectionId: 'gyms_col_id',
                        cascadeDelete: false,
                        maxSelect: 1,
                        required: true,
                    },
                    {
                        id: 'relation_beta_route',
                        name: 'route',
                        type: 'relation',
                        collectionId: 'qr2b04qe5l99ax6',
                        cascadeDelete: true,
                        maxSelect: 1,
                        required: true,
                    },
                    userRelation('relation_beta_user'),
                    {
                        id: 'url_beta_url',
                        name: 'url',
                        type: 'url',
                        required: false,
                    },
                    {
                        id: 'file_beta_file',
                        name: 'file',
                        type: 'file',
                        maxSelect: 1,
                        maxSize: 30 * 1024 * 1024,
                        mimeTypes: [
                            'video/mp4',
                            'video/webm',
                            'video/quicktime',
                        ],
                        required: false,
                    },
                    created('beta'),
                ],
                indexes: [
                    'CREATE INDEX `idx_beta_videos_route` ON `beta_videos` (`route`, `created`)',
                    'CREATE INDEX `idx_beta_videos_user` ON `beta_videos` (`user`)',
                ],
            }),
        )

        app.save(
            new Collection({
                id: 'pbc_user_badges',
                name: 'user_badges',
                type: 'base',
                listRule: OWNER,
                viewRule: OWNER,
                createRule: null,
                updateRule: null,
                deleteRule: null,
                fields: [
                    userRelation('relation_badge_user'),
                    {
                        id: 'text_badge_key',
                        name: 'key',
                        type: 'text',
                        required: true,
                        max: 64,
                    },
                    {
                        id: 'number_badge_tier',
                        name: 'tier',
                        type: 'number',
                        required: true,
                        min: 1,
                        onlyInt: true,
                    },
                    {
                        id: 'date_badge_earned_on',
                        name: 'earned_on',
                        type: 'date',
                    },
                    created('badge'),
                ],
                indexes: [
                    'CREATE UNIQUE INDEX `idx_user_badges_tier` ON `user_badges` (`user`, `key`, `tier`)',
                ],
            }),
        )

        const ratings = app.findCollectionByNameOrId('ratings')
        ratings.fields.add(
            new Field({
                id: 'relation_ratings_user',
                name: 'user',
                type: 'relation',
                collectionId: users.id,
                cascadeDelete: false,
                maxSelect: 1,
                hidden: true,
            }),
        )
        ratings.deleteRule = `(${ratings.deleteRule}) || ${OWN_REVIEW}`
        app.save(ratings)

        const reports = app.findCollectionByNameOrId('reports')
        reports.fields.getByName('content_type').values = [
            ...REPORT_TYPES,
            'beta_video',
        ]
        app.save(reports)

        for (const [name, index] of Object.entries(LOOKUP_INDEXES)) {
            const collection = app.findCollectionByNameOrId(name)
            collection.indexes = [
                ...withoutIndex(collection.indexes, index),
                index,
            ]
            app.save(collection)
        }

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

        for (const [name, index] of Object.entries(LOOKUP_INDEXES)) {
            const collection = app.findCollectionByNameOrId(name)
            collection.indexes = withoutIndex(collection.indexes, index)
            app.save(collection)
        }

        app.db()
            .newQuery("DELETE FROM reports WHERE content_type = 'beta_video'")
            .execute()
        const reports = app.findCollectionByNameOrId('reports')
        reports.fields.getByName('content_type').values = REPORT_TYPES
        app.save(reports)

        const ratings = app.findCollectionByNameOrId('ratings')
        ratings.deleteRule = ratings.deleteRule
            .replace(` || ${OWN_REVIEW}`, '')
            .replace(/^\((.*)\)$/, '$1')
        ratings.fields.removeById('relation_ratings_user')
        app.save(ratings)

        for (const id of [
            'pbc_user_badges',
            'pbc_beta_videos',
            'pbc_friend_ticks',
            'pbc_follows',
            'pbc_seasons',
        ]) {
            app.delete(app.findCollectionByNameOrId(id))
        }

        const gyms = app.findCollectionByNameOrId('gyms')
        gyms.fields.removeById('json_gyms_features')
        app.save(gyms)

        const users = app.findCollectionByNameOrId('users')
        for (const field of USER_FIELDS) users.fields.removeById(field.id)
        users.updateRule = users.updateRule.replace(
            PRIVACY_UNTOUCHED,
            PERSONAL_UNTOUCHED,
        )
        app.save(users)
    },
)
