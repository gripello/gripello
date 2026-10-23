<template>
    <div class="mx-auto w-full p-4">
        <LayoutPageHeader :title="t('moderation.title')" />
        <ModerationInbox :gym-id="gymId" />
    </div>
</template>

<script setup lang="ts">
definePageMeta({
    middleware: ['auth'],
    requiredPermission: 'manage_comments',
})

const { t } = useI18n()
const gymId = useCurrentGymId()

useHead({ title: () => t('moderation.title') })
</script>
