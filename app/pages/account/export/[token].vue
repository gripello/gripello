<template>
    <LayoutAuthLayout
        :loading="!error && available === null"
        :eyebrow="$t('account.exportData')"
        :title="
            error
                ? $t('account.exportData')
                : available
                  ? $t('account.exportReady')
                  : $t('account.linkInvalid')
        "
        :subtitle="
            error
                ? ''
                : available
                  ? $t('account.exportReadyHint')
                  : $t('account.exportExpired')
        "
        :heading-key="error ? 'error' : available ? 'ready' : 'invalid'"
        back-to="/"
    >
        <template #brand-headline>
            {{ $t('account.brandHeadline.login.l1') }}<br />
            {{ $t('account.brandHeadline.login.l2') }}<br />
            <span class="text-success">{{
                $t('account.brandHeadline.login.accent')
            }}</span>
        </template>

        <LayoutLoadError v-if="error" :card="false" @retry="refresh()" />
        <UButton
            v-else-if="available"
            :href="downloadUrl"
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
            v-else-if="available === false"
            to="/account/settings"
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
import { dataExportAvailable, dataExportUrl } from '~/api/account'

definePageMeta({ layout: 'blank' })

const { t } = useI18n()
const route = useRoute()
const token = String(route.params.token ?? '')
const downloadUrl = dataExportUrl(token)

useHead({ title: t('page.title.dataExport') })

const {
    data: available,
    error,
    refresh,
} = useAsyncData(`data-export-${token}`, () => dataExportAvailable(token), {
    server: false,
    default: () => null,
})
</script>
