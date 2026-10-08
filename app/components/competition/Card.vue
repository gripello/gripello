<template>
    <ULink
        :to="to"
        class="flex items-center gap-4 rounded-lg bg-default p-4 ring ring-default transition hover:bg-elevated/50"
        :data-testid="`competition-card-${competition.id}`"
    >
        <div
            class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
        >
            <UIcon
                :name="
                    competition.discipline === 'rope'
                        ? 'i-lucide-cable'
                        : 'i-lucide-mountain'
                "
                class="size-5"
            />
        </div>
        <div class="min-w-0 flex-1">
            <p class="truncate font-semibold text-highlighted">
                {{ competition.name }}
            </p>
            <p class="truncate text-sm text-muted">
                {{ windowText }}
            </p>
        </div>
        <UBadge
            :color="COMPETITION_PHASE_COLORS[phase]"
            variant="soft"
            size="sm"
        >
            {{ $t(`competitions.phases.${phase}.title`) }}
        </UBadge>
    </ULink>
</template>

<script setup lang="ts">
import {
    COMPETITION_PHASE_COLORS,
    competitionPhase,
    formatCompetitionWindow,
    type CompetitionPhase,
} from '~/utils/competitions'
import type { CompetitionRecord } from '~/types/models'

const props = defineProps<{ competition: CompetitionRecord; to: string }>()

const { locale } = useI18n()

const phase = computed(() => competitionPhase(props.competition, new Date()))

const windowText = computed(() =>
    formatCompetitionWindow(props.competition, locale.value),
)
</script>
