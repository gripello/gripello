<template>
    <LayoutPanel
        :title="$t('competitions.scorecard.title')"
        data-testid="competition-scorecard"
    >
        <template #actions>
            <UBadge
                color="success"
                variant="soft"
                size="sm"
                data-testid="scorecard-tops"
            >
                {{
                    $t(
                        'competitions.scorecard.tops',
                        { n: summary.tops },
                        summary.tops,
                    )
                }}
            </UBadge>
            <UBadge
                v-if="summary.flashes"
                color="warning"
                variant="soft"
                size="sm"
            >
                {{
                    $t(
                        'competitions.scorecard.flashes',
                        { n: summary.flashes },
                        summary.flashes,
                    )
                }}
            </UBadge>
            <UBadge
                v-if="pendingCount"
                :color="offline ? 'warning' : 'neutral'"
                variant="outline"
                size="sm"
                icon="i-lucide-cloud-off"
                data-testid="scorecard-pending"
            >
                {{
                    offline
                        ? $t('competitions.scorecard.offline', {
                              n: pendingCount,
                          })
                        : $t('competitions.scorecard.saving')
                }}
            </UBadge>
        </template>

        <SegmentedControl v-model="filter" :items="filterItems" />

        <LayoutEmptyState
            v-if="!visibleRoutes.length"
            icon="i-lucide-check-check"
            :title="$t('competitions.scorecard.nothingHere')"
            :card="false"
        />
        <ul v-else class="divide-y divide-default">
            <li
                v-for="compRoute in visibleRoutes"
                :key="compRoute.id"
                class="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                :data-testid="`scorecard-route-${compRoute.number}`"
            >
                <div
                    class="flex min-w-0 basis-full items-center gap-3 xl:flex-1 xl:basis-0"
                >
                    <span
                        class="w-8 text-center text-lg font-bold tabular-nums text-highlighted"
                        >{{ compRoute.number }}</span
                    >
                    <RouteSummary
                        :route="routeOf(compRoute)"
                        :ticked="!!scoreOf(compRoute).topAttempt"
                        class="flex-1"
                    />
                </div>

                <div class="flex flex-wrap items-center gap-2">
                    <div
                        v-if="isRope"
                        class="flex rounded-md ring ring-default"
                        role="group"
                        :aria-label="$t('competitions.scorecard.style')"
                    >
                        <UButton
                            v-for="style in STYLES"
                            :key="style"
                            size="sm"
                            :color="
                                styleOf(compRoute) === style
                                    ? 'primary'
                                    : 'neutral'
                            "
                            :variant="
                                styleOf(compRoute) === style ? 'soft' : 'ghost'
                            "
                            :aria-pressed="styleOf(compRoute) === style"
                            :data-testid="`scorecard-style-${compRoute.number}-${style}`"
                            @click="act(compRoute, { type: 'style', style })"
                        >
                            {{ $t(`competitions.scorecard.styles.${style}`) }}
                        </UButton>
                    </div>

                    <CompetitionAttemptStepper
                        :attempts="scoreOf(compRoute).attempts"
                        :add-disabled="!!scoreOf(compRoute).topAttempt"
                        test-id-prefix="scorecard"
                        :test-id-suffix="compRoute.number"
                        @undo="act(compRoute, { type: 'undoAttempt' })"
                        @add="act(compRoute, { type: 'attempt' })"
                    />

                    <UButton
                        v-if="compRoute.zone"
                        :color="
                            scoreOf(compRoute).zoneAttempt ? 'info' : 'neutral'
                        "
                        :variant="
                            scoreOf(compRoute).zoneAttempt ? 'soft' : 'outline'
                        "
                        :aria-pressed="!!scoreOf(compRoute).zoneAttempt"
                        :disabled="!!scoreOf(compRoute).topAttempt"
                        :data-testid="`scorecard-zone-${compRoute.number}`"
                        @click="act(compRoute, { type: 'zone' })"
                    >
                        {{ $t('competitions.zone') }}
                    </UButton>
                    <UButton
                        :icon="
                            scoreOf(compRoute).topAttempt
                                ? 'i-lucide-circle-check'
                                : 'i-lucide-flag'
                        "
                        :color="
                            scoreOf(compRoute).topAttempt
                                ? 'success'
                                : 'primary'
                        "
                        :variant="
                            scoreOf(compRoute).topAttempt ? 'solid' : 'soft'
                        "
                        :aria-pressed="!!scoreOf(compRoute).topAttempt"
                        :data-testid="`scorecard-top-${compRoute.number}`"
                        @click="act(compRoute, { type: 'top' })"
                    >
                        {{
                            isFlash(scoreOf(compRoute))
                                ? $t('competitions.scorecard.flash')
                                : $t('competitions.scorecard.top')
                        }}
                    </UButton>
                </div>
            </li>
        </ul>
    </LayoutPanel>
</template>

<script setup lang="ts">
import { listCompetitionRoutes } from '~/api/competitions'
import { EMPTY_SCORE, isFlash } from '~/utils/scorecard'
import type { ClimbStyle } from '#shared/utils/competitionScoring'
import type {
    CompetitionEntryRecord,
    CompetitionRecord,
    CompetitionRouteRecord,
    RouteRecord,
} from '~/types/models'

const STYLES: ClimbStyle[] = ['lead', 'toprope']

const props = defineProps<{
    competition: CompetitionRecord
    entry: CompetitionEntryRecord
}>()

const { t } = useI18n()

const filter = ref<'open' | 'all' | 'topped'>('all')
const entryId = computed(() => props.entry.id)
const { scores, pendingCount, offline, load, act } = useScorecard(
    computed(() => props.competition.id),
    entryId,
)

const isRope = computed(() => props.competition.discipline === 'rope')

const { data: compRoutes } = useAsyncData(
    () => `scorecard-routes:${props.competition.id}`,
    () => listCompetitionRoutes(props.competition.id, { voided: false }),
    { default: () => [] },
)

const scoreOf = (compRoute: CompetitionRouteRecord) =>
    scores.value[compRoute.id] ?? EMPTY_SCORE
const styleOf = (compRoute: CompetitionRouteRecord) =>
    scoreOf(compRoute).style || 'lead'
const routeOf = (compRoute: CompetitionRouteRecord) =>
    compRoute.expand?.route as RouteRecord | undefined

const summary = computed(() => {
    const all = Object.values(scores.value)
    return {
        tops: all.filter((score) => score.topAttempt).length,
        flashes: all.filter(isFlash).length,
    }
})

const filterItems = computed(() => [
    { label: t('competitions.scorecard.filters.all'), value: 'all' as const },
    { label: t('competitions.scorecard.filters.open'), value: 'open' as const },
    {
        label: t('competitions.scorecard.filters.topped'),
        value: 'topped' as const,
    },
])

const visibleRoutes = computed(() =>
    compRoutes.value.filter((compRoute) => {
        const topped = !!scoreOf(compRoute).topAttempt
        if (filter.value === 'open') return !topped
        if (filter.value === 'topped') return topped
        return true
    }),
)

onMounted(() => void load())

const reloadSoon = coalesce(() => load(), 400)
useCompetitionLive(
    computed(() => props.competition.id),
    ({ kind, entry }) => {
        if (
            (kind === 'scores' && entry === props.entry.id) ||
            kind === 'resync'
        ) {
            reloadSoon()
        }
    },
)
</script>
