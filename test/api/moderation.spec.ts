import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '~/api/client'
import {
    createReport,
    decideCase,
    getCase,
    getModerationSummary,
    hideAuthor,
    listCases,
    listGymReports,
    listPlatformReports,
    openCase,
} from '~/api/moderation'
import { mockApi } from './apiMock'

let api: ReturnType<typeof mockApi>

beforeEach(() => {
    api = mockApi()
})

const report = {
    content_type: 'rating' as const,
    content_id: 'r1',
    reason: 'spam_fraud' as const,
    explanation: 'Spam',
    notifier_name: 'Ann',
    notifier_email: 'a@b.c',
    language: 'en',
    good_faith: true,
}

describe('reports', () => {
    it('files a report with the captcha header', async () => {
        api.respond({ id: 'rep1' }, 201)
        expect(await createReport(report, { 'X-Cap-Token': 't' })).toEqual({
            id: 'rep1',
        })
        const request = api.request()
        expect(request.url).toBe('/api/reports')
        expect(request.method).toBe('POST')
        expect(request.headers.get('X-Cap-Token')).toBe('t')
        expect(request.body).toEqual(report)
    })

    it('pages the open reports of a gym', async () => {
        api.respond({ items: [], page: 2, limit: 10 })
        await listGymReports('g1', { status: 'open', page: 2, limit: 10 })
        expect(api.request().url).toBe(
            '/api/gyms/g1/reports?status=open&page=2&limit=10',
        )
    })

    it('lists every report for the platform', async () => {
        api.respond({ items: [], page: 1, limit: 30 })
        await listPlatformReports()
        expect(api.request().url).toBe('/api/platform/reports')
    })
})

describe('moderation summary', () => {
    it('reads the gym summary or the platform one', async () => {
        api.respond({ decide: 1, waiting: 0, hidden: 0 })
        await getModerationSummary('g1')
        expect(api.request().url).toBe('/api/moderation/summary?gym=g1')
        await getModerationSummary()
        expect(api.request().url).toBe('/api/moderation/summary')
    })
})

describe('cases', () => {
    it('sends every filter as a query parameter', async () => {
        api.respond({ items: [{ id: 'c1' }], page: 1, limit: 30, total: 1 })
        const result = await listCases({
            gym: 'g1',
            state: ['unreviewed', 'pending'],
            content_type: 'rating',
            author: 'u1',
            q: ' spam ',
            queue: 'platform',
            sort: 'newest',
            page: 1,
            limit: 30,
            total: true,
        })
        expect(result.total).toBe(1)
        expect(api.request().url).toBe(
            '/api/moderation/cases?gym=g1&state=unreviewed&state=pending&content_type=rating&author=u1&q=spam&queue=platform&sort=newest&page=1&limit=30&total=true',
        )
    })

    it('leaves out empty filters', async () => {
        api.respond({ items: [], page: 1, limit: 30 })
        await listCases({ state: [], content_type: null, q: '  ' })
        expect(api.request().url).toBe('/api/moderation/cases')
    })

    it('opens, reads and decides a case', async () => {
        await openCase({ content_type: 'rating', content_id: 'r1' })
        expect(api.request()).toMatchObject({
            url: '/api/moderation/cases',
            method: 'POST',
            body: { content_type: 'rating', content_id: 'r1' },
        })
        await getCase('c1')
        expect(api.request()).toMatchObject({
            url: '/api/moderation/c1',
            method: 'GET',
        })
        await decideCase('c1', { action: 'hide', reason: 'spam' })
        expect(api.request()).toMatchObject({
            url: '/api/moderation/c1',
            method: 'POST',
            body: { action: 'hide', reason: 'spam' },
        })
    })

    it('hides every item of an author', async () => {
        api.respond({ hidden: 3 })
        expect(await hideAuthor('u1', 'spam')).toEqual({ hidden: 3 })
        expect(api.request()).toMatchObject({
            url: '/api/moderation/authors/u1/hide',
            method: 'POST',
            body: { reason: 'spam' },
        })
    })

    it('rejects with an ApiError carrying the status', async () => {
        api.respond({ status: 404, message: 'Not found.', data: {} }, 404)
        const error = await decideCase('c1', {
            action: 'approve',
            reason: '',
        }).catch((err) => err)
        expect(error).toBeInstanceOf(ApiError)
        expect(error.status).toBe(404)
    })
})
