<template>
    <LayoutListGroup
        v-if="routes.length"
        class="scope-list scope-list--page overflow-y-auto"
    >
        <li
            v-for="route in routes"
            :key="route.id"
            class="scope-row flex items-center px-4 py-1.5"
            :data-testid="`inventory-${rowPrefix}-${route.id}`"
        >
            <span v-if="mode === 'missing'" class="anchor-badge">
                {{ formatAnchorPoint(route.anchor_point) }}
            </span>
            <UIcon
                v-else
                name="i-lucide-circle-check"
                class="mr-3 size-[16px] text-success"
            />
            <RouteSummary :route="route" size="sm" class="mr-2 flex-1" />
            <UButton
                :icon="
                    mode === 'missing' ? 'i-lucide-check' : 'i-lucide-undo-2'
                "
                color="neutral"
                variant="ghost"
                class="icon-btn"
                :aria-label="actionLabel"
                :data-testid="`inventory-${actionPrefix}-${route.id}`"
                @click="emit('action', route)"
            />
        </li>
    </LayoutListGroup>

    <LayoutEmptyState v-else :icon="emptyIcon" :title="emptyTitle" />
</template>

<script setup lang="ts">
import { formatAnchorPoint } from '#shared/utils/formatting'
import type { RouteRecord } from '~/types/models'

const props = defineProps<{
    routes: RouteRecord[]
    mode: 'missing' | 'found'
    emptyIcon: string
    emptyTitle: string
}>()

const emit = defineEmits<{ (e: 'action', route: RouteRecord): void }>()

const { t } = useI18n()

const rowPrefix = computed(() =>
    props.mode === 'missing' ? 'missing' : 'scanned',
)
const actionPrefix = computed(() =>
    props.mode === 'missing' ? 'mark' : 'undo',
)
const actionLabel = computed(() =>
    props.mode === 'missing' ? t('inventory.markFound') : t('inventory.undo'),
)
</script>
