import type { PushSubscriptionRecord } from '~/types/models'
import type { NotificationTopic } from '~/utils/notificationPrefs'
import {
    applyDeviceEvent,
    browserPushSupport,
    setPushDeclined,
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
                    { requestKey: null },
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
            const added = await subscribeThisDevice(pb, publicKey.value)
            if (!added) return false
            const { device, subscription } = added
            currentEndpoint.value = subscription.endpoint
            devices.value = applyDeviceEvent(devices.value, {
                action: 'create',
                record: device,
            })
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
                setPushDeclined(pb.authStore.record?.id, true)
            }
        } finally {
            busy.value = false
        }
    }

    const { subscribe } = usePbSubscription(refresh)

    onMounted(() => {
        void refresh()
        void subscribe('push_subscriptions', (event) => {
            devices.value = applyDeviceEvent(devices.value, event)
        })
    })

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
