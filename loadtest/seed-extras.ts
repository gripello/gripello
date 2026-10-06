import { superuserClient } from './target.ts'

const GYMS = Number(process.env.GYMS || 20)
const SETTERS_PER_GYM = Number(process.env.SETTERS_PER_GYM || 5)
const FIRST_SETTER = Number(process.env.FIRST_SETTER || 4900)
const COMP_ROUTES = Number(process.env.COMP_ROUTES || 15)

const pb = await superuserClient()

const now = Date.now()
const stamp = (ms: number) => new Date(ms).toISOString().replace('T', ' ')

for (let g = 0; g < GYMS; g++) {
    const gym = await pb
        .collection('gyms')
        .getFirstListItem(`slug = "load-${g}"`)
    if (!gym.features?.beta_videos) {
        await pb.collection('gyms').update(gym.id, {
            features: { ...gym.features, beta_videos: true },
        })
    }
    const role = await pb
        .collection('roles')
        .getFirstListItem(`gym = "${gym.id}" && name = "routesetter"`)
    for (let s = 0; s < SETTERS_PER_GYM; s++) {
        const user = await pb
            .collection('users')
            .getFirstListItem(
                `email = "load-${FIRST_SETTER + g * SETTERS_PER_GYM + s}@gripello.test"`,
            )
        const existing = await pb.collection('memberships').getList(1, 1, {
            filter: `user = "${user.id}" && gym = "${gym.id}"`,
        })
        if (!existing.items.length) {
            await pb
                .collection('memberships')
                .create({ user: user.id, gym: gym.id, role: role.id })
        }
    }

    const open = await pb
        .collection('competitions')
        .getList(1, 1, { filter: `gym = "${gym.id}" && status = "open"` })
    if (open.items.length) {
        console.log(
            `gym ${g}: ${SETTERS_PER_GYM} setters, competition ${open.items[0]!.id} (existing)`,
        )
        continue
    }
    const location = await pb
        .collection('locations')
        .getFirstListItem(`gym = "${gym.id}"`, { sort: 'name' })
    const competition = await pb.collection('competitions').create({
        name: `Load Cup ${g}`,
        location: location.id,
        starts_at: stamp(now - 3_600_000),
        ends_at: stamp(now + 7 * 86_400_000),
        discipline: 'boulder',
        scoring_format: 'dynamic',
        scoring: {
            topPool: 1000,
            zonePool: 0,
            bestOf: null,
            flashBonus: 0,
            topropeFactor: 0.5,
        },
        live_ranking: true,
        freeze_minutes: 0,
        requires_payment: false,
        status: 'open',
    })
    for (const [sort, gender] of ['female', 'male'].entries()) {
        await pb.collection('competition_categories').create({
            competition: competition.id,
            name: gender,
            gender,
            sort,
            min_birth_year: 0,
            max_birth_year: 0,
        })
    }
    const boulders = await pb.collection('routes').getList(1, COMP_ROUTES, {
        filter: `gym = "${gym.id}" && type = "Boulder" && archived = false`,
        sort: 'name',
    })
    for (const [index, route] of boulders.items.entries()) {
        await pb.collection('competition_routes').create({
            competition: competition.id,
            route: route.id,
            number: index + 1,
            zone: true,
        })
    }
    console.log(
        `gym ${g}: ${SETTERS_PER_GYM} setters, competition ${competition.id}`,
    )
}
