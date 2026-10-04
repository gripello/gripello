import { describe, expect, it } from 'vitest'
import {
    deviceLabel,
    isMobileDevice,
    pushSupport,
    urlBase64ToUint8Array,
} from '~/utils/push'

const browser = {
    hasPushManager: true,
    hasNotification: true,
    isIos: false,
    isStandalone: false,
}

describe('pushSupport', () => {
    it('allows push in a regular browser tab', () => {
        expect(pushSupport(browser)).toBe('ok')
    })

    it('asks iOS users to install the app first', () => {
        expect(pushSupport({ ...browser, isIos: true })).toBe('install')
        expect(
            pushSupport({ ...browser, isIos: true, isStandalone: true }),
        ).toBe('ok')
    })

    it('reports browsers without the Push API', () => {
        expect(pushSupport({ ...browser, hasPushManager: false })).toBe(
            'unsupported',
        )
    })
})

describe('deviceLabel', () => {
    it.each([
        [
            'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
            'Chrome · Android',
        ],
        [
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
            'Safari · iPhone',
        ],
        [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0',
            'Edge · Windows',
        ],
        [
            'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
            'Firefox · Linux',
        ],
    ])('labels %s', (userAgent, label) => {
        expect(deviceLabel(userAgent)).toBe(label)
    })

    it('marks phones and tablets as mobile', () => {
        expect(isMobileDevice('Safari · iPhone')).toBe(true)
        expect(isMobileDevice('Firefox · Linux')).toBe(false)
    })
})

describe('urlBase64ToUint8Array', () => {
    it('decodes unpadded url-safe base64', () => {
        expect([...urlBase64ToUint8Array('-_8')]).toEqual([0xfb, 0xff])
    })
})
