/// <reference path="../pb_data/types.d.ts" />
// Every file type a moderated field accepts: beta videos, avatars, banners, defect photos.
const MIME_TYPES = [
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/svg+xml',
]

function setMimeTypes(app, mimeTypes) {
    const collection = app.findCollectionByNameOrId('moderation_items')
    collection.fields.getByName('files').mimeTypes = mimeTypes
    app.save(collection)
}

migrate(
    (app) => setMimeTypes(app, MIME_TYPES),
    (app) => setMimeTypes(app, []),
)
