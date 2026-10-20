<template>
    <div class="w-full p-4">
        <LayoutPageHeader :title="t('platform.settings.title')" />

        <PlatformSettingsStatus
            v-if="!error"
            :class="{ 'max-lg:hidden': route.query.section }"
            :allow-registration="!!settings?.allow_registration"
        />

        <LayoutEmptyState
            v-if="error"
            variant="error"
            :title="t('errors.loadFailed')"
        >
            <template #actions>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-refresh-cw"
                    @click="refresh()"
                >
                    {{ t('errors.retry') }}
                </UButton>
            </template>
        </LayoutEmptyState>

        <SettingsLayout
            v-else
            v-slot="{ activeSection }"
            :sections="sections"
            drill-down
            :has-changes="
                EDITOR_SECTIONS.includes(activeSection)
                    ? !!sectionEditor(activeSection)?.hasChanges
                    : activeSection !== 'signIn' && hasChanges
            "
            :saving="
                EDITOR_SECTIONS.includes(activeSection)
                    ? !!sectionEditor(activeSection)?.saving
                    : saving
            "
            test-id-prefix="platform-settings"
            @save="
                EDITOR_SECTIONS.includes(activeSection)
                    ? sectionEditor(activeSection)?.submit()
                    : settingsForm?.submit()
            "
            @cancel="
                EDITOR_SECTIONS.includes(activeSection)
                    ? sectionEditor(activeSection)?.reset()
                    : resetForm()
            "
        >
            <PlatformMailSettings
                v-if="activeSection === 'mail'"
                ref="mailSettings"
            />
            <PlatformBlocklistSettings
                v-else-if="activeSection === 'blocklists'"
                ref="blocklistSettings"
            />
            <PlatformOAuthSettings v-else-if="activeSection === 'signIn'" />
            <UForm
                v-else
                ref="settingsForm"
                :state="form"
                :validate="validateSettings"
                class="flex flex-col gap-6"
                data-testid="platform-settings-form"
                @submit="saveSettings"
            >
                <UPageCard
                    v-if="activeSection === 'access'"
                    :title="t('platform.settings.access')"
                    variant="outline"
                    :ui="formCardUi"
                >
                    <UFormField
                        :label="t('platform.settings.allowRegistration')"
                        name="allow_registration"
                        :ui="fieldUi"
                    >
                        <USwitch
                            v-model="form.allow_registration"
                            data-testid="platform-settings-allow-registration"
                        />
                    </UFormField>
                    <UFormField
                        :label="t('platform.settings.auditRetentionDays')"
                        name="audit_retention_days"
                        :ui="fieldUi"
                    >
                        <UInputNumber
                            v-model="form.audit_retention_days"
                            :min="1"
                            :max="3650"
                            class="w-full"
                            data-testid="platform-settings-audit-retention"
                        />
                    </UFormField>
                </UPageCard>

                <UPageCard
                    v-if="activeSection === 'links'"
                    :title="t('platform.settings.links')"
                    variant="outline"
                    :ui="formCardUi"
                >
                    <UFormField
                        :label="t('settings.contactEmail')"
                        name="contact_email"
                        :ui="fieldUi"
                    >
                        <UInput
                            v-model="form.contact_email"
                            type="email"
                            icon="i-lucide-mail"
                            class="w-full"
                            data-testid="platform-settings-contact-email"
                        />
                    </UFormField>
                    <UFormField
                        :label="t('settings.imprintUrl')"
                        name="imprint_url"
                        :ui="fieldUi"
                    >
                        <UInput
                            v-model="form.imprint_url"
                            type="url"
                            icon="i-lucide-file-text"
                            placeholder="https://example.com/imprint"
                            class="w-full"
                            data-testid="platform-settings-imprint-url"
                        />
                    </UFormField>
                    <UFormField
                        :label="t('settings.privacyUrl')"
                        name="privacy_url"
                        :ui="fieldUi"
                    >
                        <UInput
                            v-model="form.privacy_url"
                            type="url"
                            icon="i-lucide-shield"
                            placeholder="https://example.com/privacy"
                            class="w-full"
                            data-testid="platform-settings-privacy-url"
                        />
                    </UFormField>
                </UPageCard>

                <UPageCard
                    v-if="activeSection === 'legal'"
                    :title="t('settings.legalTitle')"
                    variant="outline"
                    :ui="formCardUi"
                >
                    <UFormField
                        :label="t('settings.legalName')"
                        name="legal_name"
                        :ui="fieldUi"
                    >
                        <UInput
                            v-model="form.legal_name"
                            icon="i-lucide-building-2"
                            class="w-full"
                            data-testid="platform-settings-legal-name"
                        />
                    </UFormField>
                    <SettingsLegalFields
                        :legal="form"
                        test-id-prefix="platform-settings"
                    />
                </UPageCard>

                <UPageCard
                    v-if="activeSection === 'privacy'"
                    :title="t('settings.privacy.title')"
                    variant="outline"
                    :ui="formCardUi"
                >
                    <UFormField
                        name="privacy_doc"
                        class="w-full min-w-0 lg:col-span-2"
                    >
                        <SettingsPrivacyEditor
                            v-model:doc="form.privacy_doc"
                            :controller="{ ...form, name: form.legal_name }"
                            imprint-path="/imprint"
                            test-id-prefix="platform-settings"
                        />
                    </UFormField>
                </UPageCard>
            </UForm>
        </SettingsLayout>
    </div>
