<template>
    <div class="heatmap" data-testid="analytics-heatmap">
        <div class="heatmap-main">
            <div class="heatmap-header">
                <div
                    class="heatmap-title"
                    data-testid="analytics-heatmap-total"
                >
                    {{
                        selectedYear === null
                            ? t(
                                  'analytics.heatmap.totalLastYear',
                                  { n: rangeTotal },
                                  rangeTotal,
                              )
                            : t(
                                  'analytics.heatmap.total',
                                  { n: rangeTotal, year: selectedYear },
                                  rangeTotal,
                              )
                    }}
                </div>
                <nav class="heatmap-years">
                    <UButton
                        v-for="year in availableYears"
                        :key="year"
                        size="sm"
                        :color="year === selectedYear ? 'primary' : 'neutral'"
                        :variant="year === selectedYear ? 'solid' : 'ghost'"
                        :aria-pressed="year === selectedYear"
                        :data-testid="`analytics-heatmap-year-${year}`"
                        @click="selectedYear = year"
                    >
                        {{ year }}
                    </UButton>
                </nav>
            </div>
            <div class="heatmap-box">
                <div
                    ref="scrollRef"
                    class="heatmap-scroll"
                    @scroll.passive="tooltip.visible = false"
                >
                    <div
                        class="heatmap-grid"
                        :style="{ '--weeks': weeks.length }"
                        @mouseover="showCellTooltip"
                        @click="showCellTooltip"
                        @mouseleave="tooltip.visible = false"
                    >
                        <span
                            v-for="label in monthLabels"
                            :key="label.key"
                            class="heatmap-label heatmap-month"
                            :style="{ gridColumn: label.column, gridRow: 1 }"
                        >
                            {{ label.text }}
                        </span>
                        <span
                            v-for="weekday in [0, 2, 4]"
                            :key="weekday"
                            class="heatmap-label heatmap-weekday"
                            :style="{ gridColumn: 1, gridRow: weekday + 2 }"
                        >
                            {{ dayLabels[weekday] }}
                        </span>
                        <template v-for="(week, weekIndex) in weeks">
                            <span
                                v-for="(cell, weekday) in week"
                                :key="cell.date"
                                class="heatmap-cell"
                                :class="
                                    cell.inRange
                                        ? `heatmap-level-${cell.level}`
                                        : 'heatmap-cell--outside'
                                "
                                :style="{
                                    gridColumn: weekIndex + 2,
                                    gridRow: weekday + 2,
                                }"
                                :aria-label="
                                    cell.inRange ? cell.label : undefined
                                "
                                :data-date="
                                    cell.inRange ? cell.date : undefined
                                "
                                :data-count="
                                    cell.inRange ? cell.count : undefined
                                "
                            />
                        </template>
                    </div>
                </div>
                <div class="heatmap-legend">
                    <span>{{ t('analytics.heatmap.less') }}</span>
                    <span
                        v-for="level in 5"
                        :key="level"
                        class="heatmap-cell"
                        :class="`heatmap-level-${level - 1}`"
                    />
                    <span>{{ t('analytics.heatmap.more') }}</span>
                </div>
            </div>
        </div>

        <teleport to="body">
            <div
                v-if="tooltip.visible"
                class="heatmap-tooltip"
                data-testid="analytics-heatmap-tooltip"
                :style="{ left: tooltip.left, top: tooltip.top }"
            >
                {{ tooltip.text }}
            </div>
        </teleport>
    </div>
</template>

<script setup lang="ts">
import type { TimelineDatum } from '#shared/utils/analytics'

interface HeatmapCell {
    date: string
    count: number
    level: number
    inRange: boolean
    label: string
}

const props = defineProps<{ timeline: TimelineDatum[] }>()

const { t, locale } = useI18n()

const currentYear = new Date().getFullYear()
const selectedYear = ref<number | null>(null)
const scrollRef = ref<HTMLElement>()
const tooltip = reactive({ visible: false, text: '', left: '0', top: '0' })

const countByDay = computed(
    () => new Map(props.timeline.map((item) => [item.period, item.count])),
)

const availableYears = computed(() => {
    const years = new Set([currentYear])
    for (const item of props.timeline)
        years.add(Number(item.period.slice(0, 4)))
    return [...years].filter(Number.isFinite).sort((a, b) => b - a)
})

const dayLabels = computed(() => {
    const format = new Intl.DateTimeFormat(locale.value, { weekday: 'short' })
    return Array.from({ length: 7 }, (_, index) =>
        format.format(new Date(2024, 0, index + 1)),
    )
})

