<template>
    <div class="page--prose mx-auto w-full p-4" data-testid="gym-imprint-page">
        <LayoutPageHeader
            :title="$t('legal.gymImprint', { name: gym?.name })"
            :subtitle="$t('legal.imprintPage.subtitle')"
        />

        <UAlert
            v-if="!gym?.legal_address"
            color="warning"
            variant="soft"
            icon="i-lucide-triangle-alert"
            :description="$t('legal.gymPage.incomplete')"
            class="mb-4"
            data-testid="imprint-incomplete"
        />

        <LegalImprintDoc :source="gym" :name="gym?.name" />

        <div class="mt-3 flex flex-wrap gap-2">
            <UButton
                v-bind="legalLinkProps(gym?.privacy_url, path('/privacy'))"
                variant="ghost"
                color="primary"
                icon="i-lucide-shield"
                data-testid="imprint-privacy-link"
            >
                {{ $t('legal.privacy') }}
            </UButton>
            <UButton
                to="/imprint"
                variant="ghost"
                color="neutral"
                icon="i-lucide-scale"
                data-testid="gym-imprint-platform-link"
            >
                {{ $t('legal.gymPage.platformImprint') }}
            </UButton>
        </div>
    </div>
</template>

<script setup lang="ts">
import { legalLinkProps } from '~/utils/legal'

const { t } = useI18n()
const { gym } = useGym()
const path = useGymPath()

useSeoMeta({
    title: () => t('legal.imprint'),
    ogTitle: () => t('legal.imprint'),
})
</script>
