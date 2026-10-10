import type { PushSubscriptionRecord } from '~/types/models'

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
    const { keys } = subscription.toJSON()
    return {
        endpoint: subscription.endpoint,
        p256dh: keys?.p256dh ?? '',
        auth: keys?.auth ?? '',
    }
}

export const PUSH_DECLINED_KEY = 'gripello-push-declined'

export function shouldOfferPush(state: {
    signedIn: boolean
    support: PushSupport
    permission: NotificationPermission | undefined
    hasKey: boolean
    declined: boolean
    subscribedHere: boolean
    hasDevices: boolean
}) {
    if (!state.signedIn || state.support !== 'ok' || !state.hasKey) return false
    if (state.declined || state.subscribedHere) return false
    if (state.permission === 'default') return true
    return state.permission === 'granted' && state.hasDevices
}

function readPushDeclined(): string[] {
    try {
        const ids = JSON.parse(localStorage.getItem(PUSH_DECLINED_KEY) ?? '[]')
        return Array.isArray(ids) ? ids : []
    } catch {
        return []
    }
}

export function pushDeclinedBy(userId: string | undefined) {
    return !!userId && readPushDeclined().includes(userId)
}

export function setPushDeclined(userId: string | undefined, declined: boolean) {
    if (!userId) return
    const others = readPushDeclined().filter((id) => id !== userId)
    try {
        localStorage.setItem(
            PUSH_DECLINED_KEY,
            JSON.stringify(declined ? [...others, userId] : others),
        )
    } catch {}
}

export function applyDeviceEvent(
    devices: PushSubscriptionRecord[],
    event: { action: string; record: PushSubscriptionRecord },
) {
    const others = devices.filter((device) => device.id !== event.record.id)
    return event.action === 'delete' ? others : [event.record, ...others]
}