</template>

<script setup lang="ts">
import { updateSettings } from '~/api/gyms'
import type { Form } from '@nuxt/ui'
import type { SettingsRecord } from '~/types/models'
import { privacyDocProblem } from '~/utils/privacyEditor'
import { type RichTextDoc } from '#shared/utils/privacyDoc'
import { requestedSection } from '~/utils/navigation'
import { SETTINGS_CARD_UI, SETTINGS_FIELD_UI } from '~/utils/settingsUi'
import { integerBetween, validEmail, validateRules } from '~/utils/validation'

definePageMeta({ middleware: ['auth'], platformAdmin: true })

const { t } = useI18n()

useHead({ title: () => t('platform.settings.title') })

const { data: settings, error, refresh } = await useSettingsRecord()

function formFrom(rec: SettingsRecord | null | undefined) {
    return {
        allow_registration: !!rec?.allow_registration,
        audit_retention_days: rec?.audit_retention_days ?? 90,
        contact_email: rec?.contact_email ?? '',
        imprint_url: rec?.imprint_url ?? '',
        privacy_url: rec?.privacy_url ?? '',
        legal_name: rec?.legal_name ?? '',
        ...legalFieldsFrom(rec ?? {}),
    }
}

type SettingsForm = ReturnType<typeof formFrom>

const form = reactive(formFrom(settings.value))
const settingsForm = ref<Form<SettingsForm> | null>(null)
const hasChanges = computed(
    () => JSON.stringify(form) !== JSON.stringify(formFrom(settings.value)),
)

const sections = computed(() => [
    {
        id: 'access',
        label: t('platform.settings.access'),
        icon: 'i-lucide-key-round',
    },
    { id: 'links', label: t('platform.settings.links'), icon: 'i-lucide-link' },
    { id: 'legal', label: t('settings.legalTitle'), icon: 'i-lucide-scale' },
    {
        id: 'privacy',
        label: t('settings.privacy.title'),
        icon: 'i-lucide-shield-user',
    },
    {
        id: 'blocklists',
        label: t('platform.settings.blocklists.title'),
        icon: 'i-lucide-ban',
    },
    {
        id: 'mail',
        label: t('platform.settings.mail.title'),
        icon: 'i-lucide-mail',
    },
    {
        id: 'signIn',
        label: t('platform.settings.oauth2.title'),
        icon: 'i-lucide-log-in',
    },
])

const route = useRoute()
const activeSection = computed(() =>
    requestedSection(
        route.query.section,
        sections.value.map((section) => section.id),
    ),
)
type SectionEditor = {
    submit: () => void
    reset: () => void
    hasChanges: boolean
    saving: boolean
}
const mailSettings = ref<SectionEditor | null>(null)
const blocklistSettings = ref<SectionEditor | null>(null)
const EDITOR_SECTIONS = ['mail', 'blocklists']

function sectionEditor(section: string) {
    if (section === 'mail') return mailSettings.value
    if (section === 'blocklists') return blocklistSettings.value
    return null
}

const fieldUi = SETTINGS_FIELD_UI
const formCardUi = SETTINGS_CARD_UI

function validateSettings(state: SettingsForm) {
    return validateRules(state, {
        audit_retention_days: [integerBetween(t, 1, 3650)],
        contact_email: [(email) => !email || validEmail(t)(email)],
        privacy_doc: [
            (doc) => privacyDocProblem(doc as RichTextDoc, t) || true,
        ],
    })
}

function resetForm() {
    Object.assign(form, formFrom(settings.value))
}

watch(settings, (rec, previous) => {
    if (JSON.stringify(form) === JSON.stringify(formFrom(previous)))
        Object.assign(form, formFrom(rec))
})

const { pending: saving, run: runSave } = useAsyncAction()

async function saveSettings() {
    await runSave(
        async () => {
            settings.value = await updateSettings({
                ...form,
                contact_email: form.contact_email.trim(),
                imprint_url: form.imprint_url.trim(),
                privacy_url: form.privacy_url.trim(),
                legal_name: form.legal_name.trim(),
                ...legalPayload(form),
            })
            resetForm()
        },
        {
            success: t('settings.saveSuccess'),
            error: t('settings.saveError'),
        },
    )
}
</script>
