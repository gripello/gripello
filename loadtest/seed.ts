import { gradeIndex, gradeLabels } from '../shared/utils/grades.ts'
import { superuserClient } from './target.ts'

const GYMS = Number(process.env.GYMS || 20)
const ROUTES_PER_GYM = Number(process.env.ROUTES_PER_GYM || 200)
const USERS = Number(process.env.USERS || 5000)
const TICKS_PER_USER = Number(process.env.TICKS_PER_USER || 30)
const RATINGS_PER_ROUTE = Number(process.env.RATINGS_PER_ROUTE || 5)
export const USER_PASSWORD = 'LoadPassw0rd!'

const pb = await superuserClient()

async function inBatches(requests: { url: string; body: object }[]) {
    const results: { id: string }[] = []
    for (let i = 0; i < requests.length; i += 50) {
        const batch = pb.createBatch()
        for (const { url, body } of requests.slice(i, i + 50)) {
            batch.collection(url).create(body)
        }
        const responses = await batch.send()
        results.push(...responses.map((r) => r.body as { id: string }))
    }
    return results
}

const pick = <T>(items: T[], n: number) => items[n % items.length]!

function grade(type: 'Route' | 'Boulder', n: number) {
    const system = type === 'Boulder' ? 'font' : 'uiaa'
    const labels = gradeLabels(system).slice(4, 22)
    const label = pick(labels, n)
    return {
        grade: label,
        grade_system: system,
        grade_index: gradeIndex(system, label),
    }
}

const FLOOR = {
    width: 80,
    height: 30,
    shapes: [
        {
            kind: 'floor',
            points: [
                [0, 0],
                [80, 0],
                [80, 30],
                [0, 30],
            ],
        },
    ],
}

const rect = (x: number) => [
    [x + 1, 1],
    [x + 9, 1],
    [x + 9, 4],
    [x + 1, 4],
]

const settings = await pb.settings.getAll()
await pb.settings.update({
    rateLimits: { ...settings.rateLimits, enabled: false },
    batch: { ...settings.batch, enabled: true, maxRequests: 50, timeout: 60 },
})
try {
    const routes: {
        id: string
        gym: string
        name: string
        type: 'Route' | 'Boulder'
    }[] = []
    for (let g = 0; g < GYMS; g++) {
        const gym = await pb.collection('gyms').create({
            slug: `load-${g}`,
            name: `Load Gym ${g}`,
            active: true,
            features: { beta_videos: true },
        })
        const locations = await inBatches(
            ['Hall A', 'Hall B'].map((name) => ({
                url: 'locations',
                body: { name, gym: gym.id, map: FLOOR },
            })),
        )
        const walls = await inBatches(
            Array.from({ length: 8 }, (_, w) => ({
                url: 'walls',
                body: {
                    name: `Wall ${w}`,
                    location: pick(locations, w).id,
                    outline: rect(w * 10),
                    edge: rect(w * 10).slice(0, 2),
                    sort: w,
                },
            })),
        )
        const gymRoutes = Array.from({ length: ROUTES_PER_GYM }, (_, r) => {
            const type = r % 2 ? 'Boulder' : 'Route'
            const wall = pick(walls, r)
            return {
                url: 'routes',
                body: {
                    name: `load ${g}-${r}`,
                    type,
                    ...grade(type, r),
                    location: pick(locations, r % 8).id,
                    wall: wall.id,
                    anchor_point: 1 + (r % 40),
                    color: pick(
                        ['#f44336', '#2196f3', '#4caf50', '#ffeb3b'],
                        r,
                    ),
                    creator: [`Setter ${r % 6}`],
                    screw_date: new Date(Date.now() - (r % 90) * 86_400_000)
                        .toISOString()
                        .slice(0, 10),
                    archived: r % 10 === 0,
                },
            }
        })
        const created = await inBatches(gymRoutes)
        created.forEach((route, r) =>
            routes.push({
                id: route.id,
                gym: gym.id,
                name: gymRoutes[r]!.body.name,
                type: gymRoutes[r]!.body.type as 'Route' | 'Boulder',
            }),
        )
        console.log(`gym ${g}: ${created.length} routes`)
    }

    const ratings = routes.flatMap((route, r) =>
        Array.from({ length: RATINGS_PER_ROUTE }, (_, n) => ({
            url: 'ratings',
            body: {
                route_id: route.id,
                rating: 1 + ((r + n) % 5),
                ...grade(route.type, r + n),
                comment: `load rating ${r}-${n}`,
            },
        })),
    )
    await inBatches(ratings)
    console.log(`${ratings.length} ratings`)

    const users = await inBatches(
        Array.from({ length: USERS }, (_, u) => ({
            url: 'users',
            body: {
                email: `load-${u}@gripello.test`,
                username: `load${u}`,
                password: USER_PASSWORD,
                passwordConfirm: USER_PASSWORD,
                verified: true,
                firstname: 'Load',
                name: `Climber ${u}`,
            },
        })),
    )
    console.log(`${users.length} users`)

    const ticks = users.flatMap((user, u) => {
        const home = Math.floor((u / users.length) * GYMS) * ROUTES_PER_GYM
        return Array.from({ length: TICKS_PER_USER }, (_, t) => {
            const route = routes[home + ((u * 7 + t * 13) % ROUTES_PER_GYM)]!
            return {
                url: 'ticks',
                body: {
                    user: user.id,
                    route: route.id,
                    type: pick(['flash', 'top', 'top', 'attempt'], u + t),
                    attempts: 1 + ((u + t) % 4),
                    date: new Date(
                        Date.now() - (t % 50) * 86_400_000,
                    ).toISOString(),
                    ...grade(route.type, u + t),
                },
            }
        })
    })
    await inBatches(ticks)
    console.log(`${ticks.length} ticks`)
} finally {
    await pb.settings.update({
        rateLimits: settings.rateLimits,
        batch: settings.batch,
    })
}
