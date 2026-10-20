import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useAccountExport } from '~/composables/useAccountExport'
import { useAsyncAction } from '~/composables/useAsyncAction'
import { useAuthState } from '~/api/auth'
import { mockApi } from '../api/apiMock'

const notifyError = vi.fn()
vi.stubGlobal('useNotification', () => ({
    success: vi.fn(),
    error: notifyError,
}))

vi.stubGlobal('useAsyncAction', useAsyncAction)
vi.stubGlobal('ref', ref)

let fetchMock: ReturnType<typeof mockApi>['fetchMock']
let api: ReturnType<typeof mockApi>

beforeEach(() => {
    notifyError.mockReset()
    api = mockApi()
    fetchMock = api.fetchMock
    useAuthState().saveAuth({ token: 'token-1', record: { id: 'u1' } as never })
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('useAccountExport', () => {
    it('asks the server to e-mail a link and remembers that it did', async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 202 }))
        const exporter = useAccountExport()
        expect(exporter.requested.value).toBe(false)
        expect(await exporter.request()).toBe(true)
        expect(api.request().url).toBe('/api/me/export')
        expect(api.request().method).toBe('POST')
        expect(api.request().headers.get('Authorization')).toBe(
            'Bearer token-1',
        )
        expect(exporter.requested.value).toBe(true)
    })

    it('tells the user when the rate limit is hit', async () => {
        fetchMock.mockResolvedValue(new Response('{}', { status: 429 }))
        const exporter = useAccountExport()
        expect(await exporter.request()).toBeUndefined()
        expect(exporter.requested.value).toBe(false)
        expect(notifyError).toHaveBeenCalledWith(
            'account.exportDataRateLimited',
        )
    })

    it('shows the generic error otherwise', async () => {
        fetchMock.mockResolvedValue(new Response('{}', { status: 500 }))
        await useAccountExport().request()
        expect(notifyError).toHaveBeenCalledWith('notifications.error.generic')
    })
})
