<template>
    <UPopover
        v-model:open="open"
        :content="{ align: 'end', side: 'bottom', sideOffset: 8 }"
    >
        <UButton
            color="neutral"
            variant="ghost"
            size="xl"
            square
            :aria-label="$t('notifications.center.title')"
            data-testid="notification-bell"
        >
            <UChip
                :show="unreadCount > 0 || pushOffered"
                :color="unreadCount ? 'error' : 'primary'"
                :size="unreadCount ? '3xl' : 'md'"
                :ui="unreadCount ? { base: 'px-1 py-2 text-[10px]' } : {}"
            >
                <template #content>
                    <span v-if="unreadCount" data-testid="notification-badge">{{
                        unreadCount
                    }}</span>
                </template>
                <UIcon name="i-lucide-bell" class="size-6" />
            </UChip>
        </UButton>

        <template #content>
            <div
                class="w-[360px] max-w-[calc(100vw-24px)]"
                data-testid="notification-menu"
            >
                <div class="flex items-center justify-between px-4 py-3 gap-2">
                    <span class="text-sm font-bold">
                        {{ $t('notifications.center.title') }}
                    </span>
                    <UButton
                        v-if="unreadCount"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        data-testid="notification-mark-all"
                        @click="markAllRead"
                    >
                        {{ $t('notifications.center.markAllRead') }}
                    </UButton>
                </div>

                <USeparator />

                <div v-if="pushOffered" class="px-4 py-2">
                    <UButton
                        icon="i-lucide-bell-ring"
                        block
                        data-testid="notification-push-offer"
                        @click="turnOnPush"
                    >
                        {{ $t('accountSettings.push.addDevice') }}
                    </UButton>
                </div>

                <ul class="max-h-[400px] overflow-y-auto py-1">
                    <li
                        v-if="!items.length"
                        class="px-4 py-2 text-sm text-muted"
                        data-testid="notification-empty"
                    >
                        {{ $t('notifications.center.empty') }}
                    </li>

                    <li
                        v-for="item in items"
                        :key="item.id"
                        role="button"
                        tabindex="0"
                        :class="[
                            'notification-item flex cursor-pointer items-center gap-3 px-4 py-2',
                            { 'notification-item--unread': !item.read },
                        ]"
                        :data-testid="`notification-item-${item.id}`"
                        @click="openItem(item)"
                        @keydown.enter.self="openItem(item)"
                    >
                        <UIcon
                            name="i-lucide-circle"
                            :class="[
                                'size-[18px] shrink-0',
                                item.read ? 'text-muted' : 'text-primary',
                            ]"
                        />
                        <div class="min-w-0 flex-1">
                            <div class="text-sm notification-item__title">
                                {{ label(item) }}
                            </div>
                            <div class="text-xs text-muted">
                                {{ timeAgo(item.created, $t, locale) }}
                            </div>
                        </div>
                        <UButton
                            class="icon-btn"
                            icon="i-lucide-x"
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            :aria-label="$t('notifications.center.dismiss')"
                            :title="$t('notifications.center.dismiss')"
                            data-testid="notification-dismiss"
                            @click.stop="dismiss(item.id)"
                        />
                    </li>
                </ul>
            </div>
        </template>
    </UPopover>
</template>

<script setup lang="ts">
import { achievementToast } from '~/utils/achievements'
import { timeAgo } from '#shared/utils/formatting'
import type { RecordChange } from '~/composables/useRealtime'
import type { NotificationRecord } from '~/types/models'
import { liveTopics } from '~/utils/realtimeCache'
import { notificationLabelKey } from '~/utils/notificationLabel'

const { t, locale } = useI18n()
const authStore = useAuthStore()
const {
    items,
    unreadCount,
    refresh,
    applyEvent,
    markRead,
    markAllRead,
    dismiss,
} = useNotificationQueue()

const { error: notifyError, notify } = useNotification()

const open = ref(false)
const { offered: pushOffered, turnOn } = usePushOffer()

function label(item: NotificationRecord) {
    return t(notificationLabelKey(item), item.params ?? {})
}

async function openItem(item: NotificationRecord) {
    await markRead(item.id)
    if (item.url) {
        open.value = false
        await navigateTo(item.url)
    }
}

async function turnOnPush() {
    try {
        await turnOn()
    } catch (err) {
        console.error('Push subscription failed:', err)
        notifyError(t('notifications.error.edit'))
    }
}

useRealtime(
    () => (authStore.isValid ? liveTopics.ownNotifications : null),
    (event: RecordChange<NotificationRecord>) => {
        applyEvent(event)
        const text = achievementToast(event, t)
        if (text) notify(text)
    },
)

onMounted(() => {
    if (authStore.isValid) void refresh()
})
</script>

<style scoped>
.notification-item:hover {
    background: color-mix(in oklab, var(--ui-text-highlighted) 4%, transparent);
}

.notification-item--unread {
    background: color-mix(in oklab, var(--ui-primary) 6%, transparent);
}

.notification-item__title {
    white-space: normal;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
</style>
