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
                :loading="downloading"
                color="neutral"
                variant="ghost"
                icon="i-lucide-file-down"
                class="icon-btn"
                :aria-label="$t('gradeConversion.downloadPdf')"
                :title="$t('gradeConversion.downloadPdf')"
                data-testid="grade-conversion-pdf"
                @click="downloadPdf"
            />
        </template>

        <SegmentedControl
            v-model="tab"
            :items="tabs"
            block
            class="mb-3"
            test-id="grade-conversion-tabs"
        />

        <section
            v-for="ladder in ladders"
            v-show="tab === ladder.key"
            :key="ladder.key"
            class="mb-2"
            :data-testid="`grade-conversion-${ladder.key}`"
        >
            <div class="ladder" :style="{ '--cols': ladder.columns.length }">
                <span class="ladder__head">IRCRA</span>
                <span
                    v-for="column in ladder.columns"
                    :key="column.key"
                    class="ladder__head"
                    :class="{ 'ladder__head--primary': column.primary }"
                >
                    <span class="hidden sm:inline">{{ column.title }}</span>
                    <span class="sm:hidden">{{
                        column.shortTitle ?? column.title
                    }}</span>
                </span>
                <div
                    class="ladder__body"
                    :style="{ height: rem(ladder.hi - ladder.lo) }"
                >
                    <span
                        v-for="stripe in ladder.stripes"
                        :key="stripe.testId"
                        class="ladder__stripe"
                        :style="{
                            top: rem(stripe.lo - ladder.lo),
                            height: rem(stripe.hi - stripe.lo),
                            '--band': stripe.color,
                        }"
                    />
                    <span
                        v-if="ladder.row"
                        class="ladder__row"
                        data-testid="grade-conversion-row"
                        :style="{
                            top: rem(ladder.row.lo - ladder.lo),
                            height: rem(ladder.row.hi - ladder.row.lo),
                        }"
                    />
                    <div class="ladder__axis">
                        <span
                            v-for="tick in ladder.ticks"
                            :key="tick"
                            class="ladder__tick"
                            :class="{
                                'ladder__tick--active':
                                    ladder.row &&
                                    tick >= ladder.row.lo &&
                                    tick < ladder.row.hi,
                            }"
                            :style="{ top: rem(tick - ladder.lo) }"
                            >{{ tick }}</span
                        >
                    </div>
                    <div
                        v-for="column in ladder.columns"
                        :key="column.key"
                        class="ladder__column"
                        :class="{ 'ladder__column--primary': column.primary }"
                    >
                        <button
                            v-for="band in column.bands"
                            :key="band.testId"
                            type="button"
                            class="ladder__cell"
                            :class="{
                                'ladder__cell--band': band.color,
                                'grade-conversion__label--highlight':
                                    band.highlighted,
                            }"
                            :style="{
                                ...tile(
                                    band.lo - ladder.lo,
                                    band.hi - band.lo,
                                    band.color ? 2 : 1.5,
                                ),
                                background: band.color,
                                color: band.color && readableTextOn(band.color),
                            }"
                            :aria-current="band.highlighted || undefined"
                            :data-testid="band.testId"
                            @click="select(ladder.key, column.key, band.id)"
                        >
                            <span>{{ band.label }}</span>
                            <span v-if="band.range" class="ladder__range">{{
                                band.range
                            }}</span>
                        </button>
                    </div>
                </div>
            </div>
        </section>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import {
    BOULDER_GRADE_SYSTEMS,
    type GradeSource,
    type GradeSystem,
} from '#shared/utils/grades'
import { saveDownload } from '~/utils/download'
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

type LadderKey = 'boulders' | 'routes'

interface Band extends LadderBand {
    id: string
    testId: string
    color?: string
    range?: string
    highlighted?: boolean
}

interface Column {
    key: string
    title: string
    shortTitle?: string
    primary?: boolean
    bands: Band[]
}

interface Selection {
    ladder: LadderKey
    column: string
    id: string
}

const REM_PER_IRCRA = 2.25

