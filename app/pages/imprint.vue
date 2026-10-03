<template>
    <div class="page--prose mx-auto w-full p-4" data-testid="imprint-page">
        <LayoutPageHeader
            :title="$t('legal.imprint')"
            :subtitle="$t('legal.imprintPage.subtitle')"
        />

        <UAlert
            v-if="!settings?.legal_address"
            color="warning"
            variant="soft"
            icon="i-lucide-triangle-alert"
            :description="$t('legal.imprintPage.incomplete')"
            class="mb-4"
            data-testid="imprint-incomplete"
        />

        <LegalImprintDoc :source="settings" />

        <UButton
            to="/privacy"
            variant="ghost"
            color="primary"
            icon="i-lucide-shield"
            class="mt-3"
            data-testid="imprint-privacy-link"
        >
            {{ $t('legal.privacy') }}
        </UButton>
    </div>
</template>

<script setup lang="ts">
import type { SettingsRecord } from '~/types/models'

const { t } = useI18n()
const { data: settings } = useNuxtData<SettingsRecord>('settings')

useSeoMeta({
    title: () => t('legal.imprint'),
    ogTitle: () => t('legal.imprint'),
})
</script>
