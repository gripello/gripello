<template>
    <div class="mx-auto w-full p-4">
        <LayoutPageHeader
            :title="t('competitions.judge.title')"
            :back-to="competition ? backTo : undefined"
            :back-label="
                backTo === JUDGE_PICKER
                    ? t('competitions.judge.title')
                    : competition?.name
            "
        >
            <template v-if="competitionItems.length > 1" #actions>
                <USelect
                    :model-value="competitionId"
                    :items="competitionItems"
                    class="min-w-48"
                    :aria-label="t('competitions.judge.competition')"
                    data-testid="judge-competition-switch"
                    @update:model-value="switchCompetition"
                />
            </template>
        </LayoutPageHeader>

        <template v-if="competition">
            <div
                class="sticky top-(--ui-header-height) z-10 -mx-4 mb-3 flex flex-col gap-2 bg-default px-4 py-2 lg:bg-(--app-bg)"
            >
                <div
                    class="flex gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible"
                    role="tablist"
                    data-testid="judge-routes"
                >
                    <UButton
                        v-for="compRoute in compRoutes"
                        :key="compRoute.id"
                        role="tab"
                        size="lg"
                        :aria-selected="compRoute.id === routeId"
                        :color="
                            compRoute.id === routeId ? 'primary' : 'neutral'
                        "
                        :variant="
                            compRoute.id === routeId ? 'solid' : 'outline'
                        "
                        class="max-w-full shrink-0 tabular-nums"
                        :data-testid="`judge-route-${compRoute.number}`"
                        :data-route-chip="compRoute.id"
                        @click="pickedRouteId = compRoute.id"
                    >
                        <RouteColorDot
                            :color="routeOf(compRoute)?.color"
                            :size="14"
                        />
                        <span class="font-bold">{{ compRoute.number }}</span>
                        <span class="truncate">{{
                            routeOf(compRoute)?.name
                        }}</span>
                        <span class="text-xs opacity-70"
                            >{{ toppedByRoute.get(compRoute.id) ?? 0 }}/{{
                                entries.length
                            }}</span
                        >
                    </UButton>
                </div>
                <div
                    v-if="currentRoute"
                    class="flex flex-col gap-2 lg:flex-row lg:items-center"
                >
                    <div
                        class="flex min-w-0 flex-1 items-center gap-3"
                        data-testid="judge-route-name"
                    >
                        <span
                            class="text-lg font-bold tabular-nums text-highlighted"
                            >{{ currentRoute.number }}</span
                        >
                        <RouteSummary
                            :route="routeOf(currentRoute)"
                            size="lg"
                            class="min-w-0"
                        >
                            <template #meta>
                                <span data-testid="judge-route-details">{{
                                    [
                                        translatedColorName(
                                            t,
                                            routeOf(currentRoute)?.color,
                                        ),
                                        wallOf(currentRoute),
                                    ]
                                        .filter(Boolean)
                                        .join(' · ')
                                }}</span>
                            </template>
                        </RouteSummary>
                    </div>
                    <div class="flex gap-2">
                        <UInput
                            v-model="search"
                            icon="i-lucide-search"
                            size="lg"
                            enterkeyhint="search"
                            :placeholder="t('competitions.searchEntries')"
                            :aria-label="t('competitions.searchEntries')"
                            class="min-w-0 flex-1 lg:w-64"
                            data-testid="judge-search"
                            @keydown.esc="search = ''"
                        />
                        <SegmentedControl
                            v-model="filter"
                            :items="filterItems"
                            test-id="judge-filter"
                            class="shrink-0"
                        />
                    </div>
                </div>
            </div>

            <LayoutEmptyState
                v-if="!compRoutes.length"
                icon="i-lucide-mountain"
                :title="t(`competitions.items.${competition.discipline}.empty`)"
                :card="false"
            />
            <LayoutEmptyState
                v-else-if="!entries.length"
                icon="i-lucide-users"
                :title="t('competitions.noEntries')"
                :card="false"
            />
            <ul v-else-if="currentRoute" class="flex flex-col gap-2">
                <li
                    v-for="entry in visibleEntries"
                    :key="entry.id"
                    class="flex flex-col gap-3 rounded-lg p-3 ring sm:flex-row sm:items-center"
                    :class="
                        isTopped(entry)
                            ? 'bg-success/5 ring-success/40'
                            : 'bg-default ring-default'
                    "
                    :data-testid="`judge-entry-${entry.bib}`"
                >
                    <div class="flex min-w-0 flex-1 items-center gap-3">
                        <span
                            class="w-10 text-center text-lg font-bold tabular-nums text-highlighted"
                            >{{ entry.bib }}</span
                        >
                        <div class="min-w-0 flex-1">
                            <p
                                class="flex min-w-0 items-center gap-2 font-medium text-highlighted"
                            >
                                <span class="truncate">{{
                                    entry.display_name
                                }}</span>
                                <UIcon
                                    v-if="saving.has(entry.id)"
                                    name="i-lucide-loader-circle"
                                    class="size-4 shrink-0 animate-spin text-muted"
                                />
                            </p>
                            <p class="truncate text-xs text-muted">
                                {{ categoryNames.get(entry.category) }}
                            </p>
                            <div class="flex flex-wrap gap-1">
                                <UBadge
                                    v-for="flag in flags.get(entry.id) ?? []"
                                    :key="flag"
                                    color="warning"
                                    variant="soft"
                                    size="sm"
                                    icon="i-lucide-triangle-alert"
                                    :data-testid="`judge-flag-${entry.bib}-${flag}`"
                                >
                                    {{ t(`competitions.judge.flags.${flag}`) }}
                                </UBadge>
                            </div>
                        </div>
                    </div>

                    <div
                        v-if="isLeadHeight"
                        class="flex flex-wrap items-center justify-end gap-2"
                    >
                        <UInputNumber
                            :model-value="heightOf(entry)"
                            :min="0"
                            :max="currentRoute.hold_count || 200"
                            :aria-label="t('competitions.judge.height')"
                            size="lg"
                            class="w-36"
                            :data-testid="`judge-height-${entry.bib}`"
                            @update:model-value="
                                (height) =>
                                    saveHeight(
                                        entry,
                                        height ?? 0,
                                        plusOf(entry),
                                    )
                            "
                        />
                        <UButton
                            :color="plusOf(entry) ? 'primary' : 'neutral'"
                            :variant="plusOf(entry) ? 'soft' : 'outline'"
                            :aria-pressed="plusOf(entry)"
                            size="lg"
                            :data-testid="`judge-plus-${entry.bib}`"
                            @click="togglePlus(entry)"
                        >
                            +
                        </UButton>
                        <UButton
                            v-if="currentRoute.hold_count"
                            icon="i-lucide-flag"
                            :color="
                                heightOf(entry) === currentRoute.hold_count
                                    ? 'success'
                                    : 'neutral'
                            "
                            variant="soft"
                            size="lg"
                            :data-testid="`judge-top-${entry.bib}`"
                            @click="
                                saveHeight(
                                    entry,
                                    currentRoute.hold_count,
                                    false,
                                )
                            "
                        >
                            {{ t('competitions.scorecard.top') }}
                        </UButton>
                    </div>

                    <div
                        v-else
                        class="flex flex-wrap items-center justify-end gap-2"
                    >
                        <CompetitionAttemptStepper
                            :attempts="stateOf(entry).attempts"
                            :add-disabled="!!stateOf(entry).topAttempt"
                            size="lg"
                            test-id-prefix="judge"
                            :test-id-suffix="entry.bib"
                            @undo="act(entry, { type: 'undoAttempt' })"
                            @add="act(entry, { type: 'attempt' })"
                        />
                        <UButton
                            v-if="currentRoute.zone"
                            :color="
                                stateOf(entry).zoneAttempt ? 'info' : 'neutral'
                            "
                            :variant="
                                stateOf(entry).zoneAttempt ? 'soft' : 'outline'
                            "
                            size="lg"
                            :disabled="!!stateOf(entry).topAttempt"
                            :data-testid="`judge-zone-${entry.bib}`"
                            @click="act(entry, { type: 'zone' })"
                        >
                            {{ t('competitions.zone') }}
                        </UButton>
                        <UButton
                            :color="
                                stateOf(entry).topAttempt
                                    ? 'success'
                                    : 'primary'
                            "
                            :variant="
                                stateOf(entry).topAttempt ? 'solid' : 'soft'
                            "
                            size="lg"
                            :icon="
                                stateOf(entry).topAttempt
                                    ? 'i-lucide-circle-check'
                                    : 'i-lucide-flag'
                            "
                            :data-testid="`judge-top-${entry.bib}`"
                            @click="act(entry, { type: 'top' })"
                        >
                            {{
                                isFlash(stateOf(entry))
                                    ? t('competitions.scorecard.flash')
                                    : t('competitions.scorecard.top')
                            }}
                        </UButton>
                    </div>
                </li>
            </ul>
        </template>
    </div>
