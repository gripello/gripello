<template>
    <ul class="flex flex-col gap-1 text-sm">
        <li
            v-for="row in days"
            :key="row.day"
            class="week-hours__day"
            :class="{
                'week-hours__day--today': row.day === today,
                'max-sm:hidden': !row.segments.length && row.day !== today,
            }"
            :data-testid="`gym-hours-day-${row.day}`"
        >
            <span class="truncate">{{ weekdayName(row.day, locale) }}</span>
            <span
                class="week-hours__track"
                :class="{ 'week-hours__track--closed': !row.segments.length }"
                aria-hidden="true"
            >
                <template v-if="row.segments.length">
                    <span
                        v-for="(segment, index) in row.segments"
                        :key="index"
                        class="week-hours__segment"
                        :style="{
                            left: `${segment.from * 100}%`,
                            width: `${(segment.to - segment.from) * 100}%`,
                        }"
                    />
                </template>
                <span
                    v-if="row.day === today && nowAt !== null"
                    class="week-hours__now"
                    :style="{ left: `${nowAt * 100}%` }"
                />
            </span>
            <span class="text-right tabular-nums">{{
                row.shown.length
                    ? formatIntervals(row.shown)
                    : $t('gymInfo.closed')
            }}</span>
        </li>
        <li
            v-if="hours?.holiday?.length"
            class="week-hours__day"
            data-testid="gym-hours-day-holiday"
        >
            <span class="truncate">{{ $t('gymInfo.holiday') }}</span>
            <span />
            <span class="text-right tabular-nums">{{
                formatIntervals(hours.holiday)
            }}</span>
        </li>
    </ul>
</template>

<script setup lang="ts">
import {
    formatIntervals,
    weekTimeline,
    type GymOpeningHours,
    type OpeningInterval,
    type Weekday,
} from '#shared/utils/openingHours'

const props = defineProps<{
    hours?: GymOpeningHours | null
    today?: Weekday | null
}>()

const { locale } = useI18n()
const now = useMountedNow(60_000)

const days = computed(() =>
    weekTimeline(props.hours).map((row, index, week) => ({
        ...row,
        segments: row.segments.filter((segment) => segment.to > segment.from),
        shown: row.intervals.length
            ? row.intervals
            : (props.hours?.[week[(index + 6) % 7]!.day] ?? [])
                  .filter(
                      ([opens, closes]) => closes < opens && closes !== '00:00',
                  )
                  .map(([, closes]): OpeningInterval => ['00:00', closes]),
    })),
)
const nowAt = computed(() =>
    now.value
        ? (now.value.getHours() * 60 + now.value.getMinutes()) / (24 * 60)
        : null,
)
</script>

<style scoped>
@reference "~/assets/css/main.css";

.week-hours__day {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 12px;
    padding: 2px 8px;
    margin: 0 -8px;
    border-radius: 6px;
    color: var(--ui-text-muted);
}

.week-hours__day--today {
    background: color-mix(in oklab, var(--ui-primary) 10%, transparent);
    color: var(--ui-text-highlighted);
    font-weight: 600;
}

.week-hours__track {
    position: relative;
    display: none;
    height: 8px;
    border-radius: 999px;
    background: var(--ui-bg-accented);
}

.week-hours__track--closed {
    background: none;
}

.week-hours__segment {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 999px;
    background: color-mix(in oklab, var(--ui-primary) 45%, transparent);
}

.week-hours__day--today .week-hours__segment {
    background: var(--ui-primary);
}

.week-hours__now {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 2px;
    border-radius: 1px;
    transform: translateX(-50%);
    background: var(--ui-text-highlighted);
}

@variant sm {
    .week-hours__day {
        grid-template-columns: 7rem minmax(0, 1fr) 8rem;
    }

    .week-hours__track {
        display: block;
    }
}
</style>
