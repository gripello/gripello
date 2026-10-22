<template>
    <LayoutPanel
        v-if="hasHours || directionsHref"
        padding="sm"
        data-testid="overview-gym-status"
    >
        <div class="flex items-center gap-x-3 sm:gap-x-4">
            <UBadge
                v-if="status"
                :color="status.open ? 'success' : 'neutral'"
                :variant="status.open ? 'solid' : 'soft'"
                size="lg"
                icon="i-lucide-clock"
                :label="label"
                data-testid="overview-open-status"
            />
            <span
                v-if="todayHours"
                class="min-w-0 truncate text-sm text-muted tabular-nums max-sm:hidden"
                data-testid="overview-today-hours"
                >{{ $t('overview.todayHours', { hours: todayHours }) }}</span
            >
            <div class="ms-auto flex shrink-0 items-center gap-1">
                <UButton
                    v-if="directionsHref"
                    :href="directionsHref"
                    :target="
                        directionsHref.startsWith('geo:') ? undefined : '_blank'
                    "
                    rel="noopener"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-navigation"
                    :aria-label="$t('gymInfo.directions.route')"
                    data-testid="overview-directions"
                >
                    <span class="max-sm:hidden">{{
                        $t('gymInfo.directions.route')
                    }}</span>
                </UButton>
                <UButton
                    :to="gymPath('/info')"
                    color="neutral"
                    variant="ghost"
                    trailing-icon="i-lucide-chevron-right"
                    :aria-label="$t('overview.gymInfo')"
                    data-testid="overview-gym-info"
                >
                    <span class="max-sm:hidden">{{
                        $t('overview.gymInfo')
                    }}</span>
                </UButton>
            </div>
        </div>
    </LayoutPanel>
</template>

<script setup lang="ts">
import {
    formatIntervals,
    hasOpeningHours,
    type GymOpeningHours,
} from '#shared/utils/openingHours'
import type { GymRecord } from '~/types/models'

const props = defineProps<{ gym: GymRecord }>()

const gymPath = useGymPath()
const { status, label, today } = useOpenStatus(() => props.gym.opening_hours)

const todayHours = computed(() => {
    const hours = props.gym.opening_hours as GymOpeningHours | null
    const intervals = today.value && hours?.[today.value]
    return intervals?.length ? formatIntervals(intervals) : ''
})

const directionsHref = useDirectionsHref(() => props.gym)
const hasHours = computed(() => hasOpeningHours(props.gym.opening_hours))
</script>
