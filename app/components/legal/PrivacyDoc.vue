<template>
    <div class="surface-card legal-doc">
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
                <NuxtLink :to="imprintPath">{{ $t('legal.imprint') }}</NuxtLink>
            </p>
        </section>

        <slot />

        <section
            v-for="section in textSections"
            :key="section"
            :data-testid="`privacy-${section}`"
        >
            <h2>{{ $t(`legal.privacyPage.${section}.title`) }}</h2>
            <p>
                {{
                    $t(`legal.privacyPage.${section}.body`, {
                        auditDays: auditRetentionDays,
                    })
                }}
            </p>
        </section>

        <section data-testid="privacy-storage">
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
                                {{ $t(`legal.storage.kinds.${entry.kind}`) }}
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

        <section data-testid="privacy-rights">
            <h2>{{ $t('legal.privacyPage.rights.title') }}</h2>
            <p>{{ $t('legal.privacyPage.rights.body') }}</p>
            <ul class="rights-list">
                <li v-for="right in rights" :key="right">
                    {{ $t(`legal.privacyPage.rights.items.${right}`) }}
                </li>
            </ul>
            <p>{{ $t('legal.privacyPage.rights.complaint') }}</p>
        </section>
    </div>
</template>

<script setup lang="ts">
import { CLIENT_STORAGE } from '~/utils/clientStorage'

defineProps<{
    controller?: {
        name?: string
        legal_address?: string | null
        contact_email?: string | null
    } | null
    imprintPath: string
    auditRetentionDays: number
}>()

const textSections = [
    'serverLogs',
    'accounts',
    'ratings',
    'reports',
    'defects',
    'auditLog',
    'captcha',
    'push',
    'thirdParties',
]

const rights = [
    'access',
    'rectification',
    'erasure',
    'restriction',
    'portability',
    'objection',
    'withdrawal',
]
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
    margin: 8px 0 8px 20px;
}
</style>
