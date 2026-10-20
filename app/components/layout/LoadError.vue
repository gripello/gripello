<script setup lang="ts">
withDefaults(defineProps<{ card?: boolean }>(), { card: true })
defineEmits<{ retry: [] }>()
</script>

<template>
    <LayoutEmptyState
        variant="error"
        :card="card"
        :title="$t('errors.loadFailed')"
        data-testid="load-error"
    >
        <template #actions>
            <UButton
                color="neutral"
                variant="soft"
                icon="i-lucide-refresh-cw"
                data-testid="load-error-retry"
                @click="$emit('retry')"
            >
                {{ $t('errors.retry') }}
            </UButton>
        </template>
    </LayoutEmptyState>
</template>
