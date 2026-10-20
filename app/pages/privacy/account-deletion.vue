<template>
    <div
        class="page--prose mx-auto w-full p-4"
        data-testid="account-deletion-page"
    >
        <LayoutPageHeader
            :title="$t('legal.accountDeletionPage.title')"
            :subtitle="$t('legal.accountDeletionPage.subtitle')"
            back-to="/privacy"
        />

        <LayoutPanel flush as="div" class="legal-doc">
            <section>
                <h2>{{ $t('legal.accountDeletionPage.stepsTitle') }}</h2>
                <ol>
                    <li v-for="step in STEPS" :key="step">
                        {{ $t(`legal.accountDeletionPage.steps.${step}`) }}
                    </li>
                </ol>
                <UButton
                    to="/account/settings?tab=security"
                    icon="i-lucide-settings"
                    class="mt-2"
                    data-testid="account-deletion-settings"
                >
                    {{ $t('legal.accountDeletionPage.openSettings') }}
                </UButton>
            </section>

            <section>
                <h2>{{ $t('legal.accountDeletionPage.deletedTitle') }}</h2>
                <ul>
                    <li v-for="item in DELETED" :key="item">
                        {{ $t(`legal.accountDeletionPage.deleted.${item}`) }}
                    </li>
                </ul>
            </section>

            <section>
                <h2>{{ $t('legal.accountDeletionPage.keptTitle') }}</h2>
                <ul>
                    <li v-for="item in KEPT" :key="item">
                        {{
                            $t(`legal.accountDeletionPage.kept.${item}`, {
                                days: auditRetentionDays,
                            })
                        }}
                    </li>
                </ul>
            </section>

            <section v-if="settings?.contact_email">
                <h2>{{ $t('legal.accountDeletionPage.noAccessTitle') }}</h2>
                <p>{{ $t('legal.accountDeletionPage.noAccess') }}</p>
                <p>
                    <a
                        :href="`mailto:${settings.contact_email}`"
                        data-testid="account-deletion-contact"
                        >{{ settings.contact_email }}</a
                    >
                </p>
            </section>
        </LayoutPanel>
    </div>
</template>

<script setup lang="ts">
import type { SettingsRecord } from '~/types/models'

const STEPS = ['signIn', 'open', 'confirm', 'admins'] as const
const DELETED = [
    'profile',
    'security',
    'logbook',
    'betas',
    'social',
    'memberships',
] as const
const KEPT = [
    'reviews',
    'reports',
    'activity',
    'exports',
    'logs',
    'backups',
] as const

const { t } = useI18n()
const { data: settings } = useNuxtData<SettingsRecord>('settings')

const auditRetentionDays = computed(
    () => settings.value?.audit_retention_days ?? 90,
)

useSeoMeta({
    title: () => t('legal.accountDeletionPage.title'),
    ogTitle: () => t('legal.accountDeletionPage.title'),
    description: () => t('legal.accountDeletionPage.subtitle'),
})
</script>
