<template>
    <div class="page--prose mx-auto w-full p-4" data-testid="gym-privacy-page">
        <LayoutPageHeader
            :title="$t('legal.privacy')"
            :subtitle="$t('legal.privacyPage.subtitle')"
        />

        <LegalPrivacyDoc
            :controller="gym"
            :imprint-path="path('/imprint')"
            :audit-retention-days="settings?.audit_retention_days ?? 90"
        >
            <section v-if="gym?.privacy_extra" data-testid="gym-privacy-extra">
                <h2>{{ $t('legal.gymPage.extraTitle') }}</h2>
                <p class="multiline">{{ gym.privacy_extra }}</p>
            </section>
            <section data-testid="gym-privacy-platform">
                <h2>{{ $t('legal.gymPage.platformTitle') }}</h2>
                <p>{{ $t('legal.gymPage.platformBody') }}</p>
                <p class="flex flex-wrap gap-x-4">
                    <NuxtLink
                        to="/privacy"
                        data-testid="gym-privacy-platform-link"
                        >{{ $t('legal.gymPage.platformPrivacy') }}</NuxtLink
                    >
                    <NuxtLink to="/imprint">{{
                        $t('legal.gymPage.platformImprint')
                    }}</NuxtLink>
                </p>
            </section>
        </LegalPrivacyDoc>
    </div>
</template>

<script setup lang="ts">
import type { SettingsRecord } from '~/types/models'

const { t } = useI18n()
const { gym } = useGym()
const path = useGymPath()
const { data: settings } = useNuxtData<SettingsRecord>('settings')

useSeoMeta({
    title: () => t('legal.privacy'),
    ogTitle: () => t('legal.privacy'),
})
</script>
