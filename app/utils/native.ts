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

// Directions belong in the Maps app; the OS hands these links to it, the in-app browser tab would not.
export function systemAppUrl(url: string): boolean {
    const { hostname, pathname } = new URL(url)
    if (hostname === 'maps.apple.com' || hostname === 'maps.google.com')
        return true
    return (
        (hostname === 'www.google.com' || hostname === 'google.com') &&
        pathname.startsWith('/maps')
    )
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

export const WEBVIEW_STORE_URL =
    'https://play.google.com/store/apps/details?id=com.google.android.webview'

// Tailwind 4 needs color-mix() (Chrome 111, Safari 16.4); without it soft colours fall back to solid fills.
export function rendersModernCss(
    css: Pick<typeof CSS, 'supports'> | undefined,
) {
    return !!css?.supports('color', 'color-mix(in lab, red, red)')
}

// Android shows no system notification while the app is open; the app turns it into a toast instead.
export function foregroundPush(notification: {
    title?: string
    body?: string
    data?: Record<string, unknown>
}) {
    const url = notification.data?.url
    return {
        text: [notification.title, notification.body]
            .filter(Boolean)
            .join(' · '),
        url: typeof url === 'string' ? url : null,
    }
}

export const SYSTEM_THEME_EVENT = 'gripello:system-theme'

export function followSystemTheme(
    colorMode: { preference: string; value: string; forced?: boolean },
    theme: unknown,
) {
    if (colorMode.preference !== 'system' || colorMode.forced) return
    if (theme === 'dark' || theme === 'light') colorMode.value = theme
}
