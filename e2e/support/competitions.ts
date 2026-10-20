import {
    createCompetition,
    createCompetitionCategory,
    createCompetitionEntry,
    createCompetitionRoute,
    type Api,
} from './api'
import type { SeededUser } from './seed'

const HOUR = 60 * 60 * 1000

export async function openBoulderCompetition(
    adminApi: Api,
    {
        name,
        location,
        routes,
        climbers,
        competition = {},
    }: {
        name: string
        location: string
        routes: { id: string }[]
        climbers: { user: SeededUser; name: string }[]
        competition?: Record<string, unknown>
    },
) {
    const created = await createCompetition(adminApi, {
        name,
        location,
        status: 'open',
        discipline: 'boulder',
        scoring_format: 'dynamic',
        starts_at: new Date(Date.now() - HOUR).toISOString(),
        ends_at: new Date(Date.now() + HOUR).toISOString(),
        live_ranking: true,
        ...competition,
    })
    const category = await createCompetitionCategory(adminApi, created.id, {
        name: 'Open',
    })
    const compRoutes = []
    for (const [index, route] of routes.entries())
        compRoutes.push(
            await createCompetitionRoute(adminApi, created.id, {
                route: route.id,
                number: index + 1,
            }),
        )
    const entries = []
    for (const climber of climbers)
        entries.push(
            await createCompetitionEntry(adminApi, created.id, {
                user: climber.user.id,
                category: category.id,
                display_name: climber.name,
                birth_year: 1990,
            }),
        )
    return { competition: created, category, compRoutes, entries }
}

export const BOULDER = { type: 'Boulder' }
