<template>
    <div class="flex flex-col gap-3" data-testid="route-reset">
        <ManageRouteFlags
            :route="route"
            :flags="flags"
            :stat="stat"
            :now="now"
        />
        <UButton
            v-if="stat?.open_defects"
            :to="gymPath(`/manage/tasks?q=${encodeURIComponent(route.name)}`)"
            size="sm"
            color="error"
            variant="soft"
            icon="i-lucide-wrench"
            class="self-start"
            data-testid="route-reset-defects"
        >
            {{ t('resets.openDefects', stat.open_defects) }}
        </UButton>
        <dl class="grid grid-cols-3 gap-2 text-center">
            <div
                v-for="fact in facts"
                :key="fact.key"
                class="rounded-md bg-elevated/50 px-2 py-1.5"
                :data-testid="`route-reset-${fact.key}`"
            >
                <dt class="text-xs text-muted">{{ fact.label }}</dt>
                <dd class="font-semibold tabular-nums">{{ fact.value }}</dd>
            </div>
        </dl>
        <div v-if="!route.permanent" class="flex flex-wrap items-center gap-2">
            <UInput
                v-model="plannedFor"
                type="date"
                size="sm"
                class="w-40"
                :min="today"
                :aria-label="t('resets.date')"
                data-testid="route-reset-date"
            />
            <UButton
                size="sm"
                color="primary"
                variant="soft"
                icon="i-lucide-calendar-check"
                :disabled="
                    !plannedFor ||
                    plannedFor < today ||
                    plannedFor === route.removal_planned_for
                "
                :loading="pending"
                data-testid="route-reset-plan"
                @click="plan(plannedFor)"
            >
                {{ t('resets.planAction', 1) }}
            </UButton>
            <UButton
                v-if="route.removal_planned_for"
                size="sm"
                color="error"
                variant="ghost"
                :loading="pending"
                data-testid="route-reset-clear"
                @click="plan(null)"
            >
                {{ t('resets.clear') }}
            </UButton>
        </div>
    </div>
</template>

<script setup lang="ts">
import { planRouteRemoval, type ResetStat } from '~/api/routes'
import type { RouteRecord } from '~/types/models'
import { formatNumber } from '#shared/utils/number'
import {
    ageUnit,
    routeAgeDays,
    weeksFromToday,
    type ResetFlag,
} from '~/utils/wallResets'

const props = defineProps<{
    route: RouteRecord
    flags: ResetFlag[]
    stat?: ResetStat
    now: Date
}>()
const emit = defineEmits<{ changed: [] }>()

const { t, locale } = useI18n()
const gymPath = useGymPath()
const gymId = useCurrentGymId()
const { pending, run } = useAsyncAction()

const plannedFor = ref('')
const today = computed(() => weeksFromToday(0, props.now))
watch(
    () => [props.route.id, props.route.removal_planned_for],
    () => {
        plannedFor.value =
            props.route.removal_planned_for ?? weeksFromToday(1, props.now)
    },
    { immediate: true },
)

const facts = computed(() => {
    const stat = props.stat
    const age = routeAgeDays(props.route, props.now)
    const deviation = stat?.grade_deviation
    return [
        {
            key: 'age',
            label: t('resets.facts.age'),
            value:
                age === null
                    ? '—'
                    : t(`resets.${ageUnit(age).key}`, ageUnit(age).n),
        },
        {
            key: 'recent',
            label: t('resets.facts.recent'),
            value: stat?.recent_ticks ?? 0,
        },
        {
            key: 'ticks',
            label: t('resets.facts.ticks'),
            value: stat?.ticks ?? 0,
        },
        {
            key: 'climbers',
            label: t('resets.facts.climbers'),
            value: stat?.climbers ?? 0,
        },
        {
            key: 'stars',
            label: t('resets.facts.stars'),
            value: stat?.average_rating
                ? `★ ${formatNumber(stat.average_rating, locale.value)} (${stat.ratings})`
                : '—',
        },
        {
            key: 'grade',
            label: t('resets.facts.grade'),
            value:
                deviation === null || deviation === undefined
                    ? '—'
                    : Math.abs(deviation) < 0.5
                      ? t('resets.gradeFeedback.fits')
                      : t(
                            deviation > 0
                                ? 'resets.gradeFeedback.harder'
                                : 'resets.gradeFeedback.easier',
                        ),
        },
    ]
})

async function plan(date: string | null) {
    const saved = await run(
        async () => {
            await planRouteRemoval(gymId.value, [props.route.id], date)
            return true
        },
        { success: t('notifications.success.edit') },
    )
    if (saved) emit('changed')
}
</script>