function toIsoDay(date: Date) {
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day}`
}

function quartileThresholds(counts: number[]) {
    const sorted = counts.filter((count) => count > 0).sort((a, b) => a - b)
    const at = (share: number) =>
        sorted[Math.floor((sorted.length - 1) * share)] ?? 0
    return [at(0.25), at(0.5), at(0.75)]
}

const range = computed(() => {
    const year = selectedYear.value
    if (year !== null)
        return { start: new Date(year, 0, 1), end: new Date(year, 11, 31) }
    const end = new Date()
    end.setHours(0, 0, 0, 0)
    const start = new Date(end)
    start.setFullYear(start.getFullYear() - 1)
    start.setDate(start.getDate() + 1)
    return { start, end }
})

const weeks = computed<HeatmapCell[][]>(() => {
    const { start, end } = range.value
    const startDay = toIsoDay(start)
    const endDay = toIsoDay(end)
    const isInRange = (day: string) => day >= startDay && day <= endDay
    const cursor = new Date(start)
    cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7))

    const thresholds = quartileThresholds(
        [...countByDay.value.entries()]
            .filter(([day]) => isInRange(day))
            .map(([, count]) => count),
    )
    const formatter = new Intl.DateTimeFormat(locale.value, {
        dateStyle: 'medium',
    })

    const result: HeatmapCell[][] = []
    while (cursor <= end) {
        const week: HeatmapCell[] = []
        for (let weekday = 0; weekday < 7; weekday++) {
            const date = toIsoDay(cursor)
            const count = countByDay.value.get(date) ?? 0
            week.push({
                date,
                count,
                level:
                    count === 0
                        ? 0
                        : 1 +
                          thresholds.filter((limit) => count > limit).length,
                inRange: isInRange(date),
                label: t(
                    'analytics.heatmap.cell',
                    { n: count, date: formatter.format(cursor) },
                    count,
                ),
            })
            cursor.setDate(cursor.getDate() + 1)
        }
        result.push(week)
    }
    return result
})

const rangeTotal = computed(() =>
    weeks.value
        .flat()
        .reduce((sum, cell) => sum + (cell.inRange ? cell.count : 0), 0),
)

const monthLabels = computed(() => {
    const formatter = new Intl.DateTimeFormat(locale.value, { month: 'short' })
    const starts: { key: string; start: number; text: string }[] = []
    weeks.value.forEach((week, index) => {
        const firstInRange = week.find((cell) => cell.inRange) ?? week[0]!
        const key = firstInRange.date.slice(0, 7)
        if (starts[starts.length - 1]?.key === key) return
        starts.push({
            key,
            start: index,
            text: formatter.format(new Date(`${firstInRange.date}T00:00:00`)),
        })
    })
    return starts
        .map((month, index) => ({
            ...month,
            span:
                (starts[index + 1]?.start ?? weeks.value.length) - month.start,
        }))
        .filter((month) => month.span >= 2)
        .map((month) => ({
            key: month.key,
            text: month.text,
            column: `${month.start + 2} / span ${month.span}`,
        }))
})

function scrollToToday() {
    const scroller = scrollRef.value
    if (!scroller) return
    const today = scroller.querySelector<HTMLElement>(
        `[data-date="${toIsoDay(new Date())}"]`,
    )
    scroller.scrollLeft = today
        ? today.offsetLeft + today.offsetWidth - scroller.clientWidth
        : 0
}

function hideTooltip() {
    tooltip.visible = false
}

onMounted(() => {
    scrollToToday()
    window.addEventListener('scroll', hideTooltip, { passive: true })
})
onBeforeUnmount(() => window.removeEventListener('scroll', hideTooltip))
watch(selectedYear, () => nextTick(scrollToToday))

function showCellTooltip(event: MouseEvent) {
    const target = event.target as HTMLElement | null
    const label = target?.getAttribute('aria-label')
    if (!target || !label) {
        tooltip.visible = false
        return
    }
    const rect = target.getBoundingClientRect()
    tooltip.text = label
    tooltip.left = `${rect.left + rect.width / 2}px`
    tooltip.top = `${rect.top - 6}px`
    tooltip.visible = true
}
</script>

<style scoped>
@reference "~/assets/css/main.css";

.heatmap-main {
    min-width: 0;
}

.heatmap-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
}

.heatmap-title {
    font-size: 0.875rem;
    color: var(--ui-text-highlighted);
}

.heatmap-scroll {
    position: relative;
    overflow-x: auto;
}

.heatmap-grid {
    display: grid;
    grid-template-columns: auto repeat(var(--weeks), minmax(10px, 1fr));
    grid-template-rows: auto;
    gap: 3px;
    min-width: calc(var(--weeks) * 13px + 32px);
}

.heatmap-label {
    font-size: 11px;
    line-height: 1;
    color: color-mix(in oklab, var(--ui-text-highlighted) 60%, transparent);
    white-space: nowrap;
    align-self: center;
}

.heatmap-month {
    padding-bottom: 4px;
}

.heatmap-weekday {
    padding-right: 6px;
    text-align: right;
}

.heatmap-cell {
    aspect-ratio: 1;
    border-radius: 3px;
    outline: 1px solid
        color-mix(in oklab, var(--ui-text-highlighted) 5%, transparent);
    outline-offset: -1px;
}

.heatmap-cell--outside {
    outline: none;
}

.heatmap-level-0 {
    background: color-mix(in oklab, var(--ui-text-highlighted) 7%, transparent);
}
.heatmap-level-1 {
    background: color-mix(in oklab, var(--ui-primary) 35%, transparent);
}
.heatmap-level-2 {
    background: color-mix(in oklab, var(--ui-primary) 60%, transparent);
}
.heatmap-level-3 {
    background: color-mix(in oklab, var(--ui-primary) 80%, transparent);
}
.heatmap-level-4 {
    background: var(--ui-primary);
}

.heatmap-legend {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 3px;
    margin-top: 8px;
    font-size: 11px;
    color: color-mix(in oklab, var(--ui-text-highlighted) 60%, transparent);
}

.heatmap-legend .heatmap-cell {
    width: 10px;
}

.heatmap-legend span:first-child {
    margin-right: 4px;
}

.heatmap-legend span:last-child {
    margin-left: 4px;
}

.heatmap-years {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
}

.heatmap-tooltip {
    position: fixed;
    z-index: 2000;
    transform: translate(-50%, -100%);
    pointer-events: none;
    padding: 6px 10px;
    border-radius: 8px;
    font-size: 12px;
    white-space: nowrap;
    background: color-mix(in oklab, var(--ui-bg) 96%, transparent);
    color: color-mix(in oklab, var(--ui-text-highlighted) 90%, transparent);
    border: 1px solid
        color-mix(in oklab, var(--ui-text-highlighted) 10%, transparent);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}
</style>
