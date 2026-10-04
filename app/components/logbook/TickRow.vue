<template>
    <div
        class="flex items-center gap-3 py-2"
        data-testid="logbook-tick"
        :data-tick-id="tick.id"
    >
        <RouteColorDot :color="route?.color" :size="28" />
        <div class="grow logbook-tick__body">
            <NuxtLink
                v-if="route"
                :to="`/route?id=${tick.route}`"
                class="logbook-tick__name"
                data-testid="logbook-tick-route"
            >
                {{ route.name }}
            </NuxtLink>
            <span v-else class="text-muted" data-testid="logbook-tick-removed">
                {{ tick.route_name || $t('ticks.removedRoute') }}
            </span>
            <div class="flex items-center gap-2 mt-1 flex-wrap">
                <UBadge
                    size="sm"
                    variant="solid"
                    :color="TICK_TYPE_COLORS[tick.type]"
                    :icon="TICK_TYPE_ICONS[tick.type]"
                    data-testid="logbook-tick-type"
                >
                    {{ $t(`ticks.types.${tick.type}`) }}
                </UBadge>
                <span
                    v-if="tick.type !== 'flash' && tick.attempts > 1"
                    class="text-xs text-muted"
                    data-testid="logbook-tick-attempts"
                >
                    {{ $t('ticks.attemptCount', { count: tick.attempts }) }}
                </span>
                <UBadge
                    v-if="route?.archived"
                    size="sm"
                    color="neutral"
                    variant="outline"
                >
                    {{ $t('filter.archived') }}
                </UBadge>
                <UBadge
                    v-if="tick.syncFailed"
                    size="sm"
                    color="error"
                    variant="soft"
                    icon="i-lucide-circle-alert"
                    :title="tick.syncFailed"
                    data-testid="logbook-tick-sync-failed"
                >
                    {{ $t('ticks.syncFailed') }}
                </UBadge>
                <UBadge
                    v-else-if="tick.pending"
                    size="sm"
                    color="warning"
                    variant="soft"
                    icon="i-lucide-cloud-off"
                    data-testid="logbook-tick-pending"
                >
                    {{ $t('ticks.pendingSync') }}
                </UBadge>
            </div>
            <p
                v-if="tick.note"
                class="text-xs mt-1 mb-0 text-muted"
                data-testid="logbook-tick-note"
            >
                {{ tick.note }}
            </p>
        </div>
        <GradeLabel :source="tick" />
        <UPopover :content="{ align: 'end', side: 'bottom' }">
            <UButton
                icon="i-lucide-ellipsis-vertical"
                color="neutral"
                variant="ghost"
                size="sm"
                :aria-label="$t('ticks.moreActions')"
                data-testid="logbook-tick-menu"
            />
            <template #content="{ close }">
                <div class="flex min-w-[160px] flex-col p-1">
                    <UButton
                        icon="i-lucide-pencil"
                        color="neutral"
                        variant="ghost"
                        data-testid="logbook-tick-edit"
                        @click="(close(), emit('edit', tick))"
                    >
                        {{ $t('actions.edit') }}
                    </UButton>
                    <UButton
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="ghost"
                        data-testid="logbook-tick-delete"
                        @click="(close(), emit('delete', tick))"
                    >
                        {{ $t('actions.delete') }}
                    </UButton>
                </div>
            </template>
        </UPopover>
    </div>
</template>

<script setup lang="ts">
import type { RouteRecord, TickRecord } from '~/types/models'
import { TICK_TYPE_COLORS, TICK_TYPE_ICONS } from '~/utils/ticks'
import type { PendingTick } from '~/utils/tickOutbox'

const props = defineProps<{
    tick: PendingTick<TickRecord & { expand?: { route?: RouteRecord } }>
}>()

const emit = defineEmits<{
    edit: [tick: TickRecord]
    delete: [tick: TickRecord]
}>()

const route = computed(() => props.tick.expand?.route)
</script>

<style scoped>
.logbook-tick__body {
    min-width: 0;
}

.logbook-tick__name {
    display: block;
    font-weight: 500;
    color: inherit;
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.logbook-tick__name:hover {
    text-decoration: underline;
}
</style>
