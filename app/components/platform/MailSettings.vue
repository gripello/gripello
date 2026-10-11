<template>
    <UPageCard
        :title="t('platform.settings.mail.title')"
        variant="outline"
        :ui="SETTINGS_CARD_UI"
        data-testid="platform-mail-settings"
    >
        <template #description>
            <div class="flex flex-wrap gap-2">
                <UBadge
                    v-if="settings?.source === 'environment'"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-server"
                    data-testid="platform-mail-source-environment"
                >
                    {{ t('platform.settings.mail.fromEnvironment') }}
                </UBadge>
                <UBadge
                    v-else-if="settings?.source === 'none'"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-mail-x"
                    data-testid="platform-mail-source-none"
                >
                    {{ t('platform.settings.mail.notConfigured') }}
                </UBadge>
            </div>
        </template>

        <LayoutEmptyState
            v-if="error"
            variant="error"
            :title="t('errors.loadFailed')"
        />
        <UForm
            v-else
            ref="mailForm"
            :state="form"
            :validate="validate"
            class="flex flex-col gap-4"
            @submit="askPassword"
        >
            <UFormField
                :label="t('platform.settings.mail.host')"
                name="smtp_host"
                :ui="SETTINGS_FIELD_UI"
            >
                <UInput
                    v-model="form.smtp_host"
                    placeholder="smtp.example.com"
                    autocomplete="off"
                    class="w-full"
                    data-testid="platform-mail-host"
                />
            </UFormField>
            <UFormField
                :label="t('platform.settings.mail.port')"
                name="smtp_port"
                :ui="SETTINGS_FIELD_UI"
            >
                <UInputNumber
                    v-model="form.smtp_port"
                    :min="1"
                    :max="65535"
                    class="w-full"
                    data-testid="platform-mail-port"
                    @update:model-value="
                        (port) => (form.smtp_tls = implicitTlsPort(port))
                    "
                />
            </UFormField>
            <UFormField
                :label="t('platform.settings.mail.tls')"
                name="smtp_tls"
                :ui="SETTINGS_FIELD_UI"
            >
                <SegmentedControl
                    :model-value="form.smtp_tls ? 'tls' : 'starttls'"
                    :items="encryptionItems"
                    size="sm"
                    test-id="platform-mail-tls"
                    @update:model-value="setEncryption"
                />
            </UFormField>
            <UFormField
                :label="t('platform.settings.mail.username')"
                name="smtp_username"
                :ui="SETTINGS_FIELD_UI"
            >
                <UInput
                    v-model="form.smtp_username"
                    autocomplete="off"
                    class="w-full"
                    data-testid="platform-mail-username"
                />
            </UFormField>
            <UFormField
                :label="t('platform.settings.mail.password')"
                name="smtp_password"
                :ui="SETTINGS_FIELD_UI"
            >
                <div class="flex w-full items-center gap-2">
                    <UInput
                        v-model="form.smtp_password"
                        type="password"
                        autocomplete="new-password"
                        :placeholder="
                            passwordKept
                                ? t('platform.settings.mail.passwordSet')
                                : ''
                        "
                        class="w-full"
                        data-testid="platform-mail-password"
                    />
                    <UButton
                        v-if="passwordKept"
                        color="error"
                        variant="ghost"
                        icon="i-lucide-x"
                        class="icon-btn"
                        :aria-label="t('platform.settings.mail.clearPassword')"
                        data-testid="platform-mail-password-clear"
                        @click="form.clearPassword = true"
                    />
                </div>
            </UFormField>
            <UFormField
                :label="t('platform.settings.mail.senderAddress')"
                name="sender_address"
                :ui="SETTINGS_FIELD_UI"
            >
                <UInput
                    v-model="form.sender_address"
                    type="email"
                    placeholder="no-reply@example.com"
                    class="w-full"
                    data-testid="platform-mail-sender-address"
                />
            </UFormField>
            <UFormField
                :label="t('platform.settings.mail.senderName')"
                name="sender_name"
                :ui="SETTINGS_FIELD_UI"
            >
                <UInput
                    v-model="form.sender_name"
                    class="w-full"
                    data-testid="platform-mail-sender-name"
                />
            </UFormField>
            <div
                class="flex flex-col gap-3 rounded-lg bg-elevated/50 p-4 ring ring-default lg:col-span-2"
                data-testid="platform-mail-check"
            >
                <div class="flex flex-wrap items-center gap-3">
                    <span class="flex-1 font-medium text-highlighted">
                        {{ t('platform.settings.mail.check') }}
                    </span>
                    <UButton
                        color="primary"
                        icon="i-lucide-send"
                        :loading="testing"
                        :disabled="settings?.source === 'none' || hasChanges"
                        data-testid="platform-mail-test"
                        @click="sendTest"
                    >
                        {{ t('platform.settings.mail.sendTest') }}
                    </UButton>
                </div>
                <ul class="flex flex-col gap-1.5 text-sm">
                    <li
                        v-for="step in checkSteps"
                        :key="step.stage"
                        class="flex items-start gap-2"
                        :data-testid="`platform-mail-check-${step.stage}`"
                        :data-state="step.state"
                    >
                        <UIcon
                            :name="STEP_ICONS[step.state]"
                            class="mt-0.5 size-4 shrink-0"
                            :class="STEP_COLORS[step.state]"
                        />
                        <span class="flex-1">
                            {{
                                t(`platform.settings.mail.steps.${step.stage}`)
                            }}
                        </span>
                        <span
                            v-if="step.message"
                            class="max-w-[60%] break-all text-right font-mono text-xs text-error"
                        >
                            {{ step.message }}
                        </span>
                    </li>
                </ul>
            </div>
        </UForm>

        <ConfirmDialog
            v-model="confirmOpen"
            :title="t('platform.settings.mail.title')"
            :message="t('platform.settings.mail.confirm')"
            :confirm-text="t('actions.save')"
            confirm-color="primary"
            :loading="saving"
            @confirm="save"
        >
            <UserPasswordField
                v-model="adminPassword"
                :label="t('platform.users.adminPassword')"
                icon="i-lucide-shield-check"
                class="mt-3"
                data-testid="platform-mail-admin-password"
            />
        </ConfirmDialog>
    </UPageCard>
