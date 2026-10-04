<template>
    <nav
        class="flex flex-wrap items-center gap-x-1.5 text-xs text-muted"
        :aria-label="$t('legal.imprint')"
    >
        <ULink
            v-bind="legalLinkProps(settings.imprint_url, `${gymBase}/imprint`)"
            class="text-muted hover:text-highlighted"
            :active="false"
            data-testid="footer-imprint"
        >
            {{ $t('legal.imprint') }}
        </ULink>
        <span aria-hidden="true">·</span>
        <ULink
            v-bind="legalLinkProps(settings.privacy_url, `${gymBase}/privacy`)"
            class="text-muted hover:text-highlighted"
            :active="false"
            data-testid="footer-privacy"
        >
            {{ $t('legal.privacy') }}
        </ULink>
    </nav>
</template>

<script setup lang="ts">
import type { GymRecord, SettingsRecord } from '~/types/models'
import { legalLinkProps } from '~/utils/legal'

const props = withDefaults(
    defineProps<{
        settings?: Partial<SettingsRecord> | Partial<GymRecord>
        gymSlug?: string
    }>(),
    { settings: () => ({}), gymSlug: '' },
)
const gymBase = computed(() => (props.gymSlug ? `/${props.gymSlug}` : ''))
</script>
