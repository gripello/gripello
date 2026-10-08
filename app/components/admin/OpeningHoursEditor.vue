<script setup lang="ts">
import {
    HOURS_DAYS,
    WEEKDAYS,
    type GymOpeningHours,
    type HoursDay,
} from '#shared/utils/openingHours'

const hours = defineModel<GymOpeningHours>({ required: true })
const { t, locale } = useI18n()

const dayLabel = (day: HoursDay) =>
    day === 'holiday' ? t('gymInfo.holiday') : weekdayName(day, locale.value)

function addInterval(day: HoursDay) {
    const intervals = hours.value[day] ?? []
    const last = intervals.at(-1)
    hours.value = {
        ...hours.value,
        [day]: [...intervals, last ? [last[1], '22:00'] : ['09:00', '22:00']],
    }
}

function removeInterval(day: HoursDay, index: number) {
    hours.value = {
        ...hours.value,
        [day]: (hours.value[day] ?? []).filter((_, i) => i !== index),
    }
}

function setTime(day: HoursDay, index: number, slot: 0 | 1, time: string) {
    hours.value = {
        ...hours.value,
        [day]: (hours.value[day] ?? []).map((interval, i) =>
            i === index
                ? slot === 0
                    ? [time, interval[1]]
                    : [interval[0], time]
                : interval,
        ),
    }
}

function copyMondayToWeekdays() {
    const monday = hours.value.mon ?? []
    hours.value = {
        ...hours.value,
        ...Object.fromEntries(
            WEEKDAYS.slice(1, 5).map((day) => [
                day,
                monday.map((interval) => [...interval]),
            ]),
        ),
    }
}
</script>

<template>
    <div class="flex flex-col gap-3" data-testid="opening-hours-editor">
        <UFormField
            v-for="day in HOURS_DAYS"
            :key="day"
            :label="dayLabel(day)"
            orientation="horizontal"
            :ui="{
                root: 'grid grid-cols-1 items-start gap-x-2 gap-y-1 sm:grid-cols-[9rem_1fr]',
                labelWrapper: 'flex items-center sm:min-h-9',
                container: 'mt-0 flex min-w-0 flex-col items-start gap-2',
            }"
            :data-testid="`opening-hours-${day}`"
        >
            <div
                v-for="(interval, index) in hours[day] ?? []"
                :key="index"
                class="flex w-full max-w-sm items-center gap-2"
            >
                <UInput
                    :model-value="interval[0]"
                    type="time"
                    class="min-w-0 flex-1"
                    :aria-label="`${dayLabel(day)} ${$t('gymInfo.settings.opens')}`"
                    :data-testid="`opening-hours-${day}-${index}-opens`"
                    @update:model-value="setTime(day, index, 0, String($event))"
                />
                <span aria-hidden="true">–</span>
                <UInput
                    :model-value="interval[1]"
                    type="time"
                    class="min-w-0 flex-1"
                    :aria-label="`${dayLabel(day)} ${$t('gymInfo.settings.closes')}`"
                    :data-testid="`opening-hours-${day}-${index}-closes`"
                    @update:model-value="setTime(day, index, 1, String($event))"
                />
                <UButton
                    icon="i-lucide-x"
                    color="neutral"
                    variant="ghost"
                    class="icon-btn"
                    :aria-label="$t('gymInfo.settings.removeInterval')"
                    :data-testid="`opening-hours-${day}-${index}-remove`"
                    @click="removeInterval(day, index)"
                />
            </div>
            <div class="flex min-h-9 flex-wrap items-center gap-2">
                <UBadge
                    v-if="!hours[day]?.length"
                    color="neutral"
                    variant="soft"
                    :label="$t('gymInfo.closed')"
                />
                <UButton
                    icon="i-lucide-plus"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :label="$t('gymInfo.settings.addInterval')"
                    :data-testid="`opening-hours-${day}-add`"
                    @click="addInterval(day)"
                />
            </div>
        </UFormField>
        <UButton
            icon="i-lucide-copy"
            color="neutral"
            variant="soft"
            size="sm"
            class="self-start"
            :label="$t('gymInfo.settings.copyMonday')"
            data-testid="opening-hours-copy-monday"
            @click="copyMondayToWeekdays"
        />
    </div>
</template>