const { t } = useI18n()
const gymId = useCurrentGymId()
const tab = ref<LadderKey>('boulders')
const { pending: downloading, run } = useAsyncAction()
const downloadPdf = () =>
    run(() =>
        saveDownload(
            `/api/ui/grade-scale?gym=${gymId.value}&kind=${tab.value}`,
            `${t('gradeConversion.downloadPdf')} ${t(`gradeConversion.${tab.value}`)}.pdf`,
        ),
    )
const open = ref(false)
const { bands: gymBands, bandName } = useGymBands()

const rem = (ircra: number) => `${ircra * REM_PER_IRCRA}rem`
const tile = (top: number, height: number, gapPx: number) => ({
    top: `calc(${rem(top)} + ${gapPx}px)`,
    height: `calc(${rem(height)} - ${gapPx * 2}px)`,
})

const selected = ref<Selection | null>(null)
const tabs = computed(() => [
    { value: 'boulders' as const, label: t('gradeConversion.boulders') },
    { value: 'routes' as const, label: t('gradeConversion.routes') },
])

watch(
    () => [props.source?.grade_system, props.source?.grade],
    () => {
        const system = props.source?.grade_system
        const grade = props.source?.grade
        if (!system || !grade) {
            selected.value = null
            return
        }
        const ladder = BOULDER_GRADE_SYSTEMS.includes(system as GradeSystem)
            ? 'boulders'
            : 'routes'
        selected.value = { ladder, column: system, id: grade }
        tab.value = ladder
    },
    { immediate: true },
)

function select(ladder: LadderKey, column: string, id: string) {
    selected.value = { ladder, column, id }
}

function isSelected(ladder: LadderKey, column: string, id: string) {
    const s = selected.value
    return s?.ladder === ladder && s.column === column && s.id === id
}

function scaleColumn(
    ladder: LadderKey,
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
            id: band.label,
            testId: `grade-conversion-${reference ? 'reference-' : ''}${system}-${band.label}`,
            highlighted: isSelected(ladder, system, band.label),
        })),
    }
}

function bandRange(index: number) {
    const range = bandRanges(gymBands.value)[index]
    if (!range) return undefined
    if (range.openEnd)
        return t('gradeConversion.andUp', { grade: range.font[0] })
    if (range.openStart)
        return t('gradeConversion.upTo', { grade: range.font[1] })
    return `${range.font[0]} – ${range.font[1]}`
}

function ladder(key: LadderKey, columns: Column[], stripes: Band[] = []) {
    const all = columns.flatMap((column) => column.bands)
    const lo = Math.min(...all.map((band) => band.lo))
    const hi = Math.max(...all.map((band) => band.hi))
    const firstTick = Math.ceil(lo / 2) * 2
    const ticks = Array.from(
        { length: Math.floor((hi - firstTick) / 2) + 1 },
        (_, i) => firstTick + i * 2,
    )
    const row = all.find((band) => band.highlighted) ?? null
    return { key, columns, stripes, lo, hi, ticks, row }
}

const ladders = computed(() => {
    const font = scaleBands('font')
    const lo = font[0]!.lo
    const hi = font.at(-1)!.hi
    const gym: Column = {
        key: 'gym',
        title: t('gradeConversion.gymBand'),
        shortTitle: t('gradeConversion.gymBandShort'),
        bands: groupBands(
            font,
            gymBands.value.map((band: GymBand) => ({
                label: bandName(band),
                span: band.span,
            })),
        ).map((band, i) => ({
            ...band,
            id: gymBands.value[i]!.key,
            color: gymBands.value[i]!.color,
            range: bandRange(i),
            testId: `grade-conversion-band-${gymBands.value[i]!.key}`,
            highlighted: isSelected('boulders', 'gym', gymBands.value[i]!.key),
        })),
    }
    return [
        ladder(
            'boulders',
            [
                gym,
                scaleColumn('boulders', 'font', lo, hi, { primary: true }),
                scaleColumn('boulders', 'v', lo, hi),
                scaleColumn('boulders', 'uiaa', lo, hi, { reference: true }),
            ],
            gym.bands,
        ),
        ladder('routes', [
            scaleColumn('routes', 'uiaa', 0, 99, { primary: true }),
            scaleColumn('routes', 'french', 0, 99),
            scaleColumn('routes', 'yds', 0, 99),
        ]),
    ]
})

