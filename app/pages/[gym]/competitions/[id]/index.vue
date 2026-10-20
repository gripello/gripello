<template>
    <div class="mx-auto w-full p-4">
        <LayoutLoadingState
            v-if="status === 'pending' && !competition"
            variant="page"
        />
        <LayoutLoadError v-else-if="error || !competition" @retry="refresh()" />
        <template v-else>
            <LayoutPageHeader
                :title="competition.name"
                :subtitle="windowText"
                :back-to="gymPath('/competitions')"
                :back-label="t('competitions.public.title')"
            >
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

            <div
                class="grid grid-cols-1 items-start gap-4"
                :class="{ 'lg:grid-cols-[2fr_1fr]': hasRegistration }"
            >
                <div class="flex flex-col gap-4">
                    <LayoutPanel>
                        <div class="flex flex-wrap items-center gap-2">
                            <UBadge
                                :color="COMPETITION_PHASE_COLORS[phase]"
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
                    </LayoutPanel>
                    <CompetitionScorecard
                        v-if="canSelfScore && myEntry"
                        :competition="competition"
                        :entry="myEntry"
                    />
                    <LayoutPanel
                        v-if="showResults"
                        :title="t('competitions.standings.title')"
                        data-testid="competition-results"
                    >
                        <template #actions>
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
                                class="max-md:hidden"
                                data-testid="competition-tv-link"
                            >
                                {{ t('competitions.standings.tv') }}
                            </UButton>
                        </template>
                        <CompetitionStandings
                            :results="results"
                            :highlight-entry="myEntry?.id"
                        />
                    </LayoutPanel>
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
                    v-if="hasRegistration"
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
import { useNow } from '@vueuse/core'
import {
    COMPETITION_PHASE_COLORS,
    acceptsRegistrations,
    competitionPhase,
    formatCompetitionWindow,
} from '~/utils/competitions'
import { JUDGE_ONLY_FORMATS } from '#shared/utils/competitionScoring'
import { listCompetitionEntries } from '~/api/competitions'

const gymPath = useGymPath()

const { t, locale } = useI18n()
const authStore = useAuthStore()
const { can } = usePermissions()
const userId = authStore.record?.id ?? ''

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
const {
    data: competition,
    status,
    error,
    refresh,
    competitionId,
} = await useCompetitionRecord(({ kind, user }) => {
    if ((kind === 'entries' && user === userId) || kind === 'resync') {
        refreshMyEntrySoon()
    }
    if (kind === 'categories' || kind === 'resync') refreshCategoriesSoon()
    if (kind === 'routes' || kind === 'resync') refreshScorecardRoutesSoon()
})

const now = useNow({ interval: 15_000 })
const phase = computed(() =>
    competition.value
        ? competitionPhase(competition.value, now.value)
        : 'draft',
)

const { data: myEntry, refresh: refreshMyEntry } = await useOfflineData(
    () => `competition-my-entry:${competitionId.value}`,
    async () =>
        (
            await listCompetitionEntries(competitionId.value, {
                user: userId,
            })
        )[0] ?? null,
    { default: () => null, enabled: () => !!userId && !!competitionId.value },
)

const hasRegistration = computed(
    () =>
        !!myEntry.value ||
        (!!competition.value &&
            acceptsRegistrations(competition.value, now.value)),
)

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
useSeoMeta({
    description: () =>
        t('seo.competition', { name: competition.value?.name ?? '' }),
})
</script>
