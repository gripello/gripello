import { useTickOutbox } from '~/composables/useTickOutbox'
import type { TickRecord } from '~/types/models'

describe('useTickOutbox', () => {
    it('asks the browser to keep storage once a tick waits offline', async () => {
        globalThis.__POCKETBASE_CLIENT__ = {
            collection: () => ({
                create: () => Promise.reject({ status: 0 }),
            }),
        }
        vi.stubGlobal('indexedDB', { open: () => ({}) })
        const persist = vi.fn().mockResolvedValue(true)
        vi.stubGlobal('navigator', { ...navigator, storage: { persist } })

        const { queued } = await useTickOutbox().createTick({
            user: 'anna',
            route: 'r1',
        } as Omit<TickRecord, 'id'>)

        expect(queued).toBe(true)
        expect(persist).toHaveBeenCalledOnce()
    })
})
