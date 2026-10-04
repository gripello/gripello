import { describe, expect, it } from 'vitest'
import {
    applyDeviceEvent,
    deviceLabel,
    isMobileDevice,
    pushSupport,
    PUSH_DECLINED_KEY,
    pushDeclinedBy,
    setPushDeclined,
    shouldOfferPush,
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

describe('shouldOfferPush', () => {
    const offer = {
        signedIn: true,
        support: 'ok' as const,
        permission: 'default' as NotificationPermission,
        hasKey: true,
        declined: false,
        subscribedHere: false,
        hasDevices: false,
    }
    const granted = { ...offer, permission: 'granted' as const }

    it('offers push while the browser has not asked yet', () => {
        expect(shouldOfferPush(offer)).toBe(true)
        expect(shouldOfferPush({ ...offer, permission: 'denied' })).toBe(false)
    })

    it('never offers to guests, unsupported browsers or without a key', () => {
        expect(shouldOfferPush({ ...offer, signedIn: false })).toBe(false)
        expect(shouldOfferPush({ ...offer, support: 'install' })).toBe(false)
        expect(shouldOfferPush({ ...offer, hasKey: false })).toBe(false)
    })

    it('offers again after signing back in when the account uses push', () => {
        expect(shouldOfferPush({ ...granted, hasDevices: true })).toBe(true)
        expect(shouldOfferPush(granted)).toBe(false)
        expect(
            shouldOfferPush({
                ...granted,
                hasDevices: true,
                subscribedHere: true,
            }),
        ).toBe(false)
    })

    it('stays quiet once this device subscribed, even with a stale permission', () => {
        expect(shouldOfferPush({ ...offer, subscribedHere: true })).toBe(false)
    })

    it('stays quiet after push was removed on this device', () => {
        expect(
            shouldOfferPush({ ...granted, hasDevices: true, declined: true }),
        ).toBe(false)
    })
})

describe('pushDeclinedBy', () => {
    it('remembers the decision per user', () => {
        localStorage.clear()
        setPushDeclined('a', true)
        setPushDeclined('b', true)
        setPushDeclined('b', false)
        expect(pushDeclinedBy('a')).toBe(true)
        expect(pushDeclinedBy('b')).toBe(false)
        expect(pushDeclinedBy(undefined)).toBe(false)
    })

    it('ignores corrupt storage', () => {
        localStorage.setItem(PUSH_DECLINED_KEY, '{')
        expect(pushDeclinedBy('a')).toBe(false)
    })
})

describe('applyDeviceEvent', () => {
    const phone = { id: 'p', endpoint: 'e1' } as any
    const laptop = { id: 'l', endpoint: 'e2' } as any

    it('adds a device registered elsewhere once', () => {
        const added = applyDeviceEvent([phone], {
            action: 'create',
            record: laptop,
        })
        expect(added).toEqual([laptop, phone])
        expect(
            applyDeviceEvent(added, { action: 'create', record: laptop }),
        ).toEqual([laptop, phone])
    })

    it('drops a removed device', () => {
        expect(
            applyDeviceEvent([laptop, phone], {
                action: 'delete',
                record: phone,
            }),
        ).toEqual([laptop])
    })
})
