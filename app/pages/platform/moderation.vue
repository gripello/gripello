<template>
    <div class="w-full p-4">
        <LayoutPageHeader :title="t('moderation.title')" />
        <ModerationInbox platform />
    </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: ['auth'], platformAdmin: true })

const { t } = useI18n()

useHead({ title: () => t('moderation.title') })
</script>
