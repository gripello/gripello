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

        <section v-if="representatives.length">
            <h2>{{ $t('legal.imprintPage.representative') }}</h2>
            <p
                v-for="person in representatives"
                :key="person.name"
                data-testid="imprint-representative"
            >
                {{ person.name
                }}<span v-if="person.role" class="text-muted">
                    – {{ person.role }}</span
                >
            </p>
        </section>

        <section v-if="source?.legal_phone || source?.contact_email">
            <h2>{{ $t('legal.imprintPage.contact') }}</h2>
            <dl>
                <template v-if="source?.legal_phone">
                    <dt>{{ $t('legal.imprintPage.phone') }}</dt>
                    <dd>
                        <a
                            :href="`tel:${source.legal_phone.replace(/\s/g, '')}`"
                            >{{ source.legal_phone }}</a
                        >
                    </dd>
                </template>
                <template v-if="source?.contact_email">
                    <dt>{{ $t('legal.imprintPage.email') }}</dt>
                    <dd>
                        <a :href="`mailto:${source.contact_email}`">{{
                            source.contact_email
                        }}</a>
                    </dd>
                </template>
            </dl>
        </section>

        <section
            v-if="source?.legal_register || source?.legal_vat_id"
            data-testid="imprint-register"
        >
            <h2>{{ $t('legal.imprintPage.register') }}</h2>
            <dl>
                <template v-if="source?.legal_register">
                    <dt>{{ $t('legal.imprintPage.registerEntry') }}</dt>
                    <dd>{{ source.legal_register }}</dd>
                </template>
                <template v-if="source?.legal_vat_id">
                    <dt>{{ $t('legal.imprintPage.vatId') }}</dt>
                    <dd>{{ source.legal_vat_id }}</dd>
                </template>
            </dl>
        </section>

        <section v-if="source?.legal_editorial">
            <h2>{{ $t('legal.imprintPage.editorial') }}</h2>
            <p data-testid="imprint-editorial">
                {{ source.legal_editorial }}
            </p>
        </section>

        <section>
            <h2>{{ $t('legal.imprintPage.disputeTitle') }}</h2>
            <p>{{ $t('legal.imprintPage.dispute') }}</p>
        </section>
    </div>
</template>

<script setup lang="ts">
import type { GymRecord, SettingsRecord } from '~/types/models'

const props = defineProps<{
    source?: Partial<SettingsRecord> | Partial<GymRecord> | null
    name?: string
}>()

const representatives = computed(() =>
    (props.source?.legal_representatives ?? []).filter((person) => person.name),
)
</script>