</template>

<script setup lang="ts">
import {
    getCompetition,
    listCategories,
    listCompetitionRoutes,
    listEntries,
    listScores,
    putScores,
    type ScoreInput,
} from '~/api/competitions'
import { translatedColorName } from '~/utils/colorName'
import {
    applyScoreAction,
    EMPTY_SCORE,
    flagEntries,
    isFlash,
    scoreBody,
    scoreFromRecord,
    type ScoreAction,
} from '~/utils/scorecard'
import type {
    CompetitionEntryRecord,
    CompetitionRouteRecord,
    RouteRecord,
    WallRecord,
} from '~/types/models'

definePageMeta({
    middleware: ['auth'],
    requiredPermission: 'judge_competitions',
})

const { t } = useI18n()
const route = useRoute()
const { can } = usePermissions()
const { run } = useAsyncAction()

const competitionId = computed(() => String(route.params.id ?? ''))
const gymPath = useGymPath()

const JUDGE_PICKER = gymPath('/manage/judge')
const hydrated = useHydrated()
const cameFromPicker = ref(false)
onMounted(() => {
    cameFromPicker.value = String(window.history.state?.back ?? '').startsWith(
        gymPath('/manage/judge'),
    )
})
const backTo = computed(() =>
    hydrated.value && (cameFromPicker.value || !can('manage_competitions'))
        ? JUDGE_PICKER
        : gymPath(`/manage/competitions/${competitionId.value}`),
)
const { data: judgeable } = useJudgeableCompetitions()
const competitionItems = computed(() =>
    (judgeable.value ?? []).map((item) => ({
        value: item.id,
        label: item.name,
    })),
)
const switchCompetition = (id: string) =>
    navigateTo(gymPath(`/manage/competitions/${id}/judge`), { replace: true })