watch(open, async (isOpen) => {
    if (!isOpen) return
    if (selected.value) tab.value = selected.value.ladder
    await nextTick()
    document
        .querySelector<HTMLElement>('.grade-conversion__label--highlight')
        ?.scrollIntoView({ block: 'center', inline: 'nearest' })
})
</script>

<style scoped>
.ladder {
    --axis: 2.5rem;
    display: grid;
    grid-template-columns: var(--axis) repeat(var(--cols), minmax(0, 1fr));
    padding: 0 8px 10px;
    border: 1px solid var(--ui-border);
    border-radius: calc(var(--ui-radius) * 2);
    background: var(--ui-bg-muted);
    color: var(--ui-text-muted);
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
}

.ladder__head {
    position: sticky;
    /* covers the dialog body's top padding (LayoutDialogShell pt-2) so cells don't scroll by above it */
    top: -0.5rem;
    z-index: 2;
    margin-bottom: 6px;
    padding: 12px 2px 8px;
    border-bottom: 1px solid var(--ui-border);
    background: var(--ui-bg-muted);
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-align: center;
    text-transform: uppercase;
    overflow-wrap: anywhere;
}

.ladder__head--primary {
    color: var(--ui-text-highlighted);
}

.ladder__body {
    position: relative;
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
}

.ladder__stripe,
.ladder__row {
    position: absolute;
    pointer-events: none;
}

.ladder__stripe {
    left: var(--axis);
    right: 0;
    border-radius: calc(var(--ui-radius) * 1.5);
    background: color-mix(in oklab, var(--band) 14%, transparent);
}

.ladder__row {
    inset-inline: -4px;
    border-radius: var(--ui-radius);
    background: color-mix(in oklab, var(--ui-text-highlighted) 8%, transparent);
    box-shadow: inset 0 0 0 1px
        color-mix(in oklab, var(--ui-text-highlighted) 40%, transparent);
}

.ladder__axis,
.ladder__column {
    position: relative;
}

.ladder__axis {
    font-size: 0.6875rem;
}

.ladder__tick {
    position: absolute;
    right: 10px;
    translate: 0 -50%;
}

.ladder__tick::after {
    content: '';
    position: absolute;
    top: 50%;
    left: calc(100% + 3px);
    width: 5px;
    border-top: 1px solid var(--ui-border-accented);
}

.ladder__tick--active {
    color: var(--ui-text-highlighted);
    font-weight: 700;
}

.ladder__tick--active::after {
    border-color: var(--ui-text-highlighted);
}

.ladder__cell {
    position: absolute;
    inset-inline: 3px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 0 4px;
    border: 0;
    border-radius: var(--ui-radius);
    background: var(--ui-bg);
    box-shadow: inset 0 0 0 1px var(--ui-border);
    color: inherit;
    font: inherit;
    font-weight: 500;
    line-height: 1.1;
    text-align: center;
    overflow: hidden;
    cursor: pointer;
}

.ladder__cell:focus-visible {
    outline: 2px solid var(--ui-primary);
    outline-offset: 1px;
}

.ladder__column--primary .ladder__cell {
    color: var(--ui-text-highlighted);
    font-weight: 600;
}

.ladder__cell--band {
    border-radius: calc(var(--ui-radius) * 1.5);
    box-shadow: inset 0 -2px 0 rgb(0 0 0 / 0.12);
    font-weight: 700;
}

.ladder__range {
    font-size: 0.6875rem;
    font-weight: 500;
}

.ladder__column .ladder__cell.grade-conversion__label--highlight {
    background: var(--ui-text-highlighted);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.3);
    color: var(--ui-bg);
    font-weight: 700;
}

.ladder__column .ladder__cell--band.grade-conversion__label--highlight {
    outline: 2px solid var(--ui-text-highlighted);
    outline-offset: 2px;
    box-shadow: none;
}
</style>
