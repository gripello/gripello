<template>
    <div class="flex flex-col gap-4">
        <LayoutPanel
            id="settings-contacts"
            :title="$t('gymInfo.settings.contactList')"
            icon="i-lucide-contact-round"
            flush
        >
            <UFormField
                name="contacts"
                :error-pattern="/^(contacts|contact_email|legal_phone)$/"
                :ui="{ error: 'px-4 pb-3' }"
            >
                <AdminGymContactsEditor
                    v-model="form.contacts"
                    v-model:email="form.contact_email"
                    v-model:phone="form.legal_phone"
                />
            </UFormField>
        </LayoutPanel>
        <LayoutPanel
            id="settings-reports"
            :title="$t('gymInfo.settings.reports')"
            icon="i-lucide-flag"
        >
            <div :class="SETTINGS_FIELDS_GRID">
                <UFormField
                    :label="$t('gymInfo.settings.reportEmail')"
                    name="report_email"
                    :ui="SETTINGS_FIELD_UI"
                >
                    <UInput
                        v-model="form.report_email"
                        type="email"
                        icon="i-lucide-mail"
                        class="w-full"
                        data-testid="settings-report-email"
                    />
                </UFormField>
            </div>
        </LayoutPanel>
    </div>
</template>

<script setup lang="ts">
import type { GymSettingsDraft } from '~/utils/gymSettingsDraft'
import { SETTINGS_FIELD_UI, SETTINGS_FIELDS_GRID } from '~/utils/settingsUi'

defineProps<{ form: GymSettingsDraft }>()
</script>
