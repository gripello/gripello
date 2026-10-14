<template>
    <div class="surface-card legal-doc">
        <section>
            <h2>{{ $t('legal.imprintPage.provider') }}</h2>
            <address>
                <div v-if="name" class="font-medium" data-testid="imprint-name">
                    {{ name }}
                </div>
                <div
                    v-if="source?.legal_address"
                    class="multiline"
                    data-testid="imprint-address"
                >
                    {{ source.legal_address }}
                </div>
            </address>
        </section>

        <LegalContactDetails :source="source" />

        <section>
            <h2>{{ $t('legal.imprintPage.disputeTitle') }}</h2>
            <p>{{ $t('legal.imprintPage.dispute') }}</p>
        </section>
    </div>
</template>

<script setup lang="ts">
import type { GymRecord, SettingsRecord } from '~/types/models'

defineProps<{
    source?: Partial<SettingsRecord> | Partial<GymRecord> | null
    name?: string
}>()
</script>