</template>

<script setup lang="ts">
import type { Form } from '@nuxt/ui'
import { reauthenticate } from '~/api/account'
import {
    getMailSettings,
    sendTestMail,
    updateMailSettings,
    type MailSettings,
} from '~/api/platform'
import {
    CLIENT_ONLY,
    implicitTlsPort,
    mailSettingsPayload,
    smtpCheckSteps,
    smtpFailure,
    type SmtpCheck,
} from '~/utils/platformMail'
import { isWrongPassword } from '~/utils/reauth'
import { SETTINGS_CARD_UI, SETTINGS_FIELD_UI } from '~/utils/settingsUi'
import { validEmail, validateRules } from '~/utils/validation'

const { t } = useI18n()
const { success: notifySuccess, error: notifyError } = useNotification()

const {
    data: settings,
    error,
    refresh,
} = useAsyncData('platform-mail', getMailSettings, CLIENT_ONLY)

function formFrom(rec: MailSettings | null | undefined) {
    return {
        smtp_host: rec?.source === 'database' ? rec.smtp_host : '',
        smtp_port: rec?.source === 'database' ? rec.smtp_port : 587,
        smtp_username: rec?.source === 'database' ? rec.smtp_username : '',
        smtp_password: '',
        clearPassword: false,
        smtp_tls: rec?.source === 'database' ? rec.smtp_tls : false,
        sender_address: rec?.source === 'database' ? rec.sender_address : '',
        sender_name: rec?.source === 'database' ? rec.sender_name : '',
    }
}

const form = reactive(formFrom(settings.value))
const mailForm = ref<Form<typeof form> | null>(null)
watch(settings, (rec) => {
    Object.assign(form, formFrom(rec))
    check.value = null
})

const passwordKept = computed(
    () =>
        settings.value?.source === 'database' &&
        settings.value.smtp_password_set &&
        !form.clearPassword &&
        !form.smtp_password,
)

const hasChanges = computed(
    () => JSON.stringify(form) !== JSON.stringify(formFrom(settings.value)),
)

function validate(state: typeof form) {
    if (!state.smtp_host.trim()) return []
    return validateRules(state, {
        sender_address: [validEmail(t)],
    })
}

const confirmOpen = ref(false)
const adminPassword = ref('')

function askPassword() {
    adminPassword.value = ''
    confirmOpen.value = true
}

const { pending: saving, run: runSave } = useAsyncAction()

async function save() {
    await runSave(
        async () => {
            await reauthenticate(adminPassword.value)
            settings.value = await updateMailSettings(mailSettingsPayload(form))
            confirmOpen.value = false
        },
        {
            success: t('settings.saveSuccess'),
            error: (err) =>
                isWrongPassword(err)
                    ? t('platform.users.adminPasswordWrong')
                    : t('settings.saveError'),
        },
    )
}

const testing = ref(false)
const check = ref<SmtpCheck | null>(null)
const checkSteps = computed(() => smtpCheckSteps(check.value))
const STEP_ICONS = {
    idle: 'i-lucide-circle',
    ok: 'i-lucide-circle-check',
    failed: 'i-lucide-circle-x',
    skipped: 'i-lucide-circle-dashed',
} as const
const STEP_COLORS = {
    idle: 'text-dimmed',
    ok: 'text-success',
    failed: 'text-error',
    skipped: 'text-dimmed',
} as const

async function sendTest() {
    testing.value = true
    try {
        await sendTestMail()
        check.value = { ok: true }
        notifySuccess(t('platform.settings.mail.testSent'))
    } catch (err) {
        check.value = smtpFailure(err)
        if (!check.value) {
            notifyError(
                (err as Error).message || t('notifications.error.generic'),
            )
        }
    } finally {
        testing.value = false
    }
}

const encryptionItems = [
    { value: 'starttls' as const, label: 'STARTTLS' },
    { value: 'tls' as const, label: 'TLS (SMTPS)' },
]

function setEncryption(mode: 'starttls' | 'tls') {
    form.smtp_tls = mode === 'tls'
    if (form.smtp_tls && form.smtp_port === 587) form.smtp_port = 465
    if (!form.smtp_tls && form.smtp_port === 465) form.smtp_port = 587
}

function reset() {
    Object.assign(form, formFrom(settings.value))
}

defineExpose({
    submit: () => mailForm.value?.submit(),
    reset,
    refresh,
    hasChanges,
    saving,
})
</script>