const pickedRouteId = ref<string>()
const search = ref('')
const filter = ref<'all' | 'open' | 'topped'>('all')
const saving = reactive(new Set<string>())

const { data: competition } = await useAsyncData(
    () => `judge-competition:${competitionId.value}`,
    () => getCompetition(competitionId.value),
    { enabled: () => !!competitionId.value },
)

if (competition.value && competition.value.gym !== useCurrentGymId().value)
    throw createError({ status: 404, fatal: true })

const { data: compRoutes, refresh: refreshRoutes } = useAsyncData(
    () => `judge-routes:${competitionId.value}`,
    () => listCompetitionRoutes(competitionId.value, { voided: false }),
    { default: () => [], enabled: () => !!competitionId.value },
)

const { data: entries, refresh: refreshEntries } = useAsyncData(
    () => `judge-entries:${competitionId.value}`,
    () =>
        listEntries(competitionId.value, {
            status: ['registered', 'checked_in'],
        }),
    { default: () => [], enabled: () => !!competitionId.value },
)

const { data: scores, refresh: refreshScores } = useAsyncData(
    () => `judge-scores:${competitionId.value}`,
    () => listScores(competitionId.value),
    { default: () => [], deep: true, enabled: () => !!competitionId.value },
)

const refreshRoutesSoon = coalesce(() => refreshRoutes(), 400)
const refreshEntriesSoon = coalesce(() => refreshEntries(), 400)
const refreshScoresSoon = coalesce(() => refreshScores(), 400)
useCompetitionLive(competitionId, ({ kind }) => {
    if (kind === 'routes' || kind === 'resync') refreshRoutesSoon()
    if (kind === 'entries' || kind === 'resync') refreshEntriesSoon()
    if (kind === 'scores' || kind === 'resync') refreshScoresSoon()
})

const { data: categories } = useAsyncData(
    () => `judge-categories:${competitionId.value}`,
    () => listCategories(competitionId.value),
    { default: () => [], enabled: () => !!competitionId.value },
)
const categoryNames = computed(
    () =>
        new Map(
            categories.value.map((category) => [category.id, category.name]),
        ),
)

const isLeadHeight = computed(
    () => competition.value?.scoring_format === 'lead_height',
)
const routeId = computed(() =>
    compRoutes.value.some((compRoute) => compRoute.id === pickedRouteId.value)
        ? pickedRouteId.value
        : compRoutes.value[0]?.id,
)
const currentRoute = computed(() =>
    compRoutes.value.find((compRoute) => compRoute.id === routeId.value),
)
const routeOf = (compRoute: CompetitionRouteRecord) =>
    compRoute.expand?.route as RouteRecord | undefined
const wallOf = (compRoute: CompetitionRouteRecord) =>
    (routeOf(compRoute)?.expand?.wall as WallRecord | undefined)?.name

