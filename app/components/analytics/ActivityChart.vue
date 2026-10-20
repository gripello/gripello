<template>
    <ChartEchart
        :option="option"
        :height="320"
        testid="analytics-chart-activity"
    />
</template>

<script setup lang="ts">
import { formatDate } from '#shared/utils/formatting'
import type { Bucket, TimelineDatum } from '#shared/utils/analytics'
import {
    formatMonthLabel,
    gridBase,
    makeXAxis,
    tooltipBase,
    yAxisBase,
} from '~/utils/echarts'

const VISIBLE_BUCKETS = 24

const props = defineProps<{
    routes: TimelineDatum[]
    ratings: TimelineDatum[]
    bucket: Bucket
}>()

const { t, locale } = useI18n()
const { colors, palette } = useChartTheme()

const option = computed(() => {
    const periods = [
        ...new Set(
            [...props.routes, ...props.ratings].map((item) => item.period),
        ),
    ].sort()
    const countsFor = (timeline: TimelineDatum[]) => {
        const byPeriod = new Map(
            timeline.map((item) => [item.period, item.count]),
        )
        return periods.map((period) => byPeriod.get(period) ?? 0)
    }
    const zoomable = periods.length > VISIBLE_BUCKETS
    const label = (period: string) =>
        props.bucket === 'month'
            ? formatMonthLabel(period, locale.value)
            : formatDate(period, {
                  locale: locale.value,
                  month: 'short',
                  day: 'numeric',
              })

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
        grid: { ...gridBase, top: 36, bottom: zoomable ? 40 : 0 },
        dataZoom: zoomable
            ? [
                  {
                      type: 'inside',
                      startValue: periods.length - VISIBLE_BUCKETS,
                  },
                  {
                      type: 'slider',
                      height: 18,
                      bottom: 4,
                      startValue: periods.length - VISIBLE_BUCKETS,
                      showDetail: false,
                  },
              ]
            : [],
        xAxis: makeXAxis(colors.value, periods.map(label)),
        yAxis: yAxisBase(colors.value),
        series: [
            {
                name: t('analytics.labels.routesSet'),
                type: 'bar',
                barMaxWidth: 24,
                itemStyle: {
                    color: palette.value.categorical[0],
                    borderRadius: [4, 4, 0, 0],
                },
                data: countsFor(props.routes),
            },
            {
                name: t('analytics.labels.ratings'),
                type: 'line',
                symbolSize: 8,
                lineStyle: { width: 2 },
                itemStyle: { color: palette.value.categorical[1] },
                data: countsFor(props.ratings),
            },
        ],
    }
})
</script>
