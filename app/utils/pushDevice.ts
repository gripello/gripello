import {
    getNotificationSettings,
    type PushSubscriptionInput,
} from '~/api/notifications'
import { isNativeApp } from './native'
import { subscriptionKeys, urlBase64ToUint8Array } from './push'

export interface PushDevice {
    permission(): Promise<NotificationPermission | undefined>
    currentEndpoint(): Promise<string>
    subscribe(publicKey: string): Promise<PushSubscriptionInput | null>
    unsubscribe(): Promise<void>
}

const webPushDevice: PushDevice = {
    async permission() {
        return window.Notification?.permission
    },
    async currentEndpoint() {
        return (await browserSubscription())?.endpoint ?? ''
    },
    async subscribe(publicKey) {
        if ((await Notification.requestPermission()) !== 'granted') return null
        const registration = await navigator.serviceWorker.ready
        const subscription =
            (await registration.pushManager.getSubscription()) ??
            (await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey),
            }))
        return subscriptionKeys(subscription)
    },
    async unsubscribe() {
        await (await browserSubscription())?.unsubscribe()
    },
}

async function browserSubscription() {
    const registration = await navigator.serviceWorker?.getRegistration()
    return (await registration?.pushManager.getSubscription()) ?? null
}

// Capacitor plugins are proxies that also answer `then`, so a promise must resolve to the module, never the plugin.
const pluginModule = () => import('@capacitor/push-notifications')

// Without FCM (no google-services.json behind a server without FCM_CREDENTIALS) any plugin call crashes the app.
let fcmConfigured: Promise<boolean> | null = null
const nativePushConfigured = () =>
    (fcmConfigured ??= getNotificationSettings()
        .then((settings) => settings.native)
        .catch(() => {
            fcmConfigured = null
            return false
        }))

// The plugin hands out the FCM token only through the registration event that register() fires.
async function fcmToken() {
    const { PushNotifications: plugin } = await pluginModule()
    return new Promise<string>((resolve, reject) => {
        const listeners = Promise.all([
            plugin.addListener('registration', ({ value }) => {
                done()
                resolve(value)
            }),
            plugin.addListener('registrationError', ({ error }) => {
                done()
                reject(new Error(error))
            }),
        ])
        const done = () =>
            void listeners.then((handles) =>
                handles.forEach((handle) => void handle.remove()),
            )
        void listeners.then(() => plugin.register()).catch(reject)
    })
}

export const nativePermission = (
    state: string,
): NotificationPermission | undefined =>
    state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'default'

const nativePushDevice: PushDevice = {
    async permission() {
        return nativePermission(
            (await (await pluginModule()).PushNotifications.checkPermissions())
                .receive,
        )
    },
    async currentEndpoint() {
        if (!(await nativePushConfigured())) return ''
        return (await this.permission()) === 'granted' ? fcmToken() : ''
    },
    async subscribe() {
        if (!(await nativePushConfigured())) return null
        const { receive } = await (
            await pluginModule()
        ).PushNotifications.requestPermissions()
        if (receive !== 'granted') return null
        return { kind: 'fcm', endpoint: await fcmToken() }
    },
    async unsubscribe() {
        if (await nativePushConfigured())
            await (await pluginModule()).PushNotifications.unregister()
    },
}

export const pushDevice = () =>
    isNativeApp() ? nativePushDevice : webPushDevice
