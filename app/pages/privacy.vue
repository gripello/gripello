<template>
    <div class="page--prose mx-auto w-full p-4" data-testid="privacy-page">
        <LayoutPageHeader
            :title="$t('legal.privacy')"
            :subtitle="$t('legal.privacyPage.subtitle')"
        />

        <LegalPrivacyDoc
            :controller="settings"
            imprint-path="/imprint"
            :audit-retention-days="auditRetentionDays"
        />
    </div>
</template>

<script setup lang="ts">
import type { SettingsRecord } from '~/types/models'

const { t } = useI18n()
const { data: settings } = useNuxtData<SettingsRecord>('settings')

const auditRetentionDays = computed(
    () => settings.value?.audit_retention_days ?? 90,
)

useSeoMeta({
    title: () => t('legal.privacy'),
    ogTitle: () => t('legal.privacy'),
})
</script>
