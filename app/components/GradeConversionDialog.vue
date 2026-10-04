<template>
    <LayoutDialogShell
        v-model="open"
        :title="$t('gradeConversion.title')"
        :max-width="1200"
        closable
        sheet-on-mobile
        data-testid="grade-conversion-dialog"
    >
        <template #activator="{ props: activatorProps }">
            <slot name="activator" :props="activatorProps">
                <UButton
                    v-bind="activatorProps"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    icon="i-lucide-arrow-left-right"
                    data-testid="grade-conversion-open"
                >
                    {{ $t('gradeConversion.open') }}
                </UButton>
            </slot>
        </template>

        <section
            v-for="ladder in ladders"
            :key="ladder.key"
            class="mb-6"
            :data-testid="`grade-conversion-${ladder.key}`"
        >
            <LayoutSectionHeader :title="ladder.title" />
            <div
                class="ladder"
                :style="{
                    '--steps': ladder.steps,
                    '--lanes': ladder.lanes,
                    '--min': ladder.minWidth,
                }"
            >
                <span
                    v-for="cell in ladder.cells"
                    :key="cell.key"
                    class="ladder__cell"
                    :class="[
                        `ladder__cell--${cell.kind}`,
                        {
                            'grade-conversion__label--highlight':
                                cell.highlighted,
                        },
                    ]"
                    :style="{
                        '--at': cell.at,
                        '--span': cell.span,
                        '--lane': cell.lane,
                        background: cell.color,
                        color: cell.color && readableTextOn(cell.color),
                    }"
                    :data-testid="cell.testId"
                >
                    <template v-if="cell.shortText">
                        <span class="hidden sm:inline">{{ cell.text }}</span>
                        <span class="sm:hidden">{{ cell.shortText }}</span>
                    </template>
                    <template v-else>{{ cell.text }}</template>
                    <UBadge
                        v-if="cell.badge"
                        size="sm"
                        color="neutral"
                        variant="outline"
                        :label="cell.badge"
                    />
                </span>
            </div>
        </section>

        <ul class="list-disc space-y-1 ps-5 text-sm text-muted">
            <li v-for="note in NOTES" :key="note">
                {{ $t(`gradeConversion.notes.${note}`) }}
            </li>
        </ul>
        <p class="mt-3 text-xs text-dimmed">
            {{ $t('gradeConversion.source') }}
        </p>

        <template #actions>
            <UButton
                :to="`/api/ui/grade-scale?gym=${gymId}`"
                external
                download
                color="neutral"
                variant="soft"
                icon="i-lucide-file-down"
                data-testid="grade-conversion-pdf"
            >
                {{ $t('gradeConversion.downloadPdf') }}
            </UButton>
        </template>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import {
    gradeLabels,
    type GradeSource,
    type GradeSystem,
} from '#shared/utils/grades'
import {
    bandRanges,
    orientationUiaa,
    vCells,
    type GymBand,
} from '#shared/utils/gradeReference'

const props = defineProps<{
    source?: GradeSource | null
}>()

interface LadderCell {
    key: string
    text: string
    shortText?: string
    at: number
    span: number
    lane: number
    kind: 'head' | 'band' | 'primary' | 'plain' | 'orientation' | 'ircra'
    testId?: string
    color?: string
    badge?: string
    highlighted?: boolean
}

const IRCRA_STEPS = 32
const NOTES = ['fontVsFrench', 'beginner', 'orientation', 'bands']

const { t } = useI18n()
const gymId = useCurrentGymId()
const open = ref(false)

function isSourceGrade(system: GradeSystem, label: string) {
    return (
        system === props.source?.grade_system && label === props.source?.grade
    )
}

function laneOf(
    lane: number,
    kind: LadderCell['kind'],
    head: string,
    cells: { text: string; span?: number; system?: GradeSystem }[],
    extra: Partial<LadderCell> = {},
): LadderCell[] {
    let at = 1
    return [
        {
            key: `${lane}-head`,
            text: head,
            at: 0,
            span: 1,
            lane,
            kind: 'head',
            badge: extra.badge,
            shortText: extra.shortText,
        },
        ...cells.map(({ text, span = 1, system }, i) => {
            const cell: LadderCell = {
                key: `${lane}-${i}`,
                text,
                at,
                span,
                lane,
                kind,
                testId: system
                    ? `grade-conversion-${system}-${text}`
                    : undefined,
                highlighted: !!system && isSourceGrade(system, text),
            }
            at += span
            return cell
        }),
    ]
}

const { bands: gymBands, bandName } = useGymBands()

function bandLabel(band: GymBand) {
    const range = bandRanges(gymBands.value).find((r) => r.key === band.key)
    return range?.openEnd
        ? `${bandName(band)} · ${t('gradeConversion.andUp', { grade: range.font[0] })}`
        : bandName(band)
}

