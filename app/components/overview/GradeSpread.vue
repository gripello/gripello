<template>
    <figure
        v-if="bars.length"
        class="grade-spread"
        data-testid="overview-grades"
    >
        <figcaption class="grade-spread__title">{{ title }}</figcaption>
        <div class="grade-spread__bars" role="list">
            <div
                v-for="(bar, index) in bars"
                :key="bar.grade"
                class="grade-spread__bar"
                :class="{ 'grade-spread__bar--minor': index % 2 === 1 }"
                role="listitem"
                :aria-label="`${bar.grade}: ${bar.count}`"
                data-testid="overview-grade-bar"
            >
                <span class="grade-spread__count">{{ bar.count }}</span>
                <span
                    class="grade-spread__fill"
                    data-testid="overview-grade-fill"
                    :style="{ height: `${(bar.count / max) * 100}%` }"
                />
                <span class="grade-spread__label">{{ bar.grade }}</span>
            </div>
        </div>
    </figure>
</template>

<script setup lang="ts">
const props = defineProps<{
    title: string
    bars: { grade: string; count: number }[]
}>()

const max = computed(() => Math.max(1, ...props.bars.map((bar) => bar.count)))
</script>

<style scoped>
.grade-spread {
    margin: 0;
}

.grade-spread__title {
    font-size: 0.875rem;
    font-weight: 600;
    margin-bottom: 8px;
}

.grade-spread__bars {
    display: flex;
    gap: 4px;
    height: 140px;
}

.grade-spread__bar {
    display: grid;
    grid-template-rows: 1rem 1fr 1.75rem;
    flex: 1;
    align-items: end;
    min-width: 0;
    text-align: center;
    border-radius: 4px;
    cursor: default;
    container-type: inline-size;
    transition: opacity 0.15s ease;
}

@media (hover: hover) {
    .grade-spread__bars:hover .grade-spread__bar:not(:hover) {
        opacity: 0.45;
    }
}

.grade-spread__bar:hover .grade-spread__label {
    font-weight: 700;
}

.grade-spread__count {
    font-size: 0.7rem;
    color: var(--ui-text-muted);
}

.grade-spread__fill {
    display: block;
    min-height: 2px;
    border-radius: 4px 4px 0 0;
    background: var(--ui-primary);
    align-self: end;
}

.grade-spread__label {
    align-self: start;
    margin-top: 4px;
    font-size: 0.7rem;
    white-space: nowrap;
    overflow: hidden;
}

@container (max-width: 22px) {
    .grade-spread__label {
        justify-self: center;
        overflow: visible;
    }

    .grade-spread__bar--minor .grade-spread__label {
        visibility: hidden;
    }
}
</style>
