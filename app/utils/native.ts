import { Capacitor } from '@capacitor/core'

export const isNativeApp = () => Capacitor.isNativePlatform()

export type BackAction = 'exitFullscreen' | 'history' | 'parent' | 'minimize'

export function backAction(
    state: { back?: unknown; dialogShell?: unknown } | null,
    parent: string | null,
    fullscreen = false,
): BackAction {
    if (fullscreen) return 'exitFullscreen'
    if (state?.dialogShell || state?.back) return 'history'
    return parent ? 'parent' : 'minimize'
}

// OAuth callbacks return to the app through its URL scheme (backend authn nativeAppScheme).
export const APP_SCHEME = 'app.gripello:'

export function appLinkPath(url: string, origin: string): string | null {
    try {
        const link = new URL(
            url.startsWith(APP_SCHEME)
                ? origin + url.slice(APP_SCHEME.length)
                : url,
            origin,
        )
        if (link.origin !== origin || link.pathname.startsWith('//'))
            return null
        return link.pathname + link.search + link.hash
    } catch {
        return null
    }
}

export function externalUrl(href: string, origin: string): string | null {
    try {
        const url = new URL(href, origin)
        return /^https?:$/.test(url.protocol) && url.origin !== origin
            ? url.href
            : null
    } catch {
        return null
    }
}

// Opens a page in the in-app browser tab (Custom Tab) and resolves once the user is back.
export async function openInBrowser(url: string) {
    const { Browser } = await import('@capacitor/browser')
    const closed = new Promise<void>((resolve) => {
        const handle = Browser.addListener('browserFinished', () => {
            void handle.then((listener) => listener.remove())
            resolve()
        })
    })
    await Browser.open({ url })
    return closed
}

// Google refuses sign-ins inside WebViews, so the app sends the provider page to the system browser.
export function openSignInPage(url: string): Promise<void> {
    if (isNativeApp()) return openInBrowser(url)
    window.location.assign(url)
    return new Promise(() => {})
}
