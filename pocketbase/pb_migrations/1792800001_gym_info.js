/// <reference path="../pb_data/types.d.ts" />
// Mirrored in shared/utils/gymAmenities.ts.
const AMENITIES = [
    'toilets',
    'showers',
    'changing_rooms',
    'lockers',
    'cafe',
    'shop',
    'rental',
    'parking',
    'bike_parking',
    'public_transport',
    'kids_area',
    'training_area',
    'outdoor_area',
    'yoga',
    'sauna',
    'wheelchair',
    'wifi',
]

const FIELDS = [
    {
        id: 'file_gyms_cover_image',
        name: 'cover_image',
        type: 'file',
        maxSelect: 1,
        maxSize: 5242880,
        mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        thumbs: ['1600x500', '800x300'],
        protected: false,
    },
    {
        id: 'text_gyms_description',
        name: 'description',
        type: 'text',
        max: 2000,
    },
    { id: 'text_gyms_address', name: 'address', type: 'text', max: 300 },
    {
        id: 'number_gyms_latitude',
        name: 'latitude',
        type: 'number',
        min: -90,
        max: 90,
    },
    {
        id: 'number_gyms_longitude',
        name: 'longitude',
        type: 'number',
        min: -180,
        max: 180,
    },
    { id: 'url_gyms_website_url', name: 'website_url', type: 'url' },
    {
        id: 'json_gyms_opening_hours',
        name: 'opening_hours',
        type: 'json',
        maxSize: 4000,
    },
    { id: 'text_gyms_hours_note', name: 'hours_note', type: 'text', max: 300 },
    {
        id: 'select_gyms_amenities',
        name: 'amenities',
        type: 'select',
        maxSelect: AMENITIES.length,
        values: AMENITIES,
    },
]

migrate(
    (app) => {
        const gyms = app.findCollectionByNameOrId('gyms')
        for (const field of FIELDS) gyms.fields.add(new Field(field))
        app.save(gyms)
    },
    (app) => {
        const gyms = app.findCollectionByNameOrId('gyms')
        for (const field of FIELDS) gyms.fields.removeById(field.id)
        app.save(gyms)
    },
)
