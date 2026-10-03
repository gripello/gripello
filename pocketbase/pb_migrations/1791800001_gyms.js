/// <reference path="../pb_data/types.d.ts" />
const MANAGE_SETTINGS =
    '@request.auth.role.permissions.name ?= "manage_settings"'
const SETTINGS_COLLECTION = '68oae2zwn6jtsd4'
const SETTINGS_ID = 'settings_123456'
const AVERAGE_RATING_VIEW = 'vcfw600rzblhed3'
const TENANT_COLLECTIONS = [
    'locations',
    'walls',
    'routes',
    'ratings',
    'tasks',
    'reports',
    'competitions',
    'roles',
]
const GYM_NAMED_INDEXES = {
    locations: [
        'CREATE UNIQUE INDEX `idx_locations_name` ON `locations` (`name` COLLATE NOCASE)',
        'CREATE UNIQUE INDEX `idx_locations_gym_name` ON `locations` (`gym`, `name` COLLATE NOCASE)',
    ],
    roles: [
        'CREATE UNIQUE INDEX `idx_roles_name` ON `roles` (`name`)',
        'CREATE UNIQUE INDEX `idx_roles_gym_name` ON `roles` (`gym`, `name`)',
    ],
}
const COPIED_SETTINGS_FIELDS = [
    'contact_email',
    'route_grade_system',
    'boulder_grade_system',
    'boulder_bands',
    'legal_address',
    'legal_phone',
    'legal_register',
    'legal_vat_id',
    'legal_editorial',
    'legal_representatives',
    'imprint_url',
    'privacy_url',
]
const COPIED_SETTINGS_FILES = ['page_logo', 'page_icon', 'sign_image']
const RESERVED_GYM_SLUGS = [
    '_i18n',
    '_nuxt',
    'account',
    'admin',
    'api',
    'auth',
    'competitions',
    'imprint',
    'logbook',
    'manage',
    'map',
    'offline',
    'platform',
    'privacy',
    'route',
    'routes',
    'scan',
]
const FOLDED_LETTERS = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }

function slugify(name) {
    const slug = String(name || '')
        .toLowerCase()
        .replace(/[äöüß]/g, (letter) => FOLDED_LETTERS[letter])
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
        .replace(/-+$/, '')
    return /^[a-z0-9-]{3,40}$/.test(slug) && !RESERVED_GYM_SLUGS.includes(slug)
        ? slug
        : 'my-gym'
}

const idField = {
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
}

function timestamps(prefix) {
    return [
        {
            id: `autodate_${prefix}_created`,
            name: 'created',
            type: 'autodate',
            onCreate: true,
            onUpdate: false,
        },
        {
            id: `autodate_${prefix}_updated`,
            name: 'updated',
            type: 'autodate',
            onCreate: true,
            onUpdate: true,
        },
    ]
}

function text(name, max, options = {}) {
    return { id: `text_gyms_${name}`, name, type: 'text', max, ...options }
}

