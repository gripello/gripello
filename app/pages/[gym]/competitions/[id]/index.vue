<template>
    <div class="mx-auto w-full p-4">
        <LayoutLoadingState
            v-if="status === 'pending' && !competition"
            variant="page"
        />
        <LayoutEmptyState
            v-else-if="error || !competition"
            variant="error"
            :title="t('errors.loadFailed')"
            data-testid="load-error"
        >
            <template #actions>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-refresh-cw"
                    data-testid="load-error-retry"
                    @click="refresh()"
                >
                    {{ t('errors.retry') }}
                </UButton>
            </template>
        </LayoutEmptyState>
        <template v-else>
            <UButton
                :to="gymPath('/competitions')"
                icon="i-lucide-arrow-left"
                color="neutral"
                variant="link"
                class="mb-2 px-0"
            >
                {{ t('competitions.public.title') }}
            </UButton>
            <LayoutPageHeader :title="competition.name" :subtitle="windowText">
                <template v-if="can('manage_competitions')" #actions>
                    <UButton
                        :to="gymPath(`/manage/competitions/${competition.id}`)"
                        icon="i-lucide-settings"
                        color="neutral"
                        variant="outline"
                        data-testid="competition-manage"
                    >
                        {{ t('competitions.public.manage') }}
                    </UButton>
                </template>
            </LayoutPageHeader>

            <div class="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
                <div class="flex flex-col gap-4">
                    <section
                        class="flex flex-col gap-3 rounded-lg bg-default p-4 ring ring-default"
                    >
                        <div class="flex flex-wrap items-center gap-2">
                            <UBadge
                                :color="
                                    phase === 'running' ? 'success' : 'neutral'
                                "
                                variant="soft"
                                data-testid="competition-public-phase"
                            >
                                {{ t(`competitions.phases.${phase}.title`) }}
                            </UBadge>
                            <UBadge color="neutral" variant="outline">
                                {{
                                    t(
                                        `competitions.disciplines.${competition.discipline}`,
                                    )
                                }}
                            </UBadge>
                            <UBadge color="neutral" variant="outline">
                                {{
                                    t(
                                        `competitions.formats.${competition.scoring_format}`,
                                    )
                                }}
                            </UBadge>
                            <UButton
                                :to="
                                    gymPath(
                                        `/competitions/${competition.id}/rules`,
                                    )
                                "
                                icon="i-lucide-book-open"
                                color="primary"
                                variant="link"
                                size="sm"
                                class="ms-auto py-0"
                                data-testid="competition-rules-link"
                            >
                                {{ t('competitions.rules.link') }}
                            </UButton>
                        </div>
                        <p
                            v-if="competition.description"
                            class="whitespace-pre-line text-default"
                        >
                            {{ competition.description }}
                        </p>
                    </section>
                    <CompetitionScorecard
                        v-if="canSelfScore && myEntry"
                        :competition="competition"
                        :entry="myEntry"
                    />
                    <section
                        v-if="showResults"
                        class="flex flex-col gap-3 rounded-lg bg-default p-4 ring ring-default"
                        data-testid="competition-results"
                    >
                        <div class="flex items-center gap-2">
                            <h2
                                class="flex-1 text-lg font-semibold text-highlighted"
                            >
                                {{ t('competitions.standings.title') }}
                            </h2>
                            <UButton
                                :to="
                                    gymPath(
                                        `/competitions/${competition.id}/tv`,
                                    )
                                "
                                target="_blank"
                                icon="i-lucide-tv"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                data-testid="competition-tv-link"
                            >
                                {{ t('competitions.standings.tv') }}
                            </UButton>
                        </div>
                        <CompetitionStandings
                            :results="results"
                            :highlight-entry="myEntry?.id"
                        />
                    </section>
                    <UAlert
                        v-if="judgedByStaff && myEntry"
                        icon="i-lucide-clipboard-pen"
                        color="info"
                        variant="soft"
                        :title="t('competitions.scorecard.judged')"
                        data-testid="competition-judged"
                    />
                </div>
                <CompetitionRegistration
                    :entry="myEntry"
                    :competition="competition"
                    :class="{ 'order-first lg:order-none': !myEntry }"
                    @changed="refreshMyEntry()"
                />
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { competitionPhase, formatCompetitionWindow } from '~/utils/competitions'
import { JUDGE_ONLY_FORMATS } from '#shared/utils/competitionScoring'
import type { CompetitionEntryRecord, CompetitionRecord } from '~/types/models'

const gymPath = useGymPath()

const { t, locale } = useI18n()
const pb = usePocketbase()
const route = useRoute()
const { can } = usePermissions()

const competitionId = computed(() => String(route.params.id ?? ''))

const {
    data: competition,
    status,
    error,
    refresh,
} = await useAsyncData(
    () => `public-competition:${competitionId.value}`,
    () =>
        pb
            .collection('competitions')
            .getOne<CompetitionRecord>(competitionId.value),
    { enabled: () => !!competitionId.value },
)

const now = useNow()
const phase = computed(() =>
    competition.value
        ? competitionPhase(competition.value, now.value)
        : 'draft',
)

const userId = pb.authStore.record?.id ?? ''

const { data: myEntry, refresh: refreshMyEntry } = await useAsyncData(
    () => `competition-my-entry:${competitionId.value}`,
    async () =>
        (
            await pb
                .collection('competition_entries')
                .getList<CompetitionEntryRecord>(1, 1, {
                    filter: pb.filter('competition = {:id} && user = {:user}', {
                        id: competitionId.value,
                        user: userId,
                    }),
                })
        ).items[0] ?? null,
    { default: () => null, enabled: () => !!userId && !!competitionId.value },
)

const refreshCompetitionSoon = coalesce(() => refresh(), 300)
const refreshMyEntrySoon = coalesce(() => refreshMyEntry(), 300)
const refreshCategoriesSoon = coalesce(
    () =>
        refreshNuxtData(`competition-public-categories:${competitionId.value}`),
    300,
)
const refreshScorecardRoutesSoon = coalesce(
    () => refreshNuxtData(`scorecard-routes:${competitionId.value}`),
    300,
)
useCompetitionLive(competitionId, ({ kind, user }) => {
    if (kind === 'competition' || kind === 'resync') refreshCompetitionSoon()
    if ((kind === 'entries' && user === userId) || kind === 'resync') {
        refreshMyEntrySoon()
    }
    if (kind === 'categories' || kind === 'resync') refreshCategoriesSoon()
    if (kind === 'routes' || kind === 'resync') refreshScorecardRoutesSoon()
})

const showResults = computed(() =>
    ['running', 'ended', 'published'].includes(phase.value),
)
const { data: results } = useCompetitionResults(competitionId)

const entryCanScore = computed(
    () =>
        !!myEntry.value &&
        ['registered', 'checked_in'].includes(myEntry.value.status),
)
const judgedByStaff = computed(
    () =>
        !!competition.value &&
        JUDGE_ONLY_FORMATS.includes(competition.value.scoring_format),
)
const canSelfScore = computed(
    () =>
        phase.value === 'running' &&
        entryCanScore.value &&
        !judgedByStaff.value,
)

const windowText = computed(() =>
    competition.value
        ? formatCompetitionWindow(competition.value, locale.value)
        : '',
)

useHead({
    title: computed(() =>
        t('page.title.competition', { name: competition.value?.name ?? '' }),
    ),
})
</script>
