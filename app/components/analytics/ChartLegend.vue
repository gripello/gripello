<template>
    <div class="chart-legend">
        <span v-for="item in items" :key="item.label" class="legend-item">
            <span class="legend-dot" :style="{ background: item.color }" />
            {{ item.label }}
        </span>
    </div>
</template>

<script setup lang="ts">
defineProps<{ items: { color: string; label: string }[] }>()
</script>

<style scoped>
.chart-legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 16px;
    margin-top: 12px;
    font-size: 11px;
    color: var(--ui-text-muted);
}

.legend-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}

.legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
}
</style>
