<template>
    <span
        v-if="solving"
        class="inline-flex items-center gap-2"
        data-testid="captcha-progress"
    >
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
        {{ $t('captcha.verifying', { progress }) }}
    </span>
    <UIcon v-else name="i-lucide-loader-circle" class="size-5 animate-spin" />
</template>

<script setup lang="ts">
const { solving, progress } = useCapToken()
</script>
