import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccountExport } from '~/composables/useAccountExport'
import { useAsyncAction } from '~/composables/useAsyncAction'
import { useAuthState } from '~/api/auth'
import { mockApi } from '../api/apiMock'

const saveBlob = vi.fn()
vi.mock('~/utils/download', () => ({
    saveBlob: (...args: unknown[]) => saveBlob(...args),
}))

const notifyError = vi.fn()
vi.stubGlobal('useNotification', () => ({
    success: vi.fn(),
    error: notifyError,
}))

vi.stubGlobal('useAsyncAction', useAsyncAction)

let fetchMock: ReturnType<typeof mockApi>['fetchMock']
let api: ReturnType<typeof mockApi>

beforeEach(() => {
    saveBlob.mockReset()
    notifyError.mockReset()
    api = mockApi()
    fetchMock = api.fetchMock
    useAuthState().saveAuth({ token: 'token-1', record: { id: 'u1' } as never })
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('useAccountExport', () => {
    it('downloads the zip with the auth token', async () => {
        fetchMock.mockResolvedValue(new Response('zip'))
        expect(await useAccountExport().download()).toBe(true)
        expect(api.request().url).toBe('/api/me/export')
        expect(api.request().headers.get('Authorization')).toBe(
            'Bearer token-1',
        )
        expect(saveBlob).toHaveBeenCalledWith(
            expect.any(Blob),
            expect.stringMatching(/^gripello-data-\d{4}-\d{2}-\d{2}\.zip$/),
        )
    })

    it('tells the user when the rate limit is hit', async () => {
        fetchMock.mockResolvedValue(new Response('{}', { status: 429 }))
        expect(await useAccountExport().download()).toBeUndefined()
        expect(saveBlob).not.toHaveBeenCalled()
        expect(notifyError).toHaveBeenCalledWith(
            'account.exportDataRateLimited',
        )
    })

    it('shows the generic error otherwise', async () => {
        fetchMock.mockResolvedValue(new Response('{}', { status: 500 }))
        await useAccountExport().download()
        expect(notifyError).toHaveBeenCalledWith('notifications.error.generic')
    })
})
