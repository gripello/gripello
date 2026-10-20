<template>
    <ChartEchart
        :option="option"
        :height="320"
        testid="analytics-chart-grade-balance"
    />
</template>

<script setup lang="ts">
import type { GradeDatum } from '#shared/utils/analytics'
import {
    buildTooltip,
    gridBase,
    makeXAxis,
    tooltipBase,
    yAxisBase,
} from '~/utils/echarts'

const props = defineProps<{ grades: GradeDatum[] }>()

const { t } = useI18n()
const { colors, palette } = useChartTheme()

const rows = computed(() => props.grades.filter((row) => row.grade !== '?'))

const option = computed(() => ({
    backgroundColor: 'transparent',
    tooltip: {
        ...tooltipBase(colors.value),
        formatter: ([param]: { dataIndex: number }[]) => {
            const row = rows.value[param!.dataIndex]!
            return buildTooltip(
                colors.value,
                row.grade,
                `${row.total} / ${row.expected}`,
                t('analytics.labels.activeVsExpected'),
            )
        },
    },
    grid: { ...gridBase, top: 16 },
    xAxis: makeXAxis(
        colors.value,
        rows.value.map((row) => row.grade),
    ),
    yAxis: yAxisBase(colors.value),
    series: [
        {
            type: 'bar',
            barMaxWidth: 28,
            data: rows.value.map((row) => {
                const balance = Number((row.total - row.expected).toFixed(1))
                return {
                    value: balance,
                    itemStyle: {
                        color:
                            balance < 0
                                ? palette.value.negative
                                : palette.value.positive,
                        borderRadius: balance < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0],
                    },
                }
            }),
            markLine: {
                silent: true,
                symbol: 'none',
                lineStyle: { color: colors.value.labelColor, width: 1 },
                label: { show: false },
                data: [{ yAxis: 0 }],
            },
        },
    ],
}))
</script>
