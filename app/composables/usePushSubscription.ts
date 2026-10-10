import type { PushSubscriptionRecord } from '~/types/models'
import type { RecordChange } from '~/composables/useRealtime'
import type { NotificationTopic } from '~/utils/notificationPrefs'
import {
    deletePushSubscription,
    getNotificationSettings,
    listPushSubscriptions,
    sendTestPush,
} from '~/api/notifications'
import {
    applyDeviceEvent,
    browserPushSupport,
    setPushDeclined,
    type PushSupport,
} from '~/utils/push'

export function usePushSubscription() {
    const authStore = useAuthStore()
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
                getNotificationSettings(),
                listPushSubscriptions(),
                support.value === 'ok' ? browserSubscription() : null,
            ])
            topics.value = settings.topics
            publicKey.value = settings.publicKey
            devices.value = list.items
            currentEndpoint.value = subscription?.endpoint ?? ''
        } catch (err) {
            console.error('Failed to load notification settings:', err)
            loadError.value = true
        }
    }

    async function addThisDevice() {
        busy.value = true
        try {
            const added = await subscribeThisDevice(
                authStore.record?.id,
                publicKey.value,
            )
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
            await deletePushSubscription(device.id)
            devices.value = devices.value.filter(
                (entry) => entry.id !== device.id,
            )
            if (device.endpoint === currentEndpoint.value) {
                await (await browserSubscription())?.unsubscribe()
                currentEndpoint.value = ''
                setPushDeclined(authStore.record?.id, true)
            }
        } finally {
            busy.value = false
        }
    }

    function sendTest() {
        return sendTestPush(currentEndpoint.value)
    }

    useRealtime(
        'push_subscriptions',
        (event: RecordChange<PushSubscriptionRecord>) => {
            devices.value = applyDeviceEvent(devices.value, event)
        },
        { onReactivate: refresh },
    )

    onMounted(() => void refresh())

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
        sendTest,
    }
}
