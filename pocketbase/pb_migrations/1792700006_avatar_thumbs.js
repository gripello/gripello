/// <reference path="../pb_data/types.d.ts" />
function setAvatarThumbs(app, thumbs) {
    const collection = app.findCollectionByNameOrId('users')
    collection.fields.getByName('avatar').thumbs = thumbs
    app.save(collection)
}

migrate(
    (app) => setAvatarThumbs(app, ['100x100', '320x320']),
    (app) => setAvatarThumbs(app, []),
)
