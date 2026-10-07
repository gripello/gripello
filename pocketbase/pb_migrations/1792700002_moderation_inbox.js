/// <reference path="../pb_data/types.d.ts" />
const PLATFORM_ADMIN = '@request.auth.platform_admin = true'
const MEMBER_WITH = (permission) =>
    `@request.auth.memberships_via_user.gym ?= gym && @request.auth.memberships_via_user.role.permissions.name ?= "${permission}"`
const BEFORE = `${PLATFORM_ADMIN} || (gym != "" && ${MEMBER_WITH('manage_comments')})`
const AFTER = `${PLATFORM_ADMIN} || (gym != "" && (${MEMBER_WITH('manage_comments')} || ${MEMBER_WITH('manage_reports')}))`
const KINDS = ['rating', 'beta_video', 'profile', 'competition_entry', 'task']
const REPORTED = {
    rating: { collection: 'ratings', author: 'user' },
    beta_video: { collection: 'beta_videos', author: 'user' },
    profile: {
        collection: 'users',
        author: 'id',
        fields: ['username', 'firstname', 'name', 'avatar', 'banner'],
    },
    route: {
        collection: 'routes',
        author: '',
        fields: ['name', 'comment', 'archived'],
    },
}

function snapshotOf(record, fields, author) {
    const snapshot = {}
    let names = fields
    if (!names) {
        const all = record.collection().fields
        names = []
        for (let i = 0; i < all.length; i++) names.push(all[i].getName())
    }
    for (const name of names) {
        if (name !== author) snapshot[name] = record.get(name)
    }
    return snapshot
}

// Open reports from before the inbox existed need a case to be decided in.
function backfillOpenReports(app) {
    const items = app.findCollectionByNameOrId('moderation_items')
    const reports = app.findRecordsByFilter(
        'reports',
        "status = 'open'",
        'created',
        0,
        0,
    )
    for (const report of reports) {
        const kind = REPORTED[report.getString('content_type')]
        if (!kind) continue
        let content
        try {
            content = app.findRecordById(
                kind.collection,
                report.getString('content_id'),
            )
        } catch (err) {
            continue
        }
        let item
        try {
            item = app.findFirstRecordByFilter(
                'moderation_items',
                'content_type = {:type} && content_id = {:id}',
                { type: report.getString('content_type'), id: content.id },
            )
        } catch (err) {
            item = new Record(items)
            item.set('content_type', report.getString('content_type'))
            item.set('content_id', content.id)
            item.set(
                'gym',
                report.getString('content_type') === 'profile'
                    ? ''
                    : content.getString('gym'),
            )
            item.set(
                'author',
                kind.author ? content.getString(kind.author) : '',
            )
            item.set('snapshot', snapshotOf(content, kind.fields, kind.author))
            item.set('reports_count', 0)
        }
        if (item.getString('state') === 'hidden') continue
        item.set('state', 'unreviewed')
        item.set('reports_count', item.getInt('reports_count') + 1)
        try {
            app.save(item)
        } catch (err) {
            // One unusual row must not stop the server from starting.
            console.warn(
                `moderation backfill skipped report ${report.id}: ${err}`,
            )
        }
    }
}

migrate(
    (app) => {
        const collection = app.findCollectionByNameOrId('moderation_items')
        collection.listRule = AFTER
        collection.viewRule = AFTER
        collection.fields.getByName('content_type').values = [...KINDS, 'route']
        app.save(collection)
        backfillOpenReports(app)
    },
    (app) => {
        app.db()
            .newQuery(
                "DELETE FROM moderation_items WHERE content_type = 'route'",
            )
            .execute()
        const collection = app.findCollectionByNameOrId('moderation_items')
        collection.listRule = BEFORE
        collection.viewRule = BEFORE
        collection.fields.getByName('content_type').values = KINDS
        app.save(collection)
    },
)
