<template>
    <AnalyticsBaseEchart
        :option="option"
        :height="rows.length * 28 + 40"
        testid="analytics-chart-age"
        @click="openRoute"
    />
</template>

<script setup lang="ts">
import type { AgedRoute } from '#shared/utils/analytics'
import { escapeHtml, gridBase, itemTooltip, yAxisBase } from '~/utils/echarts'

const gymPath = useGymPath()

const props = defineProps<{ routes: AgedRoute[] }>()

const { t } = useI18n()
const { colors, palette } = useChartTheme()

const rows = computed(() => [...props.routes].reverse())

const option = computed(() => ({
    backgroundColor: 'transparent',
    tooltip: itemTooltip(colors.value, ({ data }) => {
        const route = data.route as AgedRoute
        const details = [route.grade, route.location, route.creators.join(', ')]
            .filter(Boolean)
            .map((part) => escapeHtml(String(part)))
            .join(' · ')
        return `<strong>${escapeHtml(route.name)}</strong><br/>${details}<br/>
            ${t('analytics.labels.days', { n: route.ageDays })}`
    }),
    grid: { ...gridBase, left: 12, top: 8, right: 48 },
    xAxis: yAxisBase(colors.value),
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
            itemStyle: {
                color: palette.value.categorical[1],
                borderRadius: [0, 4, 4, 0],
            },
            label: {
                show: true,
                position: 'right',
                color: colors.value.tooltipText,
                fontSize: 11,
                formatter: ({ value }: { value: number }) =>
                    t('analytics.labels.days', { n: value }),
            },
            data: rows.value.map((route) => ({ value: route.ageDays, route })),
        },
    ],
}))

function openRoute({ data }: { data?: unknown }) {
    const route = (data as { route?: AgedRoute } | undefined)?.route
    if (route) void navigateTo(gymPath(`/route?id=${route.id}`))
}
</script>
