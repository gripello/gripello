export type PushSupport = 'ok' | 'install' | 'unsupported'

export function pushSupport(env: {
    hasPushManager: boolean
    hasNotification: boolean
    isIos: boolean
    isStandalone: boolean
}): PushSupport {
    if (env.isIos && !env.isStandalone) return 'install'
    return env.hasPushManager && env.hasNotification ? 'ok' : 'unsupported'
}

export function browserPushSupport(): PushSupport {
    return pushSupport({
        hasPushManager: 'PushManager' in window,
        hasNotification: 'Notification' in window,
        isIos: /iPad|iPhone|iPod/.test(navigator.userAgent),
        isStandalone:
            matchMedia('(display-mode: standalone)').matches ||
            (navigator as Navigator & { standalone?: boolean }).standalone ===
                true,
    })
}

const BROWSERS: [RegExp, string][] = [
    [/Edg\//, 'Edge'],
    [/OPR\/|Opera/, 'Opera'],
    [/SamsungBrowser/, 'Samsung Internet'],
    [/Firefox\/|FxiOS/, 'Firefox'],
    [/Chrome\/|CriOS/, 'Chrome'],
    [/Safari\//, 'Safari'],
]
const SYSTEMS: [RegExp, string][] = [
    [/iPhone|iPod/, 'iPhone'],
    [/iPad/, 'iPad'],
    [/Android/, 'Android'],
    [/Windows/, 'Windows'],
    [/Mac OS X|Macintosh/, 'macOS'],
    [/CrOS/, 'ChromeOS'],
    [/Linux/, 'Linux'],
]

export function deviceLabel(userAgent: string) {
    const find = (table: [RegExp, string][]) =>
        table.find(([pattern]) => pattern.test(userAgent))?.[1]
    return [find(BROWSERS), find(SYSTEMS)].filter(Boolean).join(' · ')
}

export function isMobileDevice(label: string) {
    return /iPhone|iPad|Android/.test(label)
}

export function urlBase64ToUint8Array(base64: string) {
    const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
        .replace(/-/g, '+')
        .replace(/_/g, '/')
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

export function subscriptionKeys(subscription: PushSubscription) {
    const { endpoint, keys } = subscription.toJSON()
    return { endpoint, p256dh: keys?.p256dh ?? '', auth: keys?.auth ?? '' }
}
