import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useRouteExport } from '~/composables/useRouteExport'
import { MAX_SHEET_ROUTES, MAX_TAG_ROUTES } from '#shared/utils/routeExport'

const notifyError = vi.fn()
const fetchMock = vi.fn()
vi.stubGlobal('useNotification', () => ({ error: notifyError }))
vi.stubGlobal('useCurrentGymId', () => ref('gym1'))
vi.stubGlobal('ref', ref)
vi.stubGlobal('fetch', fetchMock)

const ids = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`)

beforeEach(() => {
    notifyError.mockReset()
    fetchMock.mockReset()
})

describe('useRouteExport', () => {
    it('refuses selections above the server caps before requesting', async () => {
        const exporter = useRouteExport()
        await exporter.exportPdf(ids(MAX_TAG_ROUTES + 1), {} as never)
        await exporter.exportXlsx(ids(MAX_SHEET_ROUTES + 1), {} as never)
        await exporter.exportJson(ids(MAX_SHEET_ROUTES + 1))
        expect(fetchMock).not.toHaveBeenCalled()
        expect(notifyError).toHaveBeenCalledTimes(3)
        expect(notifyError).toHaveBeenCalledWith('export.tooMany')
    })

    it('sends a selection at the cap', async () => {
        fetchMock.mockResolvedValue(new Response('boom', { status: 500 }))
        vi.spyOn(console, 'error').mockImplementation(() => {})
        await useRouteExport().exportPdf(ids(MAX_TAG_ROUTES), {} as never)
        expect(fetchMock).toHaveBeenCalledOnce()
    })
})
