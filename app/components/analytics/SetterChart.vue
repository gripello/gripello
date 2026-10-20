<template>
    <ChartEchart
        :option="option"
        :height="rows.length * 28 + 70"
        testid="analytics-chart-setters"
    />
</template>

<script setup lang="ts">
import { formatNumber } from '#shared/utils/number'
import type { SetterStats } from '#shared/utils/analytics'
import { escapeHtml, gridBase, itemTooltip, yAxisBase } from '~/utils/echarts'

const SETTER_LIMIT = 15

const props = defineProps<{ setters: SetterStats[] }>()

const { t, locale } = useI18n()
const { colors, palette } = useChartTheme()

const total = computed(() =>
    props.setters.reduce((sum, setter) => sum + setter.routes, 0),
)

const rows = computed(() => {
    const shown = props.setters.slice(0, SETTER_LIMIT)
    const rest = props.setters.slice(SETTER_LIMIT)
    const other: SetterStats[] = rest.length
        ? [
              {
                  setter: t(
                      'analytics.labels.otherSetters',
                      { n: rest.length },
                      rest.length,
                  ),
                  routes: rest.reduce((sum, setter) => sum + setter.routes, 0),
                  routesInPeriod: rest.reduce(
                      (sum, setter) => sum + setter.routesInPeriod,
                      0,
                  ),
                  averageRating: null,
                  averageDeviation: null,
              },
          ]
        : []
    return [...shown, ...other].reverse()
})

const formatSigned = (value: number | null) =>
    value === null
        ? '—'
        : `${value > 0 ? '+' : ''}${formatNumber(value, locale.value, 2)}`

const share = (routes: number) =>
    total.value ? Math.round((routes / total.value) * 100) : 0

const option = computed(() => {
    const barBase = {
        type: 'bar',
        stack: 'routes',
        barMaxWidth: 16,
    }
    return {
        backgroundColor: 'transparent',
        tooltip: itemTooltip(colors.value, ({ data }) => {
            const setter = data.setter as SetterStats
            return `<strong>${escapeHtml(setter.setter)}</strong><br/>
                ${t('analytics.labels.routeCount', { n: setter.routes }, setter.routes)} (${share(setter.routes)}%)<br/>
                ${t('analytics.labels.setInPeriod')}: ${setter.routesInPeriod}<br/>
                ${t('analytics.columns.averageRating')}: ${formatNumber(setter.averageRating, locale.value, 2)}<br/>
                ${t('analytics.columns.averageDeviation')}: ${formatSigned(setter.averageDeviation)}`
        }),
        legend: {
            bottom: 0,
            itemWidth: 10,
            itemHeight: 10,
            textStyle: { color: colors.value.labelColor, fontSize: 11 },
        },
        grid: { ...gridBase, left: 12, top: 8, right: 64, bottom: 32 },
        xAxis: { ...yAxisBase(colors.value), minInterval: 1 },
        yAxis: {
            type: 'category',
            data: rows.value.map((setter) => setter.setter),
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
                ...barBase,
                name: t('analytics.labels.setInPeriod'),
                itemStyle: { color: palette.value.categorical[0] },
                data: rows.value.map((setter) => ({
                    value: setter.routesInPeriod,
                    setter,
                })),
            },
            {
                ...barBase,
                name: t('analytics.labels.setEarlier'),
                itemStyle: {
                    color: palette.value.sequential[1],
                    borderRadius: [0, 4, 4, 0],
                },
                label: {
                    show: true,
                    position: 'right',
                    color: colors.value.tooltipText,
                    fontSize: 11,
                    formatter: ({ data }: { data: { setter: SetterStats } }) =>
                        `${data.setter.routes} · ${share(data.setter.routes)}%`,
                },
                data: rows.value.map((setter) => ({
                    value: setter.routes - setter.routesInPeriod,
                    setter,
                })),
            },
        ],
    }
})
</script>
