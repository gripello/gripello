<template>
    <div class="mt-4 text-center">
        <UButton
            color="neutral"
            variant="soft"
            :loading="loading"
            :label="t('actions.load_more')"
            :data-testid="testId"
            @click="emit('load')"
        />
    </div>
</template>

<script setup lang="ts">
defineProps<{ loading?: boolean; testId?: string }>()
const emit = defineEmits<{ load: [] }>()

const { t } = useI18n()
</script>
