import { describe, expect, it } from 'vitest'
import type { NuxtApp } from '#app'
import { serverDedupe, sharedAsyncData } from '~/utils/asyncData'

describe('async data sharing', () => {
    const nuxtApp = {
        payload: { data: { locations: ['hall'] } },
    } as unknown as NuxtApp

    it('lets a browser refresh replace a running fetch', () => {
        expect(serverDedupe.dedupe).toBe('cancel')
        expect(sharedAsyncData.dedupe).toBe('cancel')
    })

    it('reuses loaded data on a first read and refetches on refresh', () => {
        expect(
            sharedAsyncData.getCachedData('locations', nuxtApp, {
                cause: 'initial',
            }),
        ).toEqual(['hall'])
        expect(
            sharedAsyncData.getCachedData('locations', nuxtApp, {
                cause: 'refresh:manual',
            }),
        ).toBeUndefined()
    })

    it('never hands one visitor data loaded for another', () => {
        expect(serverDedupe).not.toHaveProperty('getCachedData')
    })
})
