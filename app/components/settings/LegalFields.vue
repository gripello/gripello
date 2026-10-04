<template>
    <UFormField :label="$t('settings.legalAddress')" :ui="fieldUi">
        <UTextarea
            v-model="legal.legal_address"
            :placeholder="$t('settings.legalAddressPlaceholder')"
            :rows="3"
            autoresize
            icon="i-lucide-map-pin"
            class="w-full"
            :data-testid="`${testIdPrefix}-legal-address`"
        />
    </UFormField>
    <UFormField :label="$t('settings.legalPhone')" :ui="fieldUi">
        <UInput
            v-model="legal.legal_phone"
            type="tel"
            icon="i-lucide-phone"
            class="w-full"
            :data-testid="`${testIdPrefix}-legal-phone`"
        />
    </UFormField>
    <UFormField :label="$t('settings.legalRegister')" :ui="fieldUi">
        <UInput
            v-model="legal.legal_register"
            :placeholder="$t('settings.legalRegisterPlaceholder')"
            icon="i-lucide-file-badge"
            class="w-full"
            :data-testid="`${testIdPrefix}-legal-register`"
        />
    </UFormField>
    <UFormField :label="$t('settings.legalVatId')" :ui="fieldUi">
        <UInput
            v-model="legal.legal_vat_id"
            placeholder="DE123456789"
            icon="i-lucide-receipt"
            class="w-full"
            :data-testid="`${testIdPrefix}-legal-vat-id`"
        />
    </UFormField>
    <UFormField
        :label="$t('settings.legalEditorial')"
        :help="$t('settings.legalEditorialHint')"
        :ui="fieldUi"
    >
        <UInput
            v-model="legal.legal_editorial"
            icon="i-lucide-pencil"
            class="w-full"
            :data-testid="`${testIdPrefix}-legal-editorial`"
        />
    </UFormField>
    <UFormField
        :label="$t('settings.legalRepresentatives')"
        :ui="fieldUi"
        class="lg:col-span-2"
    >
        <div class="person-list">
            <div
                v-for="(person, index) in legal.legal_representatives"
                :key="index"
                class="person-row"
                :data-testid="`${testIdPrefix}-legal-representative`"
            >
                <UFormField :label="$t('settings.legalPersonName')">
                    <UInput
                        v-model="person.name"
                        icon="i-lucide-user"
                        class="w-full"
                        :data-testid="`${testIdPrefix}-legal-representative-name`"
                    />
                </UFormField>
                <UFormField :label="$t('settings.legalPersonRole')">
                    <UInput
                        v-model="person.role"
                        :placeholder="$t('settings.legalPersonRolePlaceholder')"
                        icon="i-lucide-id-card"
                        class="w-full"
                        :data-testid="`${testIdPrefix}-legal-representative-role`"
                    />
                </UFormField>
                <UButton
                    icon="i-lucide-trash-2"
                    variant="ghost"
                    color="error"
                    class="self-end"
                    :aria-label="$t('settings.legalRemovePerson')"
                    :title="$t('settings.legalRemovePerson')"
                    :data-testid="`${testIdPrefix}-legal-remove-representative`"
                    @click="legal.legal_representatives.splice(index, 1)"
                />
            </div>
        </div>
        <UButton
            color="neutral"
            variant="soft"
            size="sm"
            icon="i-lucide-user-plus"
            :class="{ 'mt-3': legal.legal_representatives.length }"
            :data-testid="`${testIdPrefix}-legal-add-representative`"
            @click="legal.legal_representatives.push({ name: '', role: '' })"
        >
            {{ $t('settings.legalAddPerson') }}
        </UButton>
    </UFormField>
</template>

<script setup lang="ts">
import type { LegalFieldsState } from '~/utils/legalFields'

withDefaults(
    defineProps<{ legal: LegalFieldsState; testIdPrefix?: string }>(),
    { testIdPrefix: 'settings' },
)

const fieldUi = { container: 'w-full' }
</script>

<style scoped>
@reference "~/assets/css/main.css";

.person-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.person-row {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 12px;
    align-items: center;
}

@variant max-sm {
    .person-list {
        gap: 24px;
    }

    .person-row {
        grid-template-columns: 1fr auto;
    }

    .person-row > :nth-child(2) {
        grid-row: 2;
    }
}
</style>
