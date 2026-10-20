<template>
    <LayoutAuthLayout
        :loading="loading"
        :eyebrow="$t('account.exportData')"
        :title="title"
        :subtitle="subtitle"
        :heading-key="status"
        back-to="/account/settings"
    >
        <template #brand-headline>
            {{ $t('account.brandHeadline.login.l1') }}<br />
            {{ $t('account.brandHeadline.login.l2') }}<br />
            <span class="text-success">{{
                $t('account.brandHeadline.login.accent')
            }}</span>
        </template>

        <LayoutLoadError v-if="error" @retry="refresh()" />
        <UButton
            v-else-if="status === 'ready'"
            :href="ownDataExportUrl()"
            external
            color="primary"
            size="xl"
            block
            icon="i-lucide-download"
            data-testid="account-export-download"
        >
            {{ $t('account.exportDataDownload') }}
        </UButton>
        <UButton
            v-else-if="!loading"
            to="/account/settings?tab=security"
            color="neutral"
            variant="soft"
            size="xl"
            block
            data-testid="account-export-again"
        >
            {{ $t('account.exportAgain') }}
        </UButton>
    </LayoutAuthLayout>
</template>

<script setup lang="ts">
import { getOwnDataExport, ownDataExportUrl } from '~/api/account'

definePageMeta({ layout: 'blank', middleware: ['auth'] })

const { t } = useI18n()

useHead({ title: t('page.title.dataExport') })

const {
    data,
    status: fetchStatus,
    error,
    refresh,
} = useAsyncData('own-data-export', () => getOwnDataExport(), {
    server: false,
    default: () => null,
})
const loading = computed(
    () => fetchStatus.value === 'idle' || fetchStatus.value === 'pending',
)

const status = computed(() => data.value?.status ?? 'none')
const title = computed(
    () =>
        ({
            ready: t('account.exportReady'),
            too_large: t('account.exportTooLarge'),
            none: t('account.exportNone'),
        })[status.value],
)
const subtitle = computed(
    () =>
        ({
            ready: t('account.exportReadyHint'),
            too_large: t('account.exportTooLargeHint'),
            none: '',
        })[status.value],
)
</script>
