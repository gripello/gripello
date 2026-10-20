<template>
    <ChartEchart
        :option="option"
        :height="220"
        testid="analytics-chart-rating-distribution"
    />
</template>

<script setup lang="ts">
import { buildTooltip, gridBase, tooltipBase, yAxisBase } from '~/utils/echarts'

const props = defineProps<{ counts: number[] }>()

const { t } = useI18n()
const { colors, palette } = useChartTheme()

const option = computed(() => ({
    backgroundColor: 'transparent',
    tooltip: {
        ...tooltipBase(colors.value),
        formatter: ([param]: { name: string; value: number }[]) =>
            buildTooltip(
                colors.value,
                param!.name,
                param!.value,
                t('analytics.labels.ratings'),
            ),
    },
    grid: { ...gridBase, top: 8, right: 40 },
    xAxis: { ...yAxisBase(colors.value), minInterval: 1 },
    yAxis: {
        type: 'category',
        data: ['1 ★', '2 ★', '3 ★', '4 ★', '5 ★'],
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: colors.value.labelColor, fontSize: 12 },
    },
    series: [
        {
            type: 'bar',
            barMaxWidth: 16,
            itemStyle: {
                color: palette.value.categorical[3],
                borderRadius: [0, 4, 4, 0],
            },
            label: {
                show: true,
                position: 'right',
                color: colors.value.tooltipText,
                fontSize: 11,
            },
            data: props.counts,
        },
    ],
}))
</script>
