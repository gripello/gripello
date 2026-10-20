<template>
    <ChartEchart
        :option="option"
        :height="Math.max(200, rows.length * 32 + 60)"
        testid="logbook-pyramid"
    />
</template>

<script setup lang="ts">
import type { PyramidRow } from '#shared/utils/logbook'
import { gridBase, tooltipBase, yAxisBase } from '~/utils/echarts'

const props = defineProps<{ rows: PyramidRow[] }>()

const { t } = useI18n()
const { colors, palette } = useChartTheme()
const themeColors = useThemeColors()

const option = computed(() => {
    const bottomUp = [...props.rows].reverse()
    return {
        backgroundColor: 'transparent',
        tooltip: tooltipBase(colors.value),
        legend: {
            top: 0,
            textStyle: { color: colors.value.labelColor, fontSize: 11 },
        },
        grid: { ...gridBase, top: 32 },
        xAxis: { ...yAxisBase(colors.value), minInterval: 1 },
        yAxis: {
            type: 'category',
            data: bottomUp.map((row) => row.grade),
            axisTick: { show: false },
            axisLine: { lineStyle: { color: colors.value.gridColor } },
            axisLabel: { color: colors.value.labelColor, fontWeight: 600 },
        },
        series: [
            {
                name: t('ticks.types.flash'),
                type: 'bar',
                stack: 'sends',
                barMaxWidth: 22,
                itemStyle: { color: palette.value.categorical[3] },
                data: bottomUp.map((row) => row.flash),
            },
            {
                name: t('ticks.types.top'),
                type: 'bar',
                stack: 'sends',
                barMaxWidth: 22,
                itemStyle: {
                    color: themeColors.value.success,
                    borderRadius: [0, 4, 4, 0],
                },
                data: bottomUp.map((row) => row.top),
            },
        ],
    }
})
</script>
