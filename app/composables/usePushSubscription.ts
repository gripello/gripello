import type { PushSubscriptionRecord } from '~/types/models'
import type { NotificationTopic } from '~/utils/notificationPrefs'
import {
    browserPushSupport,
    deviceLabel,
    subscriptionKeys,
    urlBase64ToUint8Array,
    type PushSupport,
} from '~/utils/push'

export function usePushSubscription() {
    const pb = usePocketbase()
    const support = ref<PushSupport>('unsupported')
    const publicKey = ref('')
    const topics = ref<NotificationTopic[]>([])
    const devices = ref<PushSubscriptionRecord[]>([])
    const currentEndpoint = ref('')
    const busy = ref(false)
    const loadError = ref(false)

    const available = computed(
        () => support.value === 'ok' && !!publicKey.value,
    )
    const thisDeviceAdded = computed(() =>
        devices.value.some(
            (device) => device.endpoint === currentEndpoint.value,
        ),
    )

    async function browserSubscription() {
        const registration = await navigator.serviceWorker?.getRegistration()
        return (await registration?.pushManager.getSubscription()) ?? null
    }

    async function refresh() {
        loadError.value = false
        support.value = browserPushSupport()
        try {
            const [settings, list, subscription] = await Promise.all([
                pb.send<{ pushKey: string; topics: NotificationTopic[] }>(
                    '/api/notifications/settings',
                    {},
                ),
                pb
                    .collection('push_subscriptions')
                    .getFullList<PushSubscriptionRecord>({ sort: '-created' }),
                support.value === 'ok' ? browserSubscription() : null,
            ])
            topics.value = settings.topics
            publicKey.value = settings.pushKey
            devices.value = list
            currentEndpoint.value = subscription?.endpoint ?? ''
        } catch (err) {
            console.error('Failed to load notification settings:', err)
            loadError.value = true
        }
    }

    async function addThisDevice() {
        busy.value = true
        try {
            if ((await Notification.requestPermission()) !== 'granted')
                return false
            const registration = await navigator.serviceWorker.ready
            const subscription =
                (await registration.pushManager.getSubscription()) ??
                (await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(
                        publicKey.value,
                    ),
                }))
            const device = await pb
                .collection('push_subscriptions')
                .create<PushSubscriptionRecord>({
                    user: pb.authStore.record?.id,
                    device: deviceLabel(navigator.userAgent),
                    ...subscriptionKeys(subscription),
                })
            currentEndpoint.value = subscription.endpoint
            devices.value = [device, ...devices.value]
            return true
        } finally {
            busy.value = false
        }
    }

    async function removeDevice(device: PushSubscriptionRecord) {
        busy.value = true
        try {
            await pb.collection('push_subscriptions').delete(device.id)
            devices.value = devices.value.filter(
                (entry) => entry.id !== device.id,
            )
            if (device.endpoint === currentEndpoint.value) {
                await (await browserSubscription())?.unsubscribe()
                currentEndpoint.value = ''
            }
        } finally {
            busy.value = false
        }
    }

    onMounted(refresh)

    return {
        support,
        topics,
        available,
        devices,
        currentEndpoint,
        thisDeviceAdded,
        busy,
        loadError,
        refresh,
        addThisDevice,
        removeDevice,
    }
}