function image(name, mimeTypes, thumbs) {
    return {
        id: `file_gyms_${name}`,
        name,
        type: 'file',
        maxSelect: 1,
        maxSize: 5242880,
        mimeTypes,
        thumbs,
        protected: false,
    }
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp']

function gymsCollection() {
    return new Collection({
        id: 'gyms_col_id',
        name: 'gyms',
        type: 'base',
        listRule: '',
        viewRule: '',
        createRule: null,
        updateRule: MANAGE_SETTINGS,
        deleteRule: null,
        fields: [
            idField,
            text('slug', 40, {
                required: true,
                pattern: '^[a-z0-9-]{3,40}$',
            }),
            text('name', 100, { required: true, presentable: true }),
            text('unit_name', 100),
            { id: 'bool_gyms_active', name: 'active', type: 'bool' },
            image('page_logo', IMAGE_TYPES, ['0x200']),
            image('page_icon', ['image/x-icon'], ['16x16', '32x32', '48x48']),
            image('sign_image', IMAGE_TYPES, []),
            {
                id: 'email_gyms_contact_email',
                name: 'contact_email',
                type: 'email',
            },
            text('route_grade_system', 50),
            text('boulder_grade_system', 50),
            {
                id: 'json_gyms_boulder_bands',
                name: 'boulder_bands',
                type: 'json',
                maxSize: 5000,
            },
            text('legal_address', 1000),
            text('legal_phone', 100),
            text('legal_register', 500),
            text('legal_vat_id', 100),
            text('legal_editorial', 500),
            {
                id: 'json_gyms_legal_representatives',
                name: 'legal_representatives',
                type: 'json',
                maxSize: 20000,
            },
            { id: 'url_gyms_imprint_url', name: 'imprint_url', type: 'url' },
            { id: 'url_gyms_privacy_url', name: 'privacy_url', type: 'url' },
            text('privacy_extra', 10000),
            ...timestamps('gyms'),
        ],
        indexes: [
            'CREATE UNIQUE INDEX `idx_gyms_slug` ON `gyms` (`slug`)',
            'CREATE INDEX `idx_gyms_active` ON `gyms` (`active`)',
        ],
    })
}

function membershipRelation(name, collectionId) {
    return {
        id: `relation_memberships_${name}`,
        name,
        type: 'relation',
        collectionId,
        cascadeDelete: true,
        maxSelect: 1,
        required: true,
    }
}

function membershipsCollection(app) {
    return new Collection({
        id: 'memberships_col_id',
        name: 'memberships',
        type: 'base',
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
            idField,
            membershipRelation(
                'user',
                app.findCollectionByNameOrId('users').id,
            ),
            membershipRelation('gym', 'gyms_col_id'),
            membershipRelation(
                'role',
                app.findCollectionByNameOrId('roles').id,
            ),
            ...timestamps('memberships'),
        ],
        indexes: [
            'CREATE UNIQUE INDEX `idx_memberships_user_gym` ON `memberships` (`user`, `gym`)',
            'CREATE INDEX `idx_memberships_gym` ON `memberships` (`gym`)',
        ],
    })
}

function gymIndex(collectionName) {
    return `CREATE INDEX \`idx_${collectionName}_gym\` ON \`${collectionName}\` (\`gym\`)`
}

function addGymField(app, collectionName, cascadeDelete) {
    const collection = app.findCollectionByNameOrId(collectionName)
    collection.fields.add(
        new Field({
            id: `relation_${collectionName}_gym`,
            name: 'gym',
            type: 'relation',
            collectionId: 'gyms_col_id',
            cascadeDelete,
            maxSelect: 1,
            required: false,
        }),
    )
    collection.indexes = [
        ...(collection.indexes || []),
        gymIndex(collectionName),
    ]
    app.save(collection)
}

function requireGym(app, collectionName) {
    const collection = app.findCollectionByNameOrId(collectionName)
    collection.fields.getByName('gym').required = true
    app.save(collection)
}

function swapIndex(app, collectionName, from, to) {
    const collection = app.findCollectionByNameOrId(collectionName)
    collection.indexes = [
        ...(collection.indexes || []).filter((index) => index !== from),
        to,
    ]
    app.save(collection)
}

function hasRows(app, table) {
    const result = new DynamicModel({ total: 0 })
    app.db().newQuery(`SELECT COUNT(*) AS total FROM \`${table}\``).one(result)
    return result.total > 0
}

function findSettings(app) {
    try {
        return app.findRecordById(SETTINGS_COLLECTION, SETTINGS_ID)
    } catch (_) {
        return null
    }
}

function copySettingsFile(app, settings, gym, field) {
    const filename = settings.getString(field)
    if (!filename) return
    try {
        gym.set(
            field,
            $filesystem.fileFromPath(
                `${app.dataDir()}/storage/${SETTINGS_COLLECTION}/${SETTINGS_ID}/${filename}`,
            ),
        )
    } catch (_) {}
}

