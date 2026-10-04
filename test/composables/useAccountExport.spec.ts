import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccountExport } from '~/composables/useAccountExport'
import { useAsyncAction } from '~/composables/useAsyncAction'

const saveBlob = vi.fn()
vi.mock('~/utils/download', () => ({
    saveBlob: (...args: unknown[]) => saveBlob(...args),
}))

const notifyError = vi.fn()
vi.stubGlobal('useNotification', () => ({
    success: vi.fn(),
    error: notifyError,
}))
vi.stubGlobal('usePocketbase', () => ({
    buildURL: (path: string) => `http://pb${path}`,
    authStore: { token: 'token-1' },
}))

vi.stubGlobal('useAsyncAction', useAsyncAction)

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
    saveBlob.mockReset()
    notifyError.mockReset()
    fetchMock.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('useAccountExport', () => {
    it('downloads the zip with the auth token', async () => {
        fetchMock.mockResolvedValue(new Response('zip'))
        expect(await useAccountExport().download()).toBe(true)
        expect(fetchMock).toHaveBeenCalledWith('http://pb/api/account/export', {
            headers: { Authorization: 'token-1' },
        })
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
