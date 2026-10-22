<script setup lang="ts">
export type StatTileColor = 'primary' | 'success' | 'info' | 'warning' | 'error'

const TEXT_COLORS: Record<StatTileColor, string> = {
    primary: 'text-primary',
    success: 'text-success',
    info: 'text-info',
    warning: 'text-warning',
    error: 'text-error',
}

const props = withDefaults(
    defineProps<{
        label: string
        value: string | number
        icon?: string
        iconColor?: StatTileColor
        color?: StatTileColor
        valueTestId?: string
    }>(),
    {
        icon: undefined,
        iconColor: undefined,
        color: undefined,
        valueTestId: 'stat-tile-value',
    },
)

const iconClass = computed(
    () => props.iconColor && TEXT_COLORS[props.iconColor],
)
const valueClass = computed(() => props.color && TEXT_COLORS[props.color])
</script>

<template>
    <div class="text-center">
        <div class="flex items-center justify-center gap-1">
            <UIcon
                v-if="icon"
                :name="icon"
                class="stat-tile-icon size-[20px]"
                :class="iconClass"
            />
            <span
                class="text-[1.375rem] leading-7 font-bold tabular-nums"
                :class="valueClass"
                :data-testid="valueTestId"
                >{{ value }}</span
            >
        </div>
        <div class="text-xs text-muted">{{ label }}</div>
    </div>
</template>
