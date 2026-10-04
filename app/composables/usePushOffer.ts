import type { PushSubscriptionRecord } from '~/types/models'
import {
    browserPushSupport,
    deviceLabel,
    pushDeclinedBy,
    setPushDeclined,
    shouldOfferPush,
    subscriptionKeys,
    urlBase64ToUint8Array,
    type PushSupport,
} from '~/utils/push'

const subscribedHere = ref(false)

export async function subscribeThisDevice(
    pb: ReturnType<typeof usePocketbase>,
    publicKey: string,
) {
    if ((await Notification.requestPermission()) !== 'granted') return null
    const registration = await navigator.serviceWorker.ready
    const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
        }))
    const device = await pb
        .collection('push_subscriptions')
        .create<PushSubscriptionRecord>({
            user: pb.authStore.record?.id,
            device: deviceLabel(navigator.userAgent),
            ...subscriptionKeys(subscription),
        })
    setPushDeclined(pb.authStore.record?.id, false)
    subscribedHere.value = true
    return { device, subscription }
}

export function usePushOffer() {
    const pb = usePocketbase()
    const support = ref<PushSupport>('unsupported')
    const permission = ref<NotificationPermission>()
    const pushKey = ref('')
    const hasDevices = ref(false)
    const declined = ref(false)

    const offered = computed(() =>
        shouldOfferPush({
            signedIn: pb.authStore.isValid,
            support: support.value,
            permission: permission.value,
            hasKey: !!pushKey.value,
            declined: declined.value,
            subscribedHere: subscribedHere.value,
            hasDevices: hasDevices.value,
        }),
    )

    async function load() {
        support.value = browserPushSupport()
        permission.value = window.Notification?.permission
        declined.value = pushDeclinedBy(pb.authStore.record?.id)
        if (support.value !== 'ok' || declined.value) return
        if (permission.value === 'denied') return
        const registration = await navigator.serviceWorker?.getRegistration()
        subscribedHere.value =
            !!(await registration?.pushManager.getSubscription())
        if (subscribedHere.value) return
        const [settings, devices] = await Promise.all([
            pb.send<{ pushKey: string }>('/api/notifications/settings', {}),
            permission.value === 'granted'
                ? pb
                      .collection('push_subscriptions')
                      .getList(1, 1, { fields: 'id', skipTotal: true })
                : null,
        ])
        pushKey.value = settings.pushKey
        hasDevices.value = !!devices?.items.length
    }

    async function turnOn() {
        await subscribeThisDevice(pb, pushKey.value)
        permission.value = Notification.permission
    }

    onMounted(() => {
        if (!pb.authStore.isValid) return
        load().catch((err) => console.error('Push offer failed:', err))
    })

    return { offered, turnOn }
}
