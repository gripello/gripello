<template>
    <AnalyticsBaseEchart
        :option="option"
        :height="rows.length * 32 + 60"
        testid="analytics-chart-ratings"
        @click="openRoute"
    />
</template>

<script setup lang="ts">
import { formatNumber } from '#shared/utils/number'
import type { RatedRoute } from '#shared/utils/analytics'
import { escapeHtml, gridBase, itemTooltip, yAxisBase } from '~/utils/echarts'

const gymPath = useGymPath()

const props = defineProps<{
    top: RatedRoute[]
    lowest: RatedRoute[]
    baseline: number
}>()

const { t, locale } = useI18n()
const { colors, palette } = useChartTheme()

const rows = computed(() =>
    [...props.top, ...props.lowest].sort(
        (a, b) => a.averageRating - b.averageRating,
    ),
)

const option = computed(() => ({
    backgroundColor: 'transparent',
    tooltip: itemTooltip(colors.value, ({ data }) => {
        const route = data.route as RatedRoute
        return `<strong>${escapeHtml(route.name)}</strong> · ${route.grade}<br/>
            ★ ${formatNumber(route.averageRating, locale.value, 2)} · ${t('analytics.labels.ratingCount', { n: route.ratings }, route.ratings)}`
    }),
    grid: { ...gridBase, left: 12, top: 28, right: 48 },
    xAxis: {
        ...yAxisBase(colors.value),
        axisLabel: {
            color: colors.value.labelColor,
            fontSize: 11,
            formatter: (value: number) =>
                formatNumber(value + props.baseline, locale.value),
        },
    },
    yAxis: {
        type: 'category',
        data: rows.value.map((route) => route.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
            color: colors.value.labelColor,
            fontSize: 11,
            width: 120,
            overflow: 'truncate',
        },
    },
    series: [
        {
            type: 'bar',
            barMaxWidth: 14,
            cursor: 'pointer',
            label: {
                show: true,
                position: 'right',
                color: colors.value.tooltipText,
                fontSize: 11,
                formatter: ({ data }: { data: { route: RatedRoute } }) =>
                    `★ ${formatNumber(data.route.averageRating, locale.value)}`,
            },
            data: rows.value.map((route) => {
                const delta = Number(
                    (route.averageRating - props.baseline).toFixed(2),
                )
                return {
                    value: delta,
                    route,
                    label: { position: delta < 0 ? 'left' : 'right' },
                    itemStyle: {
                        color:
                            delta < 0
                                ? palette.value.negative
                                : palette.value.positive,
                        borderRadius: delta < 0 ? [4, 0, 0, 4] : [0, 4, 4, 0],
                    },
                }
            }),
            markLine: {
                silent: true,
                symbol: 'none',
                lineStyle: { color: colors.value.labelColor, width: 1 },
                label: {
                    position: 'end',
                    formatter: `Ø ${formatNumber(props.baseline, locale.value, 2)}`,
                    color: colors.value.labelColor,
                    fontSize: 11,
                },
                data: [{ xAxis: 0 }],
            },
        },
    ],
}))

function openRoute({ data }: { data?: unknown }) {
    const route = (data as { route?: RatedRoute } | undefined)?.route
    if (route) void navigateTo(gymPath(`/route?id=${route.id}`))
}
</script>
