import { describe, expect, it } from 'vitest'
import { keepWhenOffline } from '~/utils/errors'

const store = (value: unknown) => ({
    _asyncData: { key: { data: { value } } },
})
const offline = Object.assign(new Error('Failed to fetch'), { status: 0 })
const notFound = Object.assign(new Error('Not found'), { status: 404 })

describe('keepWhenOffline', () => {
    it('keeps the loaded data when a refresh has no network', async () => {
        await expect(
            keepWhenOffline(store({ id: 'e1' }), 'key', () =>
                Promise.reject(offline),
            ),
        ).resolves.toEqual({ id: 'e1' })
    })

    it('still fails when nothing was loaded or the server answered', async () => {
        await expect(
            keepWhenOffline(store(null), 'key', () => Promise.reject(offline)),
        ).rejects.toBe(offline)
        await expect(
            keepWhenOffline(store({ id: 'e1' }), 'key', () =>
                Promise.reject(notFound),
            ),
        ).rejects.toBe(notFound)
    })

    it('returns fresh data when the refresh succeeds', async () => {
        await expect(
            keepWhenOffline(store({ id: 'old' }), 'key', async () => ({
                id: 'new',
            })),
        ).resolves.toEqual({ id: 'new' })
    })
})
