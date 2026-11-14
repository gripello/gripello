<template>
    <ChartEchart
        :option="option"
        :height="240"
        testid="platform-insights-chart"
    />
</template>

<script setup lang="ts">
import type { PlatformInsights } from '~/api/platform'
import { gridBase, makeXAxis, tooltipBase, yAxisBase } from '~/utils/echarts'
import { insightDayLabel } from '~/utils/platformInsights'
import { THEME_COLORS } from '~/utils/themeColors'

const props = defineProps<{ series: PlatformInsights['series'] }>()

const { t, locale } = useI18n()
const { colors } = useChartTheme()
const colorMode = useColorMode()

const option = computed(() => {
    const theme = THEME_COLORS[colorMode.value === 'dark' ? 'dark' : 'light']
    const line = (
        key: 'visitors' | 'climbers' | 'logs' | 'reviews',
        color: string,
    ) => ({
        name: t(`platform.insights.activity.${key}`),
        type: 'line',
        smooth: false,
        showSymbol: false,
        lineStyle: { width: 2, color },
        itemStyle: { color },
        data: props.series.map((point) => point[key]),
    })
    return {
        backgroundColor: 'transparent',
        tooltip: tooltipBase(colors.value),
        legend: {
            top: 0,
            right: 0,
            textStyle: { color: colors.value.labelColor, fontSize: 11 },
        },
        grid: { ...gridBase, top: 32 },
        xAxis: makeXAxis(
            colors.value,
            props.series.map((point) =>
                insightDayLabel(point.day, locale.value),
            ),
        ),
        yAxis: yAxisBase(colors.value),
        series: [
            line('visitors', theme.info),
            line('climbers', theme.primary),
            line('logs', theme.warning),
            line('reviews', colors.value.labelColor),
        ],
    }
})
</script>
