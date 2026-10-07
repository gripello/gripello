<template>
    <client-only>
        <div
            ref="chartEl"
            :style="containerStyle"
            class="base-echart"
            :data-testid="testid"
        ></div>
        <template #fallback>
            <div
                :style="containerStyle"
                class="animate-pulse rounded-md bg-elevated/60"
            />
        </template>
    </client-only>
</template>

<script setup lang="ts">
import type { EChartsType } from 'echarts/core'

interface ChartProps {
    option: Record<string, unknown>
    height?: string | number
    responsive?: boolean
    testid?: string
}

const emit = defineEmits<{ click: [params: { data?: unknown }] }>()

const props = withDefaults(defineProps<ChartProps>(), {
    height: '320px',
    responsive: true,
    testid: 'chart',
})

const chartEl = ref<HTMLElement | null>(null)
let chartInstance: EChartsType | null = null
let resizeObserver: ResizeObserver | null = null

const containerStyle = computed(() => ({
    width: '100%',
    height:
        typeof props.height === 'number' ? `${props.height}px` : props.height,
}))

const withAria = (option: Record<string, unknown>) => ({
    aria: { enabled: true },
    ...option,
})

const resizeChart = () => {
    if (chartInstance) {
        chartInstance.resize()
    }
}

const destroyChart = () => {
    resizeObserver?.disconnect()
    resizeObserver = null
    if (chartInstance) {
        chartInstance.dispose()
        chartInstance = null
    }
}

const renderChart = async () => {
    const { initEchart } = await import('~/utils/echartsCore')
    if (!chartEl.value) {
        return
    }

    if (!chartInstance) {
        chartInstance = initEchart(chartEl.value, null, { renderer: 'svg' })
        chartInstance.on('click', (params: { data?: unknown }) =>
            emit('click', params),
        )
        if (props.responsive) {
            resizeObserver = new ResizeObserver(resizeChart)
            resizeObserver.observe(chartEl.value)
        }
    }

    chartInstance.setOption(withAria(props.option), true)
}

onMounted(async () => {
    await nextTick()
    await renderChart()
})

onBeforeUnmount(() => {
    destroyChart()
})

watch(
    () => props.option,
    async (next) => {
        if (!next) {
            return
        }
        await nextTick()
        if (!chartInstance) {
            await renderChart()
            return
        }
        chartInstance.setOption(withAria(next), true)
    },
)

watch(
    () => props.height,
    () => {
        nextTick().then(() => {
            resizeChart()
        })
    },
)
</script>

<style scoped>
.base-echart {
    min-height: 200px;
}
</style>
