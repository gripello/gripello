<template>
    <div class="flex items-center gap-1">
        <UButton
            icon="i-lucide-minus"
            color="neutral"
            variant="outline"
            :size="size"
            class="icon-btn"
            :aria-label="$t('competitions.scorecard.undoAttempt')"
            :data-testid="`${testIdPrefix}-undo-${testIdSuffix}`"
            @click="emit('undo')"
        />
        <span
            class="min-w-16 text-center tabular-nums"
            :class="size === 'lg' ? 'text-base font-semibold' : 'text-sm'"
            :data-testid="`${testIdPrefix}-attempts-${testIdSuffix}`"
        >
            {{
                $t('competitions.scorecard.attempts', { n: attempts }, attempts)
            }}
        </span>
        <UButton
            icon="i-lucide-plus"
            color="neutral"
            variant="outline"
            :size="size"
            class="icon-btn"
            :disabled="addDisabled"
            :aria-label="$t('competitions.scorecard.addAttempt')"
            :data-testid="`${testIdPrefix}-attempt-${testIdSuffix}`"
            @click="emit('add')"
        />
    </div>
</template>

<script setup lang="ts">
defineProps<{
    attempts: number
    addDisabled?: boolean
    size?: 'md' | 'lg'
    testIdPrefix: string
    testIdSuffix: string | number
}>()
const emit = defineEmits<{ undo: []; add: [] }>()
</script>
