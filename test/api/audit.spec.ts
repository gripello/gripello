import { beforeEach, describe, expect, it } from 'vitest'
import { listGymAudit, listOwnAudit, listPlatformAudit } from '~/api/audit'
import { mockApi } from './apiMock'

let api: ReturnType<typeof mockApi>

beforeEach(() => {
    api = mockApi()
    api.respond({ items: [], page: 1, limit: 48, total: 0 })
})

describe('audit', () => {
    it('lists the rows of a gym with every filter', async () => {
        await listGymAudit('g1', {
            action: 'update',
            collection: 'routes',
            actor: 'guest',
            from: new Date('2026-06-01T00:00:00.000Z'),
            to: '2026-06-30',
            q: ' ada ',
            page: 2,
            limit: 48,
        })
        expect(api.request().url).toBe(
            '/api/gyms/g1/audit?action=update&collection=routes&actor=guest&from=2026-06-01T00:00:00.000Z&to=2026-06-30&q=ada&page=2&limit=48',
        )
    })

    it('leaves out empty filters', async () => {
        await listGymAudit('g1', { action: null, collection: null, q: '' })
        expect(api.request().url).toBe('/api/gyms/g1/audit')
    })

    it('lists the platform rows, optionally of one gym', async () => {
        const result = await listPlatformAudit({ gym: 'g2', page: 1 })
        expect(result.total).toBe(0)
        expect(api.request().url).toBe('/api/platform/audit?gym=g2&page=1')
    })

    it('lists the own rows across gyms', async () => {
        await listOwnAudit({ page: 1 })
        expect(api.request().url).toBe('/api/me/audit?page=1')
    })
})
