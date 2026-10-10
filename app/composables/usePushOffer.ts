import {
    createPushSubscription,
    getNotificationSettings,
    listPushSubscriptions,
} from '~/api/notifications'
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
    userId: string | undefined,
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
    const device = await createPushSubscription({
        device: deviceLabel(navigator.userAgent),
        ...subscriptionKeys(subscription),
    })
    setPushDeclined(userId, false)
    subscribedHere.value = true
    return { device, subscription }
}

export function usePushOffer() {
    const authStore = useAuthStore()
    const support = ref<PushSupport>('unsupported')
    const permission = ref<NotificationPermission>()
    const pushKey = ref('')
    const hasDevices = ref(false)
    const declined = ref(false)

    const offered = computed(() =>
        shouldOfferPush({
            signedIn: authStore.isValid,
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
        declined.value = pushDeclinedBy(authStore.record?.id)
        if (support.value !== 'ok' || declined.value) return
        if (permission.value === 'denied') return
        const registration = await navigator.serviceWorker?.getRegistration()
        subscribedHere.value =
            !!(await registration?.pushManager.getSubscription())
        if (subscribedHere.value) return
        const [settings, devices] = await Promise.all([
            getNotificationSettings(),
            permission.value === 'granted' ? listPushSubscriptions() : null,
        ])
        pushKey.value = settings.publicKey
        hasDevices.value = !!devices?.items.length
    }

    async function turnOn() {
        await subscribeThisDevice(authStore.record?.id, pushKey.value)
        permission.value = Notification.permission
    }

    onMounted(() => {
        if (!authStore.isValid) return
        load().catch((err) => console.error('Push offer failed:', err))
    })

    return { offered, turnOn }
}
