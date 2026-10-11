<template>
    <AnalyticsBaseEchart
        :option="option"
        :height="220"
        testid="platform-traffic-chart"
    />
</template>

<script setup lang="ts">
import type { PlatformTraffic } from '~/api/platform'
import { gridBase, makeXAxis, tooltipBase, yAxisBase } from '~/utils/echarts'
import { trafficLabel } from '~/utils/platformTraffic'
import { THEME_COLORS } from '~/utils/themeColors'

const props = defineProps<{
    series: PlatformTraffic['series']
    stepSeconds: number
}>()

const { t, locale } = useI18n()
const { colors } = useChartTheme()
const colorMode = useColorMode()

const option = computed(() => {
    const theme = THEME_COLORS[colorMode.value === 'dark' ? 'dark' : 'light']
    const bar = (name: string, color: string, data: number[]) => ({
        name,
        type: 'bar',
        stack: 'status',
        barMaxWidth: 28,
        itemStyle: { color },
        data,
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
                trafficLabel(point.t, props.stepSeconds, locale.value),
            ),
        ),
        yAxis: yAxisBase(colors.value),
        series: [
            bar(
                t('platform.overview.traffic.ok'),
                theme.primary,
                props.series.map(
                    (p) => p.requests - p.client_errors - p.server_errors,
                ),
            ),
            bar(
                t('platform.overview.traffic.clientErrors'),
                theme.warning,
                props.series.map((p) => p.client_errors),
            ),
            bar(
                t('platform.overview.traffic.serverErrors'),
                theme.error,
                props.series.map((p) => p.server_errors),
            ),
        ],
    }
})
</script>
