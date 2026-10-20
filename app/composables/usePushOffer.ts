import {
    createPushSubscription,
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
import { pushDevice } from '~/utils/pushDevice'

const subscribedHere = ref(false)

export async function subscribeThisDevice(
    userId: string | undefined,
    publicKey: string,
) {
    const subscription = await pushDevice().subscribe(publicKey)
    if (!subscription) return null
    const device = await createPushSubscription({
        device: deviceLabel(navigator.userAgent),
        ...subscription,
    })
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
