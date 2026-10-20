<template>
    <div class="mx-auto w-full p-4">
        <LayoutPageHeader :title="t('competitions.public.title')" />

        <LayoutLoadingState v-if="status === 'pending' && !competitions" />
        <LayoutLoadError v-else-if="error" @retry="refresh()" />
        <LayoutEmptyState
            v-else-if="!competitions?.length"
            icon="i-lucide-trophy"
            :title="t('competitions.public.empty')"
        />
        <template v-else>
            <section v-if="current.length" class="mb-6">
                <LayoutSectionHeader
                    :title="t('competitions.public.upcoming')"
                />
                <ul class="flex flex-col gap-3">
                    <li v-for="competition in current" :key="competition.id">
                        <CompetitionCard
                            :competition="competition"
                            :to="gymPath(`/competitions/${competition.id}`)"
                        />
                    </li>
                </ul>
            </section>
            <section v-if="past.length">
                <LayoutSectionHeader :title="t('competitions.public.past')" />
                <ul class="flex flex-col gap-3">
                    <li v-for="competition in past" :key="competition.id">
                        <CompetitionCard
                            :competition="competition"
                            :to="gymPath(`/competitions/${competition.id}`)"
                        />
                    </li>
                </ul>
            </section>
        </template>
    </div>
</template>

<script setup lang="ts">
import { competitionPhase } from '~/utils/competitions'
import { listCompetitions } from '~/api/competitions'
import type { CompetitionRecord } from '~/types/models'

const gymPath = useGymPath()

const { t } = useI18n()
const gymId = useCurrentGymId()

const {
    data: competitions,
    status,
    error,
    refresh,
} = await useAsyncData('public-competitions', () =>
    listCompetitions(gymId.value, { status: ['open', 'closed', 'published'] }),
)

useGymCompetitionsLive(refresh)

const isPast = (competition: CompetitionRecord) =>
    ['ended', 'published'].includes(competitionPhase(competition, new Date()))

const current = computed(() =>
    (competitions.value ?? []).filter((competition) => !isPast(competition)),
)
const past = computed(() => (competitions.value ?? []).filter(isPast).reverse())

const { gym } = useGym()
useSeoMeta({
    title: () => t('page.title.competitions'),
    description: () => t('seo.competitions', { name: gym.value?.name ?? '' }),
})
</script>
