import type { PluginListenerHandle } from '@capacitor/core'
import type { PushSubscriptionRecord } from '~/types/models'
import {
    createPushSubscription,
    deletePushSubscription,
    getNotificationSettings,
    listPushSubscriptions,
} from '~/api/notifications'
import {
    browserPushSupport,
    deviceLabel,
    pushDeclinedBy,
    pushReady,
    setPushDeclined,
    shouldOfferPush,
    type PushSupport,
} from '~/utils/push'
import { isNativeApp } from '~/utils/native'
import { onFcmTokenChange, pushDevice } from '~/utils/pushDevice'

const subscribedHere = ref(false)
let fcmTokenFollower: Promise<PluginListenerHandle> | undefined

// Right after an account switch FCM may still be deleting the token register() just handed out; its replacement arrives as a later registration.
function followFcmToken(
    device: PushSubscriptionRecord,
    onEndpoint?: (endpoint: string) => void,
) {
    stopFollowingFcmToken()
    let current = device
    fcmTokenFollower = onFcmTokenChange(async (token) => {
        if (token === current.endpoint) return
        const replaced = current
        current = { ...replaced, endpoint: token }
        try {
            current = await createPushSubscription({
                kind: 'fcm',
                endpoint: token,
                device: replaced.device,
            })
            onEndpoint?.(token)
            await deletePushSubscription(replaced.id).catch(() => null)
        } catch (error) {
            console.error('Storing the new FCM token failed:', error)
        }
    })
}

// The follower belongs to the climber who turned push on; another sign-in must not inherit it.
export function stopFollowingFcmToken() {
    void fcmTokenFollower?.then((handle) => handle.remove())
    fcmTokenFollower = undefined
    subscribedHere.value = false
}

export async function subscribeThisDevice(
    userId: string | undefined,
    publicKey: string,
    onEndpoint?: (endpoint: string) => void,
) {
    const subscription = await pushDevice().subscribe(publicKey)
    if (!subscription) return null
    const device = await createPushSubscription({
        device: deviceLabel(navigator.userAgent),
        ...subscription,
    })
    if (subscription.kind === 'fcm') followFcmToken(device, onEndpoint)
    setPushDeclined(userId, false)
    subscribedHere.value = true
    return { device, endpoint: subscription.endpoint }
}

export function usePushOffer() {
    const authStore = useAuthStore()
    const support = ref<PushSupport>('unsupported')
    const permission = ref<NotificationPermission>()
    const pushKey = ref('')
    const ready = ref(false)
    const hasDevices = ref(false)
    const declined = ref(false)

    const offered = computed(() =>
        shouldOfferPush({
            signedIn: authStore.isValid,
            support: support.value,
            permission: permission.value,
            hasKey: ready.value,
            declined: declined.value,
            subscribedHere: subscribedHere.value,
            hasDevices: hasDevices.value,
        }),
    )

    async function load() {
        support.value = browserPushSupport()
        declined.value = pushDeclinedBy(authStore.record?.id)
        if (support.value !== 'ok' || declined.value) return
        permission.value = await pushDevice().permission()
        if (permission.value === 'denied') return
        const native = isNativeApp()
        // A browser subscription means this device is set up; the app always has an FCM token, so it asks the server.
        if (
            !native &&
            permission.value === 'granted' &&
            (await pushDevice().currentEndpoint())
        ) {
            subscribedHere.value = true
            return
        }
        const [settings, devices] = await Promise.all([
            getNotificationSettings(),
            permission.value === 'granted' ? listPushSubscriptions() : null,
        ])
        if (native && devices?.items.length && pushReady(settings)) {
            const endpoint = await pushDevice().currentEndpoint()
            subscribedHere.value = devices.items.some(
                (device) => device.endpoint === endpoint,
            )
            if (subscribedHere.value) return
        }
        pushKey.value = settings.publicKey
        ready.value = pushReady(settings)
        hasDevices.value = !!devices?.items.length
    }

    async function turnOn() {
        const added = await subscribeThisDevice(
            authStore.record?.id,
            pushKey.value,
        )
        permission.value = await pushDevice().permission()
        return !!added
    }

    onMounted(() => {
        if (!authStore.isValid) return
        load().catch((err) => console.error('Push offer failed:', err))
    })

    return { offered, turnOn }
}
