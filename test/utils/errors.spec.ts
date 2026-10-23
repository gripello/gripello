import { describe, expect, it, vi } from 'vitest'
import {
    isAbortOrNetworkError,
    isOfflineError,
    isRetryableSaveError,
    keepWhenOffline,
    nullIfNotFound,
    requestErrorKey,
} from '~/utils/errors'

const store = (
    value: unknown,
    { fetched = value != null, error = undefined as unknown } = {},
) => ({
    _asyncData: { key: { data: { value }, error: { value: error } } },
    payload: { data: fetched ? { key: value } : {} },
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

    it('does not mistake the default or data after a failure for loaded data', async () => {
        await expect(
            keepWhenOffline(store([], { fetched: false }), 'key', () =>
                Promise.reject(offline),
            ),
        ).rejects.toBe(offline)
        await expect(
            keepWhenOffline(store([], { error: notFound }), 'key', () =>
                Promise.reject(offline),
            ),
        ).rejects.toBe(offline)
    })

    it('returns fresh data when the refresh succeeds', async () => {
        await expect(
            keepWhenOffline(store({ id: 'old' }), 'key', async () => ({
                id: 'new',
            })),
        ).resolves.toEqual({ id: 'new' })
    })

    it('drops loaded data that no longer fits the request', async () => {
        await expect(
            keepWhenOffline(
                store([{ location: 'hall-a' }]),
                'key',
                () => Promise.reject(offline),
                (rows) => rows.every((row) => row.location === 'hall-b'),
            ),
        ).rejects.toBe(offline)
    })

    it('treats a failure without a connection as offline', async () => {
        const onLine = vi
            .spyOn(navigator, 'onLine', 'get')
            .mockReturnValue(false)
        const swOffline = Object.assign(new Error('Offline'), { status: 503 })
        await expect(
            keepWhenOffline(store({ id: 'e1' }), 'key', () =>
                Promise.reject(swOffline),
            ),
        ).resolves.toEqual({ id: 'e1' })
        onLine.mockRestore()
    })

    it('does not treat server errors as offline where navigator has no onLine', async () => {
        const onLine = vi
            .spyOn(navigator, 'onLine', 'get')
            .mockReturnValue(undefined as unknown as boolean)
        await expect(
            keepWhenOffline(store({ id: 'e1' }), 'key', () =>
                Promise.reject(notFound),
            ),
        ).rejects.toBe(notFound)
        onLine.mockRestore()
    })
})

describe('requestErrorKey', () => {
    it('names a rate limit instead of the generic failure', () => {
        expect(requestErrorKey({ status: 429 }, 'fallback')).toBe(
            'errors.rateLimited',
        )
        expect(requestErrorKey({ status: 500 }, 'fallback')).toBe('fallback')
        expect(requestErrorKey(null, 'fallback')).toBe('fallback')
    })
})

describe('isAbortOrNetworkError', () => {
    it('matches aborted and unreachable requests only', () => {
        expect(isAbortOrNetworkError({ isAbort: true })).toBe(true)
        expect(isAbortOrNetworkError({ status: 0 })).toBe(true)
        expect(isAbortOrNetworkError({ status: 500 })).toBe(false)
        expect(isAbortOrNetworkError(null)).toBe(false)
    })
})

describe('isOfflineError', () => {
    it('treats status 0 as offline but never an abort', () => {
        expect(isOfflineError({ status: 0 })).toBe(true)
        expect(isOfflineError({ status: 0, isAbort: true })).toBe(false)
        expect(isOfflineError({ status: 503 })).toBe(false)
    })
})

describe('isRetryableSaveError', () => {
    it('retries network, rate limit and server failures, not rejections', () => {
        expect(isRetryableSaveError({ status: 0 })).toBe(true)
        expect(isRetryableSaveError({ isAbort: true })).toBe(true)
        expect(isRetryableSaveError({ status: 429 })).toBe(true)
        expect(isRetryableSaveError({ status: 503 })).toBe(true)
        expect(isRetryableSaveError({ status: 400 })).toBe(false)
        expect(isRetryableSaveError({ status: 403 })).toBe(false)
    })
})

describe('nullIfNotFound', () => {
    it('turns only a 404 into null and rethrows everything else', async () => {
        expect(await nullIfNotFound(Promise.resolve('found'))).toBe('found')
        expect(await nullIfNotFound(Promise.reject({ status: 404 }))).toBeNull()
        for (const status of [0, 429, 503])
            await expect(
                nullIfNotFound(Promise.reject({ status })),
            ).rejects.toEqual({ status })
    })
})
