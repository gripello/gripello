import { isAbortOrNetworkError } from '~/utils/errors'
import type { RecordChange } from '~/composables/useRealtime'
import type { NotificationRecord } from '~/types/models'
import {
    deleteNotification,
    listNotifications,
    markNotificationsRead,
} from '~/api/notifications'
import { removeById, upsertById } from '~/utils/realtimeCache'

// live events seen while a list request runs, replayed onto its answer
const eventsDuringRefresh = new Set<RecordChange<NotificationRecord>[]>()

function applyChange(
    items: NotificationRecord[],
    { action, record }: RecordChange<NotificationRecord>,
) {
    return action === 'delete'
        ? removeById(items, record.id)
        : upsertById(items, record, 'start')
}

export function useNotificationQueue() {
    const authStore = useAuthStore()
    const items = useState<NotificationRecord[]>('notification-queue', () => [])
    const loaded = useState<boolean>('notification-queue-loaded', () => false)

    const unreadCount = computed(
        () => items.value.filter((item) => !item.read).length,
    )

    async function refresh() {
        if (!authStore.isValid) {
            items.value = []
            loaded.value = true
            return
        }

        const seen: RecordChange<NotificationRecord>[] = []
        eventsDuringRefresh.add(seen)
        try {
            const { items: listed } = await listNotifications()
            items.value = seen.reduce(applyChange, listed)
            loaded.value = true
        } catch (err) {
            if (isAbortOrNetworkError(err)) return
            console.error('Failed to load notifications:', err)
            loaded.value = true
        } finally {
            eventsDuringRefresh.delete(seen)
        }
    }

    function applyEvent(change: RecordChange<NotificationRecord>) {
        for (const seen of eventsDuringRefresh) seen.push(change)
        items.value = applyChange(items.value, change)
    }

    async function markRead(id: string) {
        const item = items.value.find((entry) => entry.id === id)
        if (!item || item.read) return

        item.read = true
        try {
            await markNotificationsRead({ ids: [id] })
        } catch (err) {
            item.read = false
            console.error('Failed to mark notification read:', err)
        }
    }

    async function markAllRead() {
        const unread = items.value.filter((item) => !item.read)
        if (!unread.length) return

        unread.forEach((item) => (item.read = true))
        try {
            await markNotificationsRead({ ids: unread.map((item) => item.id) })
        } catch (err) {
            unread.forEach((item) => (item.read = false))
            console.error('Failed to mark notifications read:', err)
        }
    }

    async function dismiss(id: string) {
        const index = items.value.findIndex((entry) => entry.id === id)
        if (index === -1) return

        const [removed] = items.value.splice(index, 1)
        try {
            await deleteNotification(id)
        } catch (err) {
            if (removed) items.value.splice(index, 0, removed)
            console.error('Failed to dismiss notification:', err)
        }
    }

    return {
        items,
        loaded,
        unreadCount,
        refresh,
        applyEvent,
        markRead,
        markAllRead,
        dismiss,
    }
}
