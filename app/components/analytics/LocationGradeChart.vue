<template>
    <AnalyticsBaseEchart
        :option="option"
        :height="locations.length * 36 + 90"
        testid="analytics-chart-location-grades"
    />
</template>

<script setup lang="ts">
import { compareGrades, type LocationGradeDatum } from '#shared/utils/analytics'
import { escapeHtml, gridBase, itemTooltip } from '~/utils/echarts'

const props = defineProps<{ cells: LocationGradeDatum[] }>()

const { t } = useI18n()
const { colors, palette } = useChartTheme()

const grades = computed(() =>
    [...new Set(props.cells.map((cell) => cell.grade))].sort(compareGrades),
)
const locations = computed(() =>
    [...new Set(props.cells.map((cell) => cell.location))].sort().reverse(),
)

const option = computed(() => {
    const axisLabel = { color: colors.value.labelColor, fontSize: 11 }
    return {
        backgroundColor: 'transparent',
        tooltip: itemTooltip(colors.value, ({ value }) => {
            const [gradeIndex, locationIndex, count] = value as number[]
            return `<strong>${escapeHtml(locations.value[locationIndex!]!)}</strong> · ${grades.value[gradeIndex!]}<br/>
                ${t('analytics.labels.routeCount', { n: count }, count!)}`
        }),
        grid: { ...gridBase, left: 12, top: 8, bottom: 40 },
        xAxis: {
            type: 'category',
            data: grades.value,
            splitArea: { show: false },
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel,
        },
        yAxis: {
            type: 'category',
            data: locations.value,
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { ...axisLabel, width: 80, overflow: 'truncate' },
        },
        visualMap: {
            min: 0,
            max: Math.max(...props.cells.map((cell) => cell.count), 1),
            calculable: false,
            text: [
                String(Math.max(...props.cells.map((cell) => cell.count), 1)),
                '0',
            ],
            orient: 'horizontal',
            left: 'center',
            bottom: 0,
            itemHeight: 120,
            itemWidth: 10,
            textStyle: { color: colors.value.labelColor, fontSize: 11 },
            inRange: { color: palette.value.sequential },
        },
        series: [
            {
                type: 'heatmap',
                label: { show: true, fontSize: 11 },
                itemStyle: {
                    borderColor: colors.value.tooltipBg,
                    borderWidth: 2,
                    borderRadius: 4,
                },
                data: props.cells.map((cell) => [
                    grades.value.indexOf(cell.grade),
                    locations.value.indexOf(cell.location),
                    cell.count,
                ]),
            },
        ],
    }
})
</script>
