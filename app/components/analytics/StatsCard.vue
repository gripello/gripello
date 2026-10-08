<template>
    <div class="stats-card surface-card" :style="{ '--accent': accent }">
        <div class="accent-bar"></div>
        <div class="card-body">
            <div class="flex items-center justify-between mb-3">
                <div class="icon-badge" :style="{ background: tint }">
                    <UIcon :name="icon" class="accent-text size-[18px]" />
                </div>
                <UBadge
                    v-if="delta !== null && !loading"
                    size="sm"
                    variant="soft"
                    :color="
                        delta === 0
                            ? 'neutral'
                            : delta > 0
                              ? 'success'
                              : 'error'
                    "
                    :icon="
                        delta === 0
                            ? 'i-lucide-minus'
                            : delta > 0
                              ? 'i-lucide-arrow-up'
                              : 'i-lucide-arrow-down'
                    "
                    data-testid="stats-card-trend"
                >
                    {{ formatDelta(delta) }}
                </UBadge>
            </div>

            <div class="card-label">{{ title }}</div>

            <div v-if="loading" class="mt-1">
                <USkeleton class="h-4 w-20" />
            </div>
            <template v-else>
                <div class="card-value" data-testid="stats-card-value">
                    {{ value === null ? '—' : format(value) }}
                </div>
                <div
                    v-if="meter !== null"
                    class="meter my-2"
                    role="progressbar"
                    :aria-valuenow="Math.round(meter * 100)"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    data-testid="stats-card-meter"
                >
                    <div
                        class="meter-fill"
                        :style="{ width: `${Math.min(meter, 1) * 100}%` }"
                    />
                </div>
                <svg
                    v-else-if="sparkPoints"
                    class="sparkline accent-text my-1"
                    viewBox="0 0 100 24"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    data-testid="stats-card-spark"
                >
                    <polyline
                        :points="sparkPoints"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linejoin="round"
                        vector-effect="non-scaling-stroke"
                    />
                </svg>
                <div class="card-footer">
                    <span v-if="subtitle" class="footer-sub">{{
                        subtitle
                    }}</span>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
const props = withDefaults(
    defineProps<{
        title: string
        value: number | null
        previous?: number | null
        icon: string
        color: string
        subtitle?: string
        loading?: boolean
        format?: (value: number) => string
        spark?: number[]
        meter?: number | null
    }>(),
    {
        previous: null,
        spark: () => [],
        meter: null,
        loading: false,
        format: (value: number) => `${value}`,
    },
)

const accent = computed(() => `var(--ui-${props.color})`)
const tint = computed(
    () => `color-mix(in oklab, ${accent.value} 12%, transparent)`,
)
const delta = computed(() =>
    props.previous === null || props.value === null
        ? null
        : Number((props.value - props.previous).toFixed(2)),
)

const sparkPoints = computed(() => {
    if (props.spark.length < 2) return ''
    const max = Math.max(...props.spark, 1)
    const step = 100 / (props.spark.length - 1)
    return props.spark
        .map((value, index) => `${index * step},${22 - (value / max) * 20}`)
        .join(' ')
})

function formatDelta(value: number) {
    return `${value > 0 ? '+' : ''}${props.format(value)}`
}
</script>

<style scoped>
.stats-card {
    height: 100%;
    position: relative;
    overflow: hidden;
}

.accent-bar {
    position: absolute;
    top: 0;
    left: 18px;
    right: 18px;
    height: 3px;
    border-radius: 0 0 3px 3px;
    background: var(--accent);
}

.accent-text {
    color: var(--accent);
}

.meter {
    height: 6px;
    border-radius: 9999px;
    overflow: hidden;
    background: color-mix(in oklab, var(--accent) 20%, transparent);
}

.meter-fill {
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
}

.card-body {
    padding: 18px 18px 16px;
}

.icon-badge {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.card-label {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: color-mix(in oklab, var(--ui-text-highlighted) 50%, transparent);
    margin-bottom: 4px;
}

.card-value {
    font-size: 30px;
    font-weight: 600;
    line-height: 1.1;
    color: var(--ui-text-highlighted);
}

.sparkline {
    display: block;
    width: 100%;
    height: 24px;
}

.card-footer {
    font-size: 11px;
    min-height: 18px;
    color: color-mix(in oklab, var(--ui-text-highlighted) 40%, transparent);
}
</style>