function createDefaultGym(app, settings) {
    const gyms = app.findCollectionByNameOrId('gyms')
    const name = settings.getString('organization_name') || 'My gym'
    const gym = new Record(gyms)
    gym.set('name', name)
    gym.set('slug', slugify(name))
    gym.set('unit_name', settings.getString('organization_unit_name'))
    gym.set('active', true)
    for (const field of COPIED_SETTINGS_FIELDS)
        gym.set(field, settings.get(field))
    for (const field of COPIED_SETTINGS_FILES) {
        copySettingsFile(app, settings, gym, field)
    }
    try {
        app.save(gym)
    } catch (_) {
        for (const field of COPIED_SETTINGS_FILES) gym.set(field, null)
        app.save(gym)
    }
    return gym
}

function backfill(app, table, gymId) {
    app.db()
        .newQuery(`UPDATE \`${table}\` SET gym = {:gym} WHERE gym = ''`)
        .bind({ gym: gymId })
        .execute()
}

const MOVED_SETTINGS_FIELDS = [
    'page_logo',
    'page_icon',
    'sign_image',
    'route_grade_system',
    'boulder_grade_system',
    'boulder_bands',
    'application_url',
    'organization_name',
    'organization_unit_name',
]

const REMOVED_SETTINGS_FIELDS = {
    page_logo: {
        id: 'ftnklfkd',
        type: 'file',
        maxSelect: 1,
        maxSize: 5242880,
        mimeTypes: IMAGE_TYPES,
        thumbs: ['0x200'],
    },
    page_icon: {
        id: 'etsgdhry',
        type: 'file',
        maxSelect: 1,
        maxSize: 5242880,
        mimeTypes: ['image/x-icon'],
        thumbs: ['16x16', '32x32', '48x48'],
    },
    sign_image: {
        id: 'ql2hwtia',
        type: 'file',
        maxSelect: 1,
        maxSize: 5242880,
        mimeTypes: IMAGE_TYPES,
        thumbs: [],
    },
    route_grade_system: {
        id: 'text_settings_route_grade_system',
        type: 'text',
    },
    boulder_grade_system: {
        id: 'text_settings_boulder_grade_system',
        type: 'text',
    },
    boulder_bands: {
        id: 'json_settings_boulder_bands',
        type: 'json',
        maxSize: 5000,
    },
    application_url: { id: 'mkmvju9s', type: 'url' },
    organization_name: { id: 'text1730822299', type: 'text' },
    organization_unit_name: { id: 'text3939648858', type: 'text' },
}

const ROUTE_VIEW_COLUMNS = [
    'id',
    'name',
    'color',
    'grade',
    'grade_system',
    'grade_index',
    'anchor_point',
    'location',
    'type',
    'comment',
    'creator',
    'archived',
    'screw_date',
    'created',
    'updated',
    'wall',
    'wall_position',
]

function averageRatingQuery(withGym) {
    const columns = withGym
        ? [...ROUTE_VIEW_COLUMNS, 'gym']
        : ROUTE_VIEW_COLUMNS
    return (
        'SELECT\n' +
        columns.map((column) => `    routes.${column},\n`).join('') +
        '    CAST((SELECT AVG(NULLIF(r.rating, 0)) FROM ratings r WHERE r.route_id = routes.id) AS REAL) AS average_rating,\n' +
        '    CAST((SELECT COUNT(NULLIF(r.rating, 0)) FROM ratings r WHERE r.route_id = routes.id) AS INTEGER) AS ratings_count\n' +
        'FROM routes'
    )
}

function openDefectsQuery(withGym) {
    return `SELECT id, ${withGym ? 'gym, ' : ''}route, category, created FROM tasks WHERE kind = 'defect' AND status IN ('open', 'in_progress', 'waiting') AND route != ''`
}

function usedColorsQuery(withGym) {
    const gym = withGym ? 'gym, ' : ''
    return `SELECT id, ${gym}color
FROM (
    SELECT id, ${gym}color,
           ROW_NUMBER() OVER (PARTITION BY ${gym}color ORDER BY id) AS rn
    FROM routes
)
WHERE rn = 1;`
}

