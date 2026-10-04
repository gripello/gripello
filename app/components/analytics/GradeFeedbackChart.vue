<template>
    <div>
        <AnalyticsBaseEchart
            :option="option"
            :height="320"
            testid="analytics-chart-grade-feedback"
            @click="openRoute"
        />
        <AnalyticsChartLegend :items="legend" />
    </div>
</template>

<script setup lang="ts">
import { formatNumber } from '#shared/utils/number'
import {
    GRADE_DEVIATION_THRESHOLD,
    type FeedbackRoute,
} from '#shared/utils/analytics'
import { escapeHtml, gridBase, itemTooltip, yAxisBase } from '~/utils/echarts'

const gymPath = useGymPath()

const props = defineProps<{ routes: FeedbackRoute[] }>()

const { t, locale } = useI18n()
const { colors, palette } = useChartTheme()

function colorFor(deviation: number) {
    if (deviation >= GRADE_DEVIATION_THRESHOLD) return palette.value.negative
    if (deviation <= -GRADE_DEVIATION_THRESHOLD) return palette.value.positive
    return palette.value.neutral
}

const legend = computed(() => [
    {
        color: palette.value.negative,
        label: t('analytics.labels.climbsHarder'),
    },
    { color: palette.value.neutral, label: t('analytics.labels.gradedFair') },
    {
        color: palette.value.positive,
        label: t('analytics.labels.climbsSofter'),
    },
])

const option = computed(() => {
    const grades = props.routes.flatMap((route) => [
        route.setGrade,
        route.votedGrade,
    ])
    const min = Math.floor(Math.min(...grades)) - 1
    const max = Math.ceil(Math.max(...grades)) + 1
    const axis = {
        ...yAxisBase(colors.value),
        min,
        max,
        interval: 1,
        nameLocation: 'middle',
        nameGap: 28,
        nameTextStyle: { color: colors.value.labelColor, fontSize: 11 },
    }

    return {
        backgroundColor: 'transparent',
        tooltip: itemTooltip(colors.value, ({ data }) => {
            const route = data.route as FeedbackRoute
            return `<strong>${escapeHtml(route.name)}</strong><br/>
                ${t('analytics.labels.setGrade')}: ${route.grade}<br/>
                ${t('analytics.labels.votedGrade')}: ${route.votedGradeLabel || formatNumber(route.votedGrade, locale.value)}<br/>
                ${t('analytics.labels.voteCount', { n: route.votes }, route.votes)}`
        }),
        grid: { ...gridBase, left: 36, bottom: 30, top: 16 },
        xAxis: { ...axis, name: t('analytics.labels.setGrade') },
        yAxis: { ...axis, name: t('analytics.labels.votedGrade') },
        series: [
            {
                type: 'scatter',
                cursor: 'pointer',
                data: props.routes.map((route) => ({
                    value: [route.setGrade, route.votedGrade],
                    route,
                    symbolSize: Math.min(8 + route.votes * 2, 26),
                    itemStyle: {
                        color: colorFor(route.deviation),
                        borderColor: colors.value.tooltipBg,
                        borderWidth: 2,
                        opacity: 0.85,
                    },
                })),
                markLine: {
                    silent: true,
                    symbol: 'none',
                    lineStyle: {
                        color: colors.value.labelColor,
                        type: 'dashed',
                        width: 1,
                    },
                    label: { show: false },
                    data: [[{ coord: [min, min] }, { coord: [max, max] }]],
                },
            },
        ],
    }
})

function openRoute({ data }: { data?: unknown }) {
    const route = (data as { route?: FeedbackRoute } | undefined)?.route
    if (route) void navigateTo(gymPath(`/route?id=${route.id}`))
}
</script>