const boulderCells = computed(() => {
    const font = gradeLabels('font')
    const bands = laneOf(
        1,
        'band',
        t('gradeConversion.gymBand'),
        gymBands.value.map((band) => ({
            text: bandLabel(band),
            span: band.span,
        })),
    ).map((cell, i) => {
        const band = gymBands.value[i - 1]
        return band
            ? {
                  ...cell,
                  color: band.color,
                  testId: `grade-conversion-band-${band.key}`,
              }
            : cell
    })
    const orientation = laneOf(
        4,
        'orientation',
        '≈ UIAA',
        font.map((_, i) => ({ text: orientationUiaa(i) })),
        { badge: t('gradeConversion.orientation') },
    ).map((cell) =>
        cell.kind === 'head'
            ? cell
            : {
                  ...cell,
                  testId: `grade-conversion-orientation-${cell.at - 1}`,
              },
    )
    return [
        ...bands,
        ...laneOf(
            2,
            'primary',
            t('gradeSystems.font'),
            font.map((text) => ({ text, system: 'font' as const })),
            { shortText: t('gradeSystemsShort.font') },
        ),
        ...laneOf(
            3,
            'plain',
            t('gradeSystems.v'),
            vCells().map(({ label, span }) => ({
                text: label,
                span,
                system: 'v' as const,
            })),
            { shortText: t('gradeSystemsShort.v') },
        ),
        ...orientation,
    ]
})

const routeCells = computed(() => {
    const steps = Array.from({ length: IRCRA_STEPS }, (_, i) => i)
    return [
        ...(['uiaa', 'french', 'yds'] as const).flatMap((system, i) => {
            const labels = gradeLabels(system)
            return laneOf(
                i + 1,
                system === 'uiaa' ? 'primary' : 'plain',
                t(`gradeSystems.${system}`),
                steps.map((step) =>
                    labels[step]
                        ? { text: labels[step], system }
                        : { text: '—' },
                ),
                { shortText: t(`gradeSystemsShort.${system}`) },
            )
        }),
        ...laneOf(
            4,
            'ircra',
            'IRCRA',
            steps.map((step) => ({ text: String(step + 1) })),
        ),
    ]
})

const ladders = computed(() => [
    {
        key: 'boulders',
        title: t('gradeConversion.boulders'),
        steps: gradeLabels('font').length,
        lanes: 4,
        minWidth: '2.5rem',
        cells: boulderCells.value,
    },
    {
        key: 'routes',
        title: t('gradeConversion.routes'),
        steps: IRCRA_STEPS,
        lanes: 4,
        minWidth: '3rem',
        cells: routeCells.value,
    },
])

watch(open, async (isOpen) => {
    if (!isOpen) return
    await nextTick()
    const cells = document.querySelectorAll<HTMLElement>(
        '.grade-conversion__label--highlight',
    )
    for (const cell of cells) {
        const ladder = cell.parentElement!
        ladder.scrollLeft =
            cell.offsetLeft - (ladder.clientWidth - cell.offsetWidth) / 2
    }
    cells[0]?.scrollIntoView({ block: 'center', inline: 'nearest' })
})
</script>

<style scoped>
@reference "~/assets/css/main.css";

.ladder {
    display: grid;
    grid-template-columns: repeat(var(--lanes), minmax(0, 1fr));
    gap: 1px;
    overflow: clip;
    border: 1px solid var(--ui-border);
    border-radius: calc(var(--ui-radius) * 2);
    background: var(--ui-border);
    color: var(--ui-text-muted);
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
}

.ladder__cell {
    grid-row: calc(var(--at) + 1) / span var(--span);
    grid-column: var(--lane);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 2.25rem;
    padding: 6px 4px;
    background: var(--ui-bg);
    text-align: center;
}

.ladder__cell--head {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--ui-bg-elevated);
    color: var(--ui-text-highlighted);
    font-weight: 600;
}

.ladder__cell--band {
    align-items: flex-start;
    padding-top: 10px;
    font-weight: 600;
}

.ladder__cell--primary {
    color: var(--ui-text-highlighted);
    font-weight: 600;
}

.ladder__cell--orientation {
    color: var(--ui-text-dimmed);
    font-style: italic;
    outline: 1px dashed var(--ui-border-accented);
    outline-offset: -4px;
}

.ladder__cell--ircra {
    color: var(--ui-text-dimmed);
    font-size: 0.75rem;
}

.ladder__cell.grade-conversion__label--highlight {
    background: color-mix(in oklab, var(--ui-primary) 12%, var(--ui-bg));
    color: var(--ui-primary);
    font-weight: 700;
}

@variant sm {
    .ladder {
        grid-template-columns: 7rem repeat(
                var(--steps),
                minmax(var(--min), 1fr)
            );
        overflow-x: auto;
    }

    .ladder__cell {
        grid-row: var(--lane);
        grid-column: calc(var(--at) + 1) / span var(--span);
        flex-wrap: nowrap;
        white-space: nowrap;
    }

    .ladder__cell--band {
        align-items: center;
        padding-top: 6px;
    }

    .ladder__cell--head {
        position: sticky;
        top: auto;
        left: 0;
        justify-content: flex-start;
        padding-inline: 12px;
        flex-wrap: wrap;
    }
}
</style>
