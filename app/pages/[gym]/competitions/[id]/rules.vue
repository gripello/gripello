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
            <LayoutPageHeader
                :title="t('competitions.rules.title')"
                :back-to="gymPath(`/competitions/${competition.id}`)"
                :back-label="competition.name"
            />
            <div class="-mt-2 mb-6 flex flex-wrap gap-2">
                <UBadge
                    color="neutral"
                    variant="outline"
                    :icon="
                        competition.discipline === 'rope'
                            ? 'i-lucide-cable'
                            : 'i-lucide-mountain'
                    "
                >
                    {{
                        t(`competitions.disciplines.${competition.discipline}`)
                    }}
                </UBadge>
                <UBadge color="neutral" variant="outline">
                    {{
                        t(`competitions.formats.${competition.scoring_format}`)
                    }}
                </UBadge>
            </div>

            <div class="flex flex-col gap-4">
                <LayoutPanel
                    v-for="{ section, lines } in rules"
                    :key="section"
                    :title="t(`competitions.rules.sections.${section}`)"
                    :data-testid="`competition-rules-${section}`"
                >
                    <ul class="flex flex-col gap-3">
                        <li
                            v-for="line in lines"
                            :key="line.key"
                            class="flex gap-3"
                            :data-testid="`competition-rule-${line.key}`"
                        >
                            <span
                                class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                            >
                                <UIcon :name="line.icon" class="size-4" />
                            </span>
                            <p class="pt-1 text-default">
                                {{
                                    t(
                                        `competitions.rules.${line.key}`,
                                        formatted(line.params),
                                    )
                                }}
                            </p>
                        </li>
                    </ul>
                </LayoutPanel>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { competitionRules } from '~/utils/competitions'
import { getCompetition } from '~/api/competitions'

const gymPath = useGymPath()

const { t, locale } = useI18n()
const route = useRoute()

const competitionId = computed(() => String(route.params.id ?? ''))

const {
    data: competition,
    status,
    error,
    refresh,
} = await useAsyncData(
    () => `rules-competition:${competitionId.value}`,
    () => getCompetition(competitionId.value),
    { enabled: () => !!competitionId.value },
)

if (competition.value && competition.value.gym !== useCurrentGymId().value)
    throw createError({ status: 404, fatal: true })

const rules = computed(() =>
    competition.value ? competitionRules(competition.value) : [],
)

function formatted(params: Record<string, string | number> = {}) {
    const number = new Intl.NumberFormat(locale.value)
    return Object.fromEntries(
        Object.entries(params).map(([key, value]) => [
            key,
            typeof value === 'number' ? number.format(value) : value,
        ]),
    )
}

useHead({
    title: computed(() =>
        t('page.title.competitionRules', {
            name: competition.value?.name ?? '',
        }),
    ),
})
</script>
