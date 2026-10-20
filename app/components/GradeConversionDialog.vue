<template>
    <LayoutDialogShell
        v-model="open"
        :title="$t('gradeConversion.title')"
        :max-width="720"
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

        <template #header-actions>
            <UButton
                :to="`/api/ui/grade-scale?gym=${gymId}`"
                external
                download
                color="neutral"
                variant="ghost"
                icon="i-lucide-file-down"
                class="icon-btn"
                :aria-label="$t('gradeConversion.downloadPdf')"
                :title="$t('gradeConversion.downloadPdf')"
                data-testid="grade-conversion-pdf"
            />
        </template>

        <section
            v-for="ladder in ladders"
            :key="ladder.key"
            class="mb-6"
            :data-testid="`grade-conversion-${ladder.key}`"
        >
            <LayoutSectionHeader :title="ladder.title" />
            <div class="ladder" :style="{ '--cols': ladder.columns.length }">
                <span class="ladder__head ladder__head--axis">IRCRA</span>
                <span
                    v-for="column in ladder.columns"
                    :key="column.key"
                    class="ladder__head"
                >
                    <span class="hidden sm:inline">{{ column.title }}</span>
                    <span class="sm:hidden">{{
                        column.shortTitle ?? column.title
                    }}</span>
                </span>
                <div
                    class="ladder__axis"
                    :style="{ height: rem(ladder.hi - ladder.lo) }"
                >
                    <span
                        v-for="tick in ladder.ticks"
                        :key="tick"
                        class="ladder__tick"
                        :style="{ top: rem(tick - ladder.lo) }"
                        >{{ tick }}</span
                    >
                </div>
                <div
                    v-for="column in ladder.columns"
                    :key="column.key"
                    class="ladder__column"
                    :class="{ 'ladder__column--primary': column.primary }"
                    :style="{ height: rem(ladder.hi - ladder.lo) }"
                >
                    <span
                        v-for="band in column.bands"
                        :key="band.label"
                        class="ladder__cell"
                        :class="{
                            'grade-conversion__label--highlight':
                                band.highlighted,
                        }"
                        :style="{
                            top: rem(band.lo - ladder.lo),
                            height: rem(band.hi - band.lo),
                            background: band.color,
                            color: band.color && readableTextOn(band.color),
                        }"
                        :data-testid="band.testId"
                        >{{ band.label }}</span
                    >
                </div>
            </div>
        </section>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import type { GradeSource, GradeSystem } from '#shared/utils/grades'
import { bandRanges, type GymBand } from '#shared/utils/gradeReference'
import {
    clipBands,
    groupBands,
    scaleBands,
    type LadderBand,
} from '~/utils/gradeLadder'

const props = defineProps<{
    source?: GradeSource | null
}>()

interface Band extends LadderBand {
    testId: string
    color?: string
    highlighted?: boolean
}

interface Column {
    key: string
    title: string
    shortTitle?: string
    primary?: boolean
    bands: Band[]
}

const REM_PER_IRCRA = 2.25

const { t } = useI18n()
const gymId = useCurrentGymId()
const open = ref(false)
const { bands: gymBands, bandName } = useGymBands()

const rem = (ircra: number) => `${ircra * REM_PER_IRCRA}rem`

function scaleColumn(
    system: GradeSystem,
    lo: number,
    hi: number,
    { primary = false, reference = false } = {},
): Column {
    return {
        key: system,
        title: t(`gradeSystems.${system}`),
        shortTitle: t(`gradeSystemsShort.${system}`),
        primary,
        bands: clipBands(scaleBands(system), lo, hi).map((band) => ({
            ...band,
            testId: `grade-conversion-${reference ? 'reference-' : ''}${system}-${band.label}`,
            highlighted:
                !reference &&
                system === props.source?.grade_system &&
                band.label === props.source?.grade,
        })),
    }
}

function bandLabel(band: GymBand) {
    const range = bandRanges(gymBands.value).find((r) => r.key === band.key)
    return range?.openEnd
        ? `${bandName(band)} · ${t('gradeConversion.andUp', { grade: range.font[0] })}`
        : bandName(band)
}

function ladder(key: string, title: string, columns: Column[]) {
    const all = columns.flatMap((column) => column.bands)
    const lo = Math.min(...all.map((band) => band.lo))
    const hi = Math.max(...all.map((band) => band.hi))
    const ticks = Array.from(
        { length: Math.floor(hi) - Math.ceil(lo) + 1 },
        (_, i) => Math.ceil(lo) + i,
    )
    return { key, title, columns, lo, hi, ticks }
}

const ladders = computed(() => {
    const font = scaleBands('font')
    const lo = font[0]!.lo
    const hi = font.at(-1)!.hi
    const gym: Column = {
        key: 'gym',
        title: t('gradeConversion.gymBand'),
        bands: groupBands(
            font,
            gymBands.value.map((band) => ({
                label: bandLabel(band),
                span: band.span,
            })),
        ).map((band, i) => ({
            ...band,
            color: gymBands.value[i]!.color,
            testId: `grade-conversion-band-${gymBands.value[i]!.key}`,
        })),
    }
    return [
        ladder('boulders', t('gradeConversion.boulders'), [
            gym,
            scaleColumn('font', lo, hi, { primary: true }),
            scaleColumn('v', lo, hi),
            scaleColumn('uiaa', lo, hi, { reference: true }),
        ]),
        ladder('routes', t('gradeConversion.routes'), [
            scaleColumn('uiaa', 0, 99, { primary: true }),
            scaleColumn('french', 0, 99),
            scaleColumn('yds', 0, 99),
        ]),
    ]
})

watch(open, async (isOpen) => {
    if (!isOpen) return
    await nextTick()
    document
        .querySelector<HTMLElement>('.grade-conversion__label--highlight')
        ?.scrollIntoView({ block: 'center', inline: 'nearest' })
})
</script>

<style scoped>
.ladder {
    display: grid;
    grid-template-columns: 3rem repeat(var(--cols), minmax(0, 1fr));
    overflow: clip;
    border: 1px solid var(--ui-border);
    border-radius: calc(var(--ui-radius) * 2);
    background: var(--ui-bg);
    color: var(--ui-text-muted);
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
}

.ladder__head {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 8px 4px;
    border-bottom: 1px solid var(--ui-border);
    background: var(--ui-bg-elevated);
    color: var(--ui-text-highlighted);
    font-weight: 600;
    text-align: center;
}

.ladder__head--axis {
    color: var(--ui-text-dimmed);
    font-size: 0.75rem;
}

.ladder__axis,
.ladder__column {
    position: relative;
    border-left: 1px solid var(--ui-border);
}

.ladder__axis {
    border-left: 0;
    color: var(--ui-text-dimmed);
    font-size: 0.75rem;
}

.ladder__tick {
    position: absolute;
    right: 6px;
    translate: 0 -50%;
}

.ladder__tick::after {
    content: '';
    position: absolute;
    top: 50%;
    left: calc(100% + 2px);
    width: 4px;
    border-top: 1px solid var(--ui-border-accented);
}

.ladder__cell {
    position: absolute;
    inset-inline: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
    border-bottom: 1px solid var(--ui-border);
    text-align: center;
    line-height: 1.1;
    overflow: hidden;
}

.ladder__column--primary .ladder__cell {
    color: var(--ui-text-highlighted);
    font-weight: 600;
}

.ladder__cell.grade-conversion__label--highlight {
    background: color-mix(in oklab, var(--ui-primary) 14%, var(--ui-bg));
    color: var(--ui-primary);
    font-weight: 700;
}
</style>