function ratingsStatsQuery(withGym) {
    return `SELECT
    ${withGym ? 'gym AS id,\n    gym' : "'stats' AS id"},
    COUNT(id) AS totalReviews,
    ROUND(AVG(NULLIF(rating, 0)), 1) AS avgRating,
    SUM(NULLIF(rating, 0) IS NOT NULL AND NULLIF(rating, 0) <= 2) AS lowRated,
    SUM(created >= datetime('now', '-7 days')) AS thisWeek
FROM ratings${withGym ? '\nGROUP BY gym' : ''};`
}

function setViews(app, withGym) {
    const queries = {
        [AVERAGE_RATING_VIEW]: averageRatingQuery(withGym),
        open_route_defects: openDefectsQuery(withGym),
        usedColors: usedColorsQuery(withGym),
        ratingsStats: ratingsStatsQuery(withGym),
    }
    for (const [name, query] of Object.entries(queries)) {
        const view = app.findCollectionByNameOrId(name)
        view.viewQuery = query
        app.save(view)
    }
}

migrate(
    (app) => {
        app.save(gymsCollection())
        app.save(membershipsCollection(app))
        for (const name of TENANT_COLLECTIONS) addGymField(app, name, true)
        addGymField(app, 'audit_logs', false)

        const settings = findSettings(app)
        const hasContent =
            !!settings &&
            (!!settings.getString('organization_name') ||
                hasRows(app, 'locations') ||
                hasRows(app, 'routes'))
        if (hasContent) {
            const gym = createDefaultGym(app, settings)
            for (const name of [...TENANT_COLLECTIONS, 'audit_logs']) {
                backfill(app, name, gym.id)
            }
        }
        for (const name of TENANT_COLLECTIONS) requireGym(app, name)

        const settingsCollection =
            app.findCollectionByNameOrId(SETTINGS_COLLECTION)
        for (const name of MOVED_SETTINGS_FIELDS) {
            const field = settingsCollection.fields.getByName(name)
            if (field) settingsCollection.fields.removeById(field.id)
        }
        app.save(settingsCollection)

        for (const [name, [from, to]] of Object.entries(GYM_NAMED_INDEXES)) {
            swapIndex(app, name, from, to)
        }
        setViews(app, true)
    },
    (app) => {
        if (app.countRecords('gyms') > 1) {
            throw new Error(
                'Cannot revert multi-tenancy while more than one gym exists. Delete all but one gym first.',
            )
        }
        setViews(app, false)
        for (const [name, [from, to]] of Object.entries(GYM_NAMED_INDEXES)) {
            swapIndex(app, name, to, from)
        }

        const settingsCollection =
            app.findCollectionByNameOrId(SETTINGS_COLLECTION)
        for (const [name, field] of Object.entries(REMOVED_SETTINGS_FIELDS)) {
            if (!settingsCollection.fields.getByName(name)) {
                settingsCollection.fields.add(new Field({ name, ...field }))
            }
        }
        app.save(settingsCollection)

        const settings = findSettings(app)
        const gym = app.findRecordsByFilter('gyms', '', 'created', 1, 0)[0]
        if (settings && gym) {
            settings.set('organization_name', gym.getString('name'))
            settings.set('organization_unit_name', gym.getString('unit_name'))
            for (const field of [
                'route_grade_system',
                'boulder_grade_system',
                'boulder_bands',
            ]) {
                settings.set(field, gym.get(field))
            }
            app.saveNoValidate(settings)
        }

        for (const name of [...TENANT_COLLECTIONS, 'audit_logs']) {
            const collection = app.findCollectionByNameOrId(name)
            collection.indexes = (collection.indexes || []).filter(
                (index) => index !== gymIndex(name),
            )
            collection.fields.removeById(`relation_${name}_gym`)
            app.save(collection)
        }
        app.delete(app.findCollectionByNameOrId('memberships'))
        app.delete(app.findCollectionByNameOrId('gyms'))
    },
)
