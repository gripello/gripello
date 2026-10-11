import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '~/api/client'
import {
    competitionDate,
    createCategory,
    createCompetition,
    createCompetitionRoute,
    createEntry,
    deleteCategory,
    deleteCompetition,
    deleteCompetitionRoute,
    deleteEntry,
    deleteScore,
    getCompetition,
    getResults,
    getStandings,
    listCategories,
    listCompetitionRoutes,
    listCompetitions,
    listEntries,
    listScores,
    publishCompetition,
    putScores,
    updateCategory,
    updateCompetition,
    updateCompetitionRoute,
    updateEntry,
} from '~/api/competitions'
import { jsonResponse, mockApi } from './apiMock'

let api: ReturnType<typeof mockApi>

beforeEach(() => {
    api = mockApi()
})

function calls() {
    return api.fetchMock.mock.calls.map((_, index) => {
        const { url, method, body } = api.request(index)
        return body === undefined ? [method, url] : [method, url, body]
    })
}

describe('competitions', () => {
    it('lists the competitions of a gym', async () => {
        api.respond({ items: [{ id: 'c1' }] })
        expect(await listCompetitions('g1')).toEqual([{ id: 'c1' }])
        expect(api.request().url).toBe('/api/gyms/g1/competitions')
    })

    it('filters by status, expands the location and sorts', async () => {
        api.respond({ items: [] })
        await listCompetitions('g1', {
            status: ['open', 'closed'],
            include: ['location'],
            sort: '-starts_at',
        })
        expect(api.request().url).toBe(
            '/api/gyms/g1/competitions?status=open&status=closed&include=location&sort=-starts_at',
        )
    })

    it('gets one competition', async () => {
        await getCompetition('c1')
        await getCompetition('c1', { include: ['location'] })
        expect(calls()).toEqual([
            ['GET', '/api/competitions/c1'],
            ['GET', '/api/competitions/c1?include=location'],
        ])
    })

    it('creates in the gym with RFC 3339 dates', async () => {
        await createCompetition('g1', {
            name: 'Cup',
            starts_at: '2026-10-10 10:00:00.000Z',
            ends_at: '',
        })
        expect(calls()).toEqual([
            [
                'POST',
                '/api/gyms/g1/competitions',
                {
                    name: 'Cup',
                    starts_at: '2026-10-10T10:00:00.000Z',
                    ends_at: '',
                },
            ],
        ])
    })

    it('updates, publishes and deletes', async () => {
        await updateCompetition('c1', { ends_at: '2026-10-10T12:00:00Z' })
        await publishCompetition('c1')
        api.fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
        expect(await deleteCompetition('c1')).toBe(true)
        expect(calls()).toEqual([
            [
                'PATCH',
                '/api/competitions/c1',
                { ends_at: '2026-10-10T12:00:00.000Z' },
            ],
            ['POST', '/api/competitions/c1/publish'],
            ['DELETE', '/api/competitions/c1'],
        ])
    })

    it('keeps unparsable dates as they are', () => {
        expect(competitionDate('soon')).toBe('soon')
        expect(competitionDate('')).toBe('')
    })

    it('throws ApiError with the field errors', async () => {
        api.respond(
            {
                status: 400,
                message: 'Invalid.',
                data: { name: { code: 'required', message: 'Required.' } },
            },
            400,
        )
        const error = await createCompetition('g1', {}).catch((e) => e)
        expect(error).toBeInstanceOf(ApiError)
        expect(error.response.data.name.code).toBe('required')
    })
})

describe('categories', () => {
    it('lists the categories of a competition', async () => {
        api.respond({ items: [{ id: 'k1' }] })
        expect(await listCategories('c1')).toEqual([{ id: 'k1' }])
        expect(api.request().url).toBe('/api/competitions/c1/categories')
    })

    it('creates, updates and deletes', async () => {
        await createCategory('c1', { name: 'Open' })
        await updateCategory('k1', { sort: 2 })
        await deleteCategory('k1')
        expect(calls()).toEqual([
            ['POST', '/api/competitions/c1/categories', { name: 'Open' }],
            ['PATCH', '/api/competition-categories/k1', { sort: 2 }],
            ['DELETE', '/api/competition-categories/k1'],
        ])
    })
})

