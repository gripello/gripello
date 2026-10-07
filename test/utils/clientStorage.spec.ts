import { describe, expect, it } from 'vitest'
import en from '../../i18n/locales/en.json'
import { CLIENT_STORAGE } from '../../app/utils/clientStorage'

const storage = en.legal.storage as unknown as Record<
    'kinds' | 'purposes' | 'durations',
    Record<string, string>
>

describe('client storage disclosure', () => {
    it('has a label for every kind, purpose and duration', () => {
        for (const entry of CLIENT_STORAGE) {
            expect(storage.kinds[entry.kind], entry.name).toBeTruthy()
            expect(storage.purposes[entry.purpose], entry.name).toBeTruthy()
            expect(storage.durations[entry.duration], entry.name).toBeTruthy()
        }
    })

    it('lists the map type key and the service worker caches', () => {
        const names = CLIENT_STORAGE.map((entry) => entry.name)
        expect(names).toContain('map-route-type')
        expect(names).toContain('gripello-*')
    })
})
