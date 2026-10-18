import { Capacitor } from '@capacitor/core'
import { describe, expect, it, vi } from 'vitest'

const browser = vi.hoisted(() => {
    let finished = () => {}
    return {
        finish: () => finished(),
        open: vi.fn(async () => {}),
        addListener: vi.fn(async (_: string, fn: () => void) => {
            finished = fn
            return { remove: vi.fn() }
        }),
    }
})
vi.mock('@capacitor/browser', () => ({ Browser: browser }))
import {
    appLinkPath,
    backAction,
    externalUrl,
    openSignInPage,
    systemAppUrl,
} from '~/utils/native'

describe('backAction', () => {
    it('leaves a fullscreen video first', () => {
        expect(backAction({ dialogShell: 1 }, '/e2e', true)).toBe(
            'exitFullscreen',
        )
    })

    it('closes an open dialog before anything else', () => {
        expect(backAction({ dialogShell: 1 }, null)).toBe('history')
    })

    it('goes back through history when there is an entry', () => {
        expect(backAction({ back: '/e2e/routes' }, '/e2e/routes')).toBe(
            'history',
        )
    })

    it('opens the parent page without history', () => {
        expect(backAction({}, '/e2e/routes')).toBe('parent')
    })

    it('sends the app to the background on a tab root', () => {
        expect(backAction(null, null)).toBe('minimize')
    })
})

describe('appLinkPath', () => {
    const origin = 'https://gripello.app'

    it('keeps path, query and hash of an app link', () => {
        expect(
            appLinkPath('https://gripello.app/route?id=abc#beta', origin),
        ).toBe('/route?id=abc#beta')
    })

    it('resolves the relative links of push notifications', () => {
        expect(appLinkPath('/route?id=abc', origin)).toBe('/route?id=abc')
        expect(appLinkPath('//evil.example/route', origin)).toBeNull()
    })

    it('maps sign-in returns through the app scheme onto the site', () => {
        expect(appLinkPath('app.gripello:/auth/login?oauth2=t', origin)).toBe(
            '/auth/login?oauth2=t',
        )
        expect(appLinkPath('app.gripello://evil.example/x', origin)).toBeNull()
    })

    it('ignores other origins and garbage', () => {
        expect(appLinkPath('https://evil.example/route', origin)).toBeNull()
        expect(appLinkPath('https://[broken', origin)).toBeNull()
    })
})

describe('openSignInPage', () => {
    it('opens the provider in the in-app browser and resolves when it closes', async () => {
        vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
        let done = false
        const opened = openSignInPage('https://accounts.example/auth').then(
            () => (done = true),
        )
        await vi.waitFor(() =>
            expect(browser.open).toHaveBeenCalledWith({
                url: 'https://accounts.example/auth',
            }),
        )
        expect(done).toBe(false)
        browser.finish()
        await opened
        expect(done).toBe(true)
        vi.restoreAllMocks()
    })
})

describe('externalUrl', () => {
    const origin = 'https://gripello.app'

    it('picks out web links to other sites', () => {
        expect(externalUrl('https://github.com/gripello', origin)).toBe(
            'https://github.com/gripello',
        )
        expect(externalUrl('/e2e/tv', origin)).toBeNull()
        expect(externalUrl('https://gripello.app/privacy', origin)).toBeNull()
    })

    it('leaves mail, phone and app links to the system', () => {
        expect(externalUrl('mailto:hi@gripello.app', origin)).toBeNull()
        expect(externalUrl('tel:+4912345', origin)).toBeNull()
        expect(externalUrl('geo:50.1,8.9', origin)).toBeNull()
    })
})

describe('systemAppUrl', () => {
    it('sends directions to the Maps app', () => {
        expect(
            systemAppUrl('https://maps.apple.com/?daddr=50.1,8.9&q=Gym'),
        ).toBe(true)
        expect(
            systemAppUrl(
                'https://www.google.com/maps/dir/?api=1&destination=50.1,8.9',
            ),
        ).toBe(true)
        expect(systemAppUrl('https://maps.google.com/?q=50.1,8.9')).toBe(true)
    })

    it('keeps other sites in the in-app browser tab', () => {
        expect(
            systemAppUrl('https://www.openstreetmap.org/?mlat=50.1&mlon=8.9'),
        ).toBe(false)
        expect(systemAppUrl('https://www.google.com/search?q=maps')).toBe(false)
        expect(systemAppUrl('https://github.com/gripello')).toBe(false)
    })
})