describe('competition routes', () => {
    it('lists with an optional voided filter', async () => {
        api.fetchMock.mockImplementation(async () =>
            jsonResponse({ items: [] }),
        )
        await listCompetitionRoutes('c1')
        await listCompetitionRoutes('c1', { voided: false })
        expect(calls()).toEqual([
            ['GET', '/api/competitions/c1/routes'],
            ['GET', '/api/competitions/c1/routes?voided=false'],
        ])
    })

    it('creates, updates and deletes', async () => {
        await createCompetitionRoute('c1', { route: 'r1', number: 1 })
        await updateCompetitionRoute('cr1', { voided: true })
        await deleteCompetitionRoute('cr1')
        expect(calls()).toEqual([
            ['POST', '/api/competitions/c1/routes', { route: 'r1', number: 1 }],
            ['PATCH', '/api/competition-routes/cr1', { voided: true }],
            ['DELETE', '/api/competition-routes/cr1'],
        ])
    })
})

describe('entries', () => {
    it('lists with status and user filters', async () => {
        api.respond({ items: [{ id: 'e1' }] })
        expect(
            await listEntries('c1', {
                status: ['registered', 'checked_in'],
                user: 'u1',
            }),
        ).toEqual([{ id: 'e1' }])
        expect(api.request().url).toBe(
            '/api/competitions/c1/entries?status=registered&status=checked_in&user=u1',
        )
    })

    it('creates, updates and deletes', async () => {
        await createEntry('c1', { category: 'k1', display_name: 'Ann' })
        await updateEntry('e1', { status: 'withdrawn' })
        await deleteEntry('e1')
        expect(calls()).toEqual([
            [
                'POST',
                '/api/competitions/c1/entries',
                { category: 'k1', display_name: 'Ann' },
            ],
            ['PATCH', '/api/competition-entries/e1', { status: 'withdrawn' }],
            ['DELETE', '/api/competition-entries/e1'],
        ])
    })
})

describe('scores', () => {
    it('lists the scores of a competition or one entry', async () => {
        api.fetchMock.mockImplementation(async () =>
            jsonResponse({ items: [] }),
        )
        await listScores('c1')
        await listScores('c1', { entry: 'e1' })
        expect(calls()).toEqual([
            ['GET', '/api/competitions/c1/scores'],
            ['GET', '/api/competitions/c1/scores?entry=e1'],
        ])
    })

    it('upserts scores in one batch', async () => {
        const scores = [
            { entry: 'e1', comp_route: 'cr1', top_attempt: 1 },
            { entry: 'e1', comp_route: 'cr2', attempts: 3 },
        ]
        api.respond({ items: [{ id: 's1' }, { id: 's2' }] })
        expect(await putScores('c1', scores)).toEqual([
            { id: 's1' },
            { id: 's2' },
        ])
        expect(calls()).toEqual([
            ['PUT', '/api/competitions/c1/scores', { scores }],
        ])
    })

    it('reports network errors with status 0', async () => {
        api.fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
        await expect(
            putScores('c1', [{ entry: 'e1', comp_route: 'cr1' }]),
        ).rejects.toMatchObject({ status: 0 })
    })

    it('deletes a score', async () => {
        await deleteScore('s1')
        expect(calls()).toEqual([['DELETE', '/api/competition-scores/s1']])
    })
})

describe('standings and results', () => {
    it('reads the standings with the categories', async () => {
        const standings = { items: [{ id: 'e1' }], categories: [{ id: 'k1' }] }
        api.respond(standings)
        expect(await getStandings('c1')).toEqual(standings)
        expect(api.request().url).toBe('/api/competitions/c1/standings')
    })

    it('reads the results input with its visibility', async () => {
        const results = {
            visibility: 'frozen',
            competition: { id: 'c1' },
            categories: [],
            entries: [],
            routes: [],
            scores: [],
        }
        api.respond(results)
        expect(await getResults('c1')).toEqual(results)
        expect(api.request().url).toBe('/api/competitions/c1/results')
    })
})
