<template>
    <div class="surface-card legal-doc">
        <template
            v-for="(section, index) in sections"
            :key="section.type === 'block' ? section.key : `text-${index}`"
        >
            <section
                v-if="section.type === 'text'"
                data-testid="privacy-custom"
            >
                <h2 v-if="section.title.length">
                    <LegalRichText :inline="section.title" />
                </h2>
                <LegalRichText :blocks="section.blocks" />
            </section>
            <template v-else-if="section.key === 'controller'">
                <section data-testid="privacy-controller">
                    <h2>{{ $t('legal.privacyPage.controllerTitle') }}</h2>
                    <p v-if="controller?.name" class="font-medium">
                        {{ controller.name }}
                    </p>
                    <p v-if="controller?.legal_address" class="multiline">
                        {{ controller.legal_address }}
                    </p>
                    <p v-if="controller?.contact_email">
                        <a :href="`mailto:${controller.contact_email}`">{{
                            controller.contact_email
                        }}</a>
                    </p>
                    <p>
                        <NuxtLink :to="imprintPath">{{
                            $t('legal.imprint')
                        }}</NuxtLink>
                    </p>
                </section>
                <slot />
            </template>
            <LegalContactDetails
                v-else-if="section.key === 'contact'"
                :source="controller"
            />
            <section
                v-else-if="section.key === 'storage'"
                data-testid="privacy-storage"
            >
                <h2>{{ $t('legal.privacyPage.storage.title') }}</h2>
                <p class="mb-3">{{ $t('legal.privacyPage.storage.body') }}</p>
                <div class="table-scroll">
                    <table class="storage-table w-full text-sm">
                        <thead>
                            <tr>
                                <th>{{ $t('legal.storage.name') }}</th>
                                <th>{{ $t('legal.storage.type') }}</th>
                                <th>{{ $t('legal.storage.purpose') }}</th>
                                <th>{{ $t('legal.storage.duration') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="entry in CLIENT_STORAGE"
                                :key="entry.name"
                                data-testid="privacy-storage-row"
                            >
                                <td class="whitespace-nowrap">
                                    <code>{{ entry.name }}</code>
                                </td>
                                <td>
                                    {{
                                        $t(`legal.storage.kinds.${entry.kind}`)
                                    }}
                                </td>
                                <td>
                                    {{
                                        $t(
                                            `legal.storage.purposes.${entry.purpose}`,
                                        )
                                    }}
                                </td>
                                <td class="whitespace-nowrap">
                                    {{
                                        $t(
                                            `legal.storage.durations.${entry.duration}`,
                                        )
                                    }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            <section
                v-else-if="section.key === 'rights'"
                data-testid="privacy-rights"
            >
                <h2>{{ $t('legal.privacyPage.rights.title') }}</h2>
                <p>{{ $t('legal.privacyPage.rights.body') }}</p>
                <ul class="rights-list">
                    <li v-for="right in PRIVACY_RIGHTS" :key="right">
                        {{ $t(`legal.privacyPage.rights.items.${right}`) }}
                    </li>
                </ul>
                <p>{{ $t('legal.privacyPage.rights.complaint') }}</p>
            </section>
            <section v-else :data-testid="`privacy-${section.key}`">
                <h2>{{ $t(`legal.privacyPage.${section.key}.title`) }}</h2>
                <p>
                    {{
                        $t(`legal.privacyPage.${section.key}.body`, {
                            auditDays: auditRetentionDays,
                        })
                    }}
                </p>
            </section>
        </template>
    </div>
</template>

<script setup lang="ts">
import { CLIENT_STORAGE } from '~/utils/clientStorage'
import type { LegalFields } from '~/types/models'
import {
    isPrivacyBlockKey,
    privacyDocOrDefault,
} from '#shared/utils/privacyDoc'
import { privacySections } from '~/utils/legalRichText'
import { PRIVACY_RIGHTS, privacyBlockTitleKey } from '~/utils/privacyEditor'

const props = defineProps<{
    controller?: (LegalFields & { name?: string }) | null
    imprintPath: string
    auditRetentionDays: number
}>()

const { t } = useI18n()

const mentionLabel = (id: string) =>
    isPrivacyBlockKey(id) ? t(privacyBlockTitleKey(id)) : id

const vars = computed(() => ({
    gym: props.controller?.name,
    address: props.controller?.legal_address,
    email: props.controller?.contact_email,
    phone: props.controller?.legal_phone,
    auditDays: props.auditRetentionDays,
}))

const sections = computed(() =>
    privacySections(
        privacyDocOrDefault(props.controller?.privacy_doc),
        vars.value,
        mentionLabel,
    ),
)
</script>

<style scoped>
.table-scroll {
    overflow-x: auto;
}

.storage-table th,
.storage-table td {
    padding: 6px 12px;
    text-align: start;
    border-bottom: 1px solid var(--ui-border);
}

.storage-table th {
    font-weight: 500;
    color: var(--ui-text-muted);
}

.rights-list {
    margin: 8px 0;
}
</style>
