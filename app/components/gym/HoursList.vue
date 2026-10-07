<script setup lang="ts">
import {
    HOURS_DAYS,
    type GymOpeningHours,
    type HoursDay,
    type Weekday,
} from '#shared/utils/openingHours'

const props = defineProps<{
    hours?: GymOpeningHours | null
    today?: Weekday | null
}>()
const { t, locale } = useI18n()

function formatDay(day: HoursDay) {
    const intervals = props.hours?.[day]
    if (!intervals?.length) return t('gymInfo.closed')
    return intervals.map(([opens, closes]) => `${opens}–${closes}`).join(', ')
}
</script>

<template>
    <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <template v-for="day in HOURS_DAYS" :key="day">
            <dt
                :class="{ 'font-semibold': day === today }"
                :data-testid="`gym-hours-day-${day}`"
            >
                {{
                    day === 'holiday'
                        ? $t('gymInfo.holiday')
                        : weekdayName(day, locale)
                }}
            </dt>
            <dd
                class="text-right tabular-nums"
                :class="day === today ? 'font-semibold' : 'text-muted'"
            >
                {{ formatDay(day) }}
            </dd>
        </template>
    </dl>
</template>
