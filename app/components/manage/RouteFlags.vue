<template>
    <span
        class="flex flex-wrap items-center gap-x-2 text-xs text-muted tabular-nums"
    >
        <template v-if="route.permanent">{{
            t('climbing.permanent')
        }}</template>
        <template v-else>
            <span
                v-for="flag in flags"
                :key="flag"
                class="flex items-center gap-0.5"
                :class="RESET_FLAG_STYLE[flag].textClass"
                :data-testid="`reset-route-flag-${flag}`"
            >
                <UIcon :name="RESET_FLAG_STYLE[flag].icon" class="size-3" />
                {{ t(`resets.flags.${flag}`) }}
            </span>
            <span v-if="age">{{ t(`resets.${age.key}`, age.n) }}</span>
            <span>{{ t('resets.recentTicks', stat?.recent_ticks ?? 0) }}</span>
            <span v-if="stat?.average_rating"
                >★ {{ formatNumber(stat.average_rating, locale) }}</span
            >
            <span
                v-if="route.removal_planned_for"
                class="flex items-center gap-0.5 text-warning"
            >
                <UIcon name="i-lucide-calendar-clock" class="size-3" />
                {{
                    t('routes.outSoon', {
                        date: formatDate(route.removal_planned_for, {
                            locale,
                        }),
                    })
                }}
            </span>
        </template>
    </span>
</template>

<script setup lang="ts">
import type { ResetStat } from '~/api/routes'
import { formatDate } from '#shared/utils/formatting'
import { formatNumber } from '#shared/utils/number'
import {
    RESET_FLAG_STYLE,
    ageUnit,
    routeAgeDays,
    type PlannableRoute,
    type ResetFlag,
} from '~/utils/wallResets'

const props = defineProps<{
    route: PlannableRoute
    flags: ResetFlag[]
    stat?: ResetStat
    now: Date
}>()

const { t, locale } = useI18n()
const age = computed(() => {
    const days = routeAgeDays(props.route, props.now)
    return days === null ? null : ageUnit(days)
})
</script>
