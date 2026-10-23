import { liveTopics } from '#shared/utils/topics'
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
    pushReady,
    setPushDeclined,
    type PushSupport,
} from '~/utils/push'
import { pushDevice } from '~/utils/pushDevice'

export function usePushSubscription() {
    const authStore = useAuthStore()
    const support = ref<PushSupport>('unsupported')
    const publicKey = ref('')
    const ready = ref(false)
    const topics = ref<NotificationTopic[]>([])
    const devices = ref<PushSubscriptionRecord[]>([])
    const currentEndpoint = ref('')
    const busy = ref(false)
    const loadError = ref(false)

    const available = computed(() => support.value === 'ok' && ready.value)
    const thisDeviceAdded = computed(() =>
        devices.value.some(
            (device) => device.endpoint === currentEndpoint.value,
        ),
    )

    async function refresh() {
        loadError.value = false
        support.value = browserPushSupport()
        try {
            const [settings, list] = await Promise.all([
                getNotificationSettings(),
                listPushSubscriptions(),
            ])
            topics.value = settings.topics
            publicKey.value = settings.publicKey
            ready.value = pushReady(settings)
            devices.value = list.items
            // A device that can't hand out its token (FCM registration error) still lists the account's devices.
            currentEndpoint.value = available.value
                ? await pushDevice()
                      .currentEndpoint()
                      .catch((err) => {
                          console.error('Push endpoint lookup failed:', err)
                          return ''
                      })
                : ''
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
                (endpoint) => (currentEndpoint.value = endpoint),
            )
            if (!added) return false
            const { device, endpoint } = added
            currentEndpoint.value = endpoint
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
                await pushDevice().unsubscribe()
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
        liveTopics.pushSubscriptions,
        (event: RecordChange<PushSubscriptionRecord>) => {
            devices.value = applyDeviceEvent(devices.value, event)
        },
        { resync: refresh },
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
