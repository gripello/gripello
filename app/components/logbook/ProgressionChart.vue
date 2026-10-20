<template>
    <ChartEchart :option="option" :height="300" testid="logbook-progression" />
</template>

<script setup lang="ts">
import type { GradeSystem } from '#shared/utils/grades'
import { nearestGrade } from '#shared/utils/grades'
import type { ProgressionPoint } from '#shared/utils/logbook'
import {
    formatMonthLabel,
    gridBase,
    makeXAxis,
    tooltipBase,
    yAxisBase,
} from '~/utils/echarts'

const props = defineProps<{
    points: ProgressionPoint[]
    system: GradeSystem
}>()

const { t, locale } = useI18n()
const { colors, palette } = useChartTheme()

const option = computed(() => {
    const grades = props.points
        .map((point) => point.maxIndex)
        .filter((value): value is number => value !== null)
    const low = grades.length ? Math.max(0, Math.min(...grades) - 1) : 0
    const high = grades.length ? Math.max(...grades) + 1 : 10
    const gradeLabel = (value: number) => nearestGrade(props.system, value)

    return {
        backgroundColor: 'transparent',
        tooltip: {
            ...tooltipBase(colors.value),
            axisPointer: { type: 'line' },
        },
        legend: {
            top: 0,
            textStyle: { color: colors.value.labelColor, fontSize: 11 },
        },
        grid: { ...gridBase, top: 36 },
        xAxis: makeXAxis(
            colors.value,
            props.points.map((point) =>
                formatMonthLabel(point.period, locale.value),
            ),
        ),
        yAxis: [
            { ...yAxisBase(colors.value), minInterval: 1 },
            {
                ...yAxisBase(colors.value),
                min: low,
                max: high,
                interval: 1,
                splitLine: { show: false },
                axisLabel: {
                    color: colors.value.labelColor,
                    formatter: gradeLabel,
                },
            },
        ],
        series: [
            {
                name: t('ticks.progression.sends'),
                type: 'bar',
                barMaxWidth: 24,
                itemStyle: {
                    color: palette.value.categorical[0],
                    borderRadius: [4, 4, 0, 0],
                },
                data: props.points.map((point) => point.sends),
            },
            {
                name: t('ticks.progression.hardest'),
                type: 'line',
                yAxisIndex: 1,
                connectNulls: true,
                symbolSize: 8,
                lineStyle: { width: 2 },
                itemStyle: { color: palette.value.categorical[1] },
                tooltip: {
                    valueFormatter: (value: number | null) =>
                        value === null ? '—' : gradeLabel(value),
                },
                data: props.points.map((point) => point.maxIndex),
            },
        ],
    }
})
</script>
