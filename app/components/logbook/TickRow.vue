<template>
    <div
        class="flex items-start gap-2 py-2"
        data-testid="logbook-tick"
        :data-tick-id="tick.id"
    >
        <div class="min-w-0 flex-1">
            <RouteSummary
                :route="summaryRoute"
                :to="route ? `/route?id=${tick.route}` : undefined"
                :data-testid="
                    route ? 'logbook-tick-route' : 'logbook-tick-removed'
                "
            >
                <template #meta>
                    <span class="mt-1 flex flex-wrap items-center gap-2">
                        <UBadge
                            size="sm"
                            variant="soft"
                            :color="TICK_TYPE_COLORS[tick.type]"
                            :icon="TICK_TYPE_ICONS[tick.type]"
                            data-testid="logbook-tick-type"
                        >
                            {{ $t(`ticks.types.${tick.type}`) }}
                        </UBadge>
                        <span
                            v-if="tick.type !== 'flash' && tick.attempts > 1"
                            data-testid="logbook-tick-attempts"
                        >
                            {{
                                $t('ticks.attemptCount', {
                                    count: tick.attempts,
                                })
                            }}
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
                    </span>
                </template>
            </RouteSummary>
            <p
                v-if="tick.note"
                class="mt-1 mb-0 pl-10 text-xs text-muted"
                data-testid="logbook-tick-note"
            >
                {{ tick.note }}
            </p>
        </div>
        <UDropdownMenu
            v-if="!readonly"
            :items="menuItems"
            :content="{ align: 'end' }"
        >
            <UButton
                icon="i-lucide-ellipsis-vertical"
                color="neutral"
                variant="ghost"
                class="icon-btn"
                :aria-label="$t('ticks.moreActions')"
                data-testid="logbook-tick-menu"
            />
        </UDropdownMenu>
    </div>
</template>

<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { RouteRecord, TickRecord } from '~/types/models'
import { TICK_TYPE_COLORS, TICK_TYPE_ICONS } from '~/utils/ticks'
import type { PendingTick } from '~/utils/tickOutbox'

const props = defineProps<{
    tick: PendingTick<TickRecord & { expand?: { route?: RouteRecord } }>
    readonly?: boolean
}>()

const emit = defineEmits<{
    edit: [tick: TickRecord]
    delete: [tick: TickRecord]
}>()

const { t } = useI18n()
const route = computed(() => props.tick.expand?.route)
const summaryRoute = computed(() => ({
    name: route.value?.name || props.tick.route_name || t('ticks.removedRoute'),
    color: route.value?.color,
    grade: props.tick.grade,
    grade_system: props.tick.grade_system,
    grade_index: props.tick.grade_index,
}))
const menuItems = computed<DropdownMenuItem[]>(() => [
    {
        label: t('actions.edit'),
        icon: 'i-lucide-pencil',
        'data-testid': 'logbook-tick-edit',
        onSelect: () => emit('edit', props.tick),
    },
    {
        label: t('actions.delete'),
        icon: 'i-lucide-trash-2',
        color: 'error',
        'data-testid': 'logbook-tick-delete',
        onSelect: () => emit('delete', props.tick),
    },
])
</script>
