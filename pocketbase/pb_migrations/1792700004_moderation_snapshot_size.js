/// <reference path="../pb_data/types.d.ts" />
// Snapshots of long reviews (5000 escaped characters) outgrow 20 KB.
function setSnapshotSize(app, maxSize) {
    const collection = app.findCollectionByNameOrId('moderation_items')
    collection.fields.getByName('snapshot').maxSize = maxSize
    app.save(collection)
}

migrate(
    (app) => setSnapshotSize(app, 1000000),
    (app) => setSnapshotSize(app, 20000),
)
