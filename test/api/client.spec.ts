import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fileToken, fileUrl, useApi } from '~/api/client'
import { jsonResponse, mockApi } from './apiMock'

let api: ReturnType<typeof mockApi>

beforeEach(() => {
    api = mockApi()
})

describe('useApi', () => {
    it('sends no auth header for guests and includes credentials', async () => {
        await useApi()('/settings')
        const [, init] = api.fetchMock.mock.calls[0] as unknown as [
            string,
            RequestInit,
        ]
        expect(api.request().url).toBe('/api/settings')
        expect(api.request().headers.has('Authorization')).toBe(false)
        expect(init.credentials).toBe('include')
    })

    it('sends its app version and asks for a reload once when the server differs', async () => {
        globalThis.__NUXT_RUNTIME_CONFIG__ = { public: { appVersion: '1.4.9' } }
        const callHook = vi.fn(async () => {})
        vi.stubGlobal('useNuxtApp', () => ({ hooks: { callHook } }))
        const serverVersion = (version: string) => {
            const response = jsonResponse({})
            response.headers.set('X-Gripello-Api-Version', version)
            api.fetchMock.mockResolvedValueOnce(response)
        }

        serverVersion('dev')
        await useApi()('/settings')
        expect(api.request().headers.get('X-Gripello-Api-Version')).toBe(
            '1.4.9',
        )
        expect(callHook).not.toHaveBeenCalled()

        serverVersion('1.5.0')
        await useApi()('/settings')
        serverVersion('1.5.0')
        await useApi()('/settings')
        expect(callHook).toHaveBeenCalledTimes(1)
        expect(callHook).toHaveBeenCalledWith('app:manifest:update')
    })

    it('maps network failures and aborts to status 0', async () => {
        api.fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
        await expect(useApi()('/me')).rejects.toMatchObject({
            status: 0,
            isAbort: false,
        })
        api.fetchMock.mockRejectedValueOnce(
            Object.assign(new Error('aborted'), { name: 'AbortError' }),
        )
        await expect(useApi()('/me')).rejects.toMatchObject({ isAbort: true })
    })

    it('keeps a non-JSON error body out of the response', async () => {
        api.fetchMock.mockResolvedValueOnce(
            new Response('<html>', { status: 502 }),
        )
        const error = await useApi()('/me').catch((e) => e)
        expect(error.status).toBe(502)
        expect(error.response).toEqual({})
    })
})

describe('files', () => {
    it('builds file URLs with thumb and token', () => {
        expect(fileUrl('users', { id: 'u1' }, 'a b.png')).toBe(
            '/api/files/users/u1/a%20b.png',
        )
        expect(
            fileUrl('gyms', { id: 'g1' }, 'logo.png', {
                thumb: '100x100',
                token: 't',
            }),
        ).toBe('/api/files/gyms/g1/logo.png?thumb=100x100&token=t')
        expect(
            fileUrl(
                'users',
                { id: 'u1' },
                '/api/files/users/u1/a.png?thumb=100x100',
                {
                    thumb: '320x320',
                },
            ),
        ).toBe('/api/files/users/u1/a.png?thumb=100x100')
        expect(fileUrl('gyms', { id: 'g1' }, '')).toBe('')
        expect(fileUrl('gyms', null, 'logo.png')).toBe('')
    })

    it('fetches a file token', async () => {
        api.respond({ token: 'ft' })
        expect(await fileToken('tasks', 't1')).toBe('ft')
        expect(api.request()).toMatchObject({
            url: '/api/files/token',
            method: 'POST',
            body: { table: 'tasks', id: 't1' },
        })
    })
})
