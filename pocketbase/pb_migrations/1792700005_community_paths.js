/// <reference path="../pb_data/types.d.ts" />
const COMMUNITY_PATHS = ['climber', 'friends']

function freeSlug(app, base) {
    for (let n = 0; ; n++) {
        const slug = n ? `${base}-gym-${n}` : `${base}-gym`
        const taken = app
            .findRecordsByFilter(
                'gyms',
                'slug = {:slug} || previous_slugs ~ {:quoted}',
                '',
                1,
                0,
                { slug, quoted: `"${slug}"` },
            )
            .concat(
                app.findRecordsByFilter(
                    'retired_slugs',
                    'slug = {:slug}',
                    '',
                    1,
                    0,
                    {
                        slug,
                    },
                ),
            )
        if (!taken.length) return slug
    }
}

migrate(
    (app) => {
        for (const gym of app.findAllRecords('gyms')) {
            const previous =
                JSON.parse(gym.getString('previous_slugs') || '[]') || []
            const kept = previous.filter(
                (slug) => !COMMUNITY_PATHS.includes(slug),
            )
            const slug = gym.getString('slug')
            if (
                !COMMUNITY_PATHS.includes(slug) &&
                kept.length === previous.length
            )
                continue
            if (COMMUNITY_PATHS.includes(slug))
                gym.set('slug', freeSlug(app, slug))
            gym.set('previous_slugs', kept)
            app.unsafeWithoutHooks().save(gym)
        }
    },
    () => {},
)