const visibleEntries = computed(() => {
    const term = search.value.trim().toLowerCase()
    return entries.value.filter((entry) => {
        if (filter.value === 'open' && isTopped(entry)) return false
        if (filter.value === 'topped' && !isTopped(entry)) return false
        return (
            !term ||
            entry.display_name.toLowerCase().includes(term) ||
            String(entry.bib) === term
        )
    })
})
const toppedByRoute = computed(() => {
    const counts = new Map<string, number>()
    for (const score of scores.value) {
        if ((score.top_attempt ?? 0) > 0) {
            counts.set(
                score.comp_route,
                (counts.get(score.comp_route) ?? 0) + 1,
            )
        }
    }
    return counts
})
const filterItems = computed(() => [
    { label: t('competitions.scorecard.filters.all'), value: 'all' as const },
    { label: t('competitions.scorecard.filters.open'), value: 'open' as const },
    {
        label: t('competitions.scorecard.filters.topped'),
        value: 'topped' as const,
    },
])

watch(routeId, async (id) => {
    await nextTick()
    document
        .querySelector(`[data-route-chip="${id}"]`)
        ?.scrollIntoView({ inline: 'center', block: 'nearest' })
})

function stepRoute(offset: number) {
    const index = compRoutes.value.findIndex(
        (compRoute) => compRoute.id === routeId.value,
    )
    const next = compRoutes.value[index + offset]
    if (next) pickedRouteId.value = next.id
}

defineShortcuts({
    arrowleft: () => stepRoute(-1),
    arrowright: () => stepRoute(1),
})
const flags = computed(() => flagEntries(scores.value, entries.value.length))

const scoreFor = (entry: CompetitionEntryRecord, compRouteId = routeId.value) =>
    scores.value.find(
        (score) => score.entry === entry.id && score.comp_route === compRouteId,
    )
const stateOf = (
    entry: CompetitionEntryRecord,
    compRouteId = routeId.value,
) => {
    const score = scoreFor(entry, compRouteId)
    return score ? scoreFromRecord(score) : EMPTY_SCORE
}
const isTopped = (entry: CompetitionEntryRecord) =>
    (scoreFor(entry)?.top_attempt ?? 0) > 0
const heightOf = (entry: CompetitionEntryRecord) => scoreFor(entry)?.height ?? 0
const plusOf = (entry: CompetitionEntryRecord) => !!scoreFor(entry)?.height_plus

const saveQueues = new Map<string, Promise<unknown>>()

function enqueue(
    entry: CompetitionEntryRecord,
    task: (compRoute: CompetitionRouteRecord) => Promise<unknown>,
) {
    const compRoute = currentRoute.value
    if (!compRoute) return
    const key = `${entry.id}:${compRoute.id}`
    const queued = (saveQueues.get(key) ?? Promise.resolve()).then(() =>
        task(compRoute),
    )
    saveQueues.set(key, queued)
    void queued.finally(() => {
        if (saveQueues.get(key) === queued) saveQueues.delete(key)
    })
}

async function upsert(
    entry: CompetitionEntryRecord,
    compRouteId: string,
    body: Omit<ScoreInput, 'entry' | 'comp_route'>,
) {
    saving.add(entry.id)
    const saved = await run(async () => {
        const [score] = await putScores(competitionId.value, [
            {
                ...body,
                entry: entry.id,
                comp_route: compRouteId,
            },
        ])
        return score
    })
    saving.delete(entry.id)
    if (!saved) return
    scores.value = [
        ...scores.value.filter((score) => score.id !== saved.id),
        saved,
    ]
}

function act(entry: CompetitionEntryRecord, action: ScoreAction) {
    enqueue(entry, async (compRoute) => {
        const current = stateOf(entry, compRoute.id)
        const next = applyScoreAction(current, action, !!compRoute.zone)
        if (next !== current) await upsert(entry, compRoute.id, scoreBody(next))
    })
}

function saveHeight(
    entry: CompetitionEntryRecord,
    height: number,
    heightPlus: boolean,
) {
    enqueue(entry, (compRoute) =>
        upsert(entry, compRoute.id, {
            height,
            height_plus: heightPlus,
            attempts: 1,
        }),
    )
}

function togglePlus(entry: CompetitionEntryRecord) {
    enqueue(entry, (compRoute) => {
        const score = scoreFor(entry, compRoute.id)
        return upsert(entry, compRoute.id, {
            height: score?.height ?? 0,
            height_plus: !score?.height_plus,
            attempts: 1,
        })
    })
}

useHead({ title: t('page.title.judge') })
</script>
