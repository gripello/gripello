<template>
    <section class="flex flex-col">
        <LayoutEyebrow>{{ t('account.twoFactor.title') }}</LayoutEyebrow>
        <LayoutEmptyState
            v-if="loadError"
            variant="error"
            :title="t('errors.loadFailed')"
            data-testid="two-factor-load-error"
        >
            <template #actions>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-refresh-cw"
                    @click="load"
                >
                    {{ t('errors.retry') }}
                </UButton>
            </template>
        </LayoutEmptyState>
        <LayoutLoadingState v-else-if="!loaded" :count="2" />
        <UPageCard
            v-else
            variant="outline"
            :ui="{ container: LIST }"
            data-testid="two-factor-settings"
        >
            <div v-if="totp" class="factor-row">
                <span class="factor-icon bg-primary/10 text-primary">
                    <UIcon name="i-lucide-smartphone" class="size-4" />
                </span>
                <UInput
                    v-model="drafts[totp.id]"
                    :placeholder="t('account.twoFactor.authenticatorApp')"
                    :aria-label="t('account.twoFactor.name')"
                    maxlength="60"
                    size="sm"
                    :data-testid="`two-factor-name-${totp.id}`"
                />
                <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-x"
                    class="icon-btn"
                    :aria-label="t('account.twoFactor.removeAuthenticator')"
                    data-testid="two-factor-totp-remove"
                    @click="askPassword({ kind: 'remove', factor: totp })"
                />
                <p class="col-start-2 truncate text-xs text-muted">
                    {{ usedLabel(totp) }}
                </p>
            </div>
            <div v-else class="flex items-center gap-3 py-1 ps-4 pe-1">
                <span class="factor-icon bg-elevated text-muted">
                    <UIcon name="i-lucide-smartphone" class="size-4" />
                </span>
                <span
                    class="flex-1 truncate py-2 text-sm font-medium text-highlighted"
                >
                    {{ t('account.twoFactor.authenticatorApp') }}
                </span>
                <UButton
                    color="primary"
                    variant="soft"
                    class="me-3"
                    :loading="setup.pending.value"
                    data-testid="two-factor-totp-setup"
                    @click="askPassword({ kind: 'totp' })"
                >
                    {{ t('account.twoFactor.setUp') }}
                </UButton>
            </div>

            <div
                v-for="passkey in passkeys"
                :key="passkey.id"
                class="factor-row"
                data-testid="two-factor-passkey"
            >
                <span class="factor-icon bg-primary/10 text-primary">
                    <UIcon name="i-lucide-key-round" class="size-4" />
                </span>
                <UInput
                    v-model="drafts[passkey.id]"
                    :placeholder="t('account.twoFactor.passkey')"
                    :aria-label="t('account.twoFactor.name')"
                    maxlength="60"
                    size="sm"
                    :data-testid="`two-factor-name-${passkey.id}`"
                />
                <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-x"
                    class="icon-btn"
                    :aria-label="
                        t('account.twoFactor.removePasskey', {
                            name: passkey.name,
                        })
                    "
                    data-testid="two-factor-passkey-remove"
                    @click="askPassword({ kind: 'remove', factor: passkey })"
                />
                <p class="col-start-2 truncate text-xs text-muted">
                    {{ usedLabel(passkey) }}
                </p>
            </div>

            <div
                v-if="canAddPasskey"
                class="flex items-center gap-3 py-1 ps-4 pe-1"
            >
                <span class="factor-icon bg-elevated text-muted">
                    <UIcon name="i-lucide-key-round" class="size-4" />
                </span>
                <span class="flex-1 py-2 text-sm font-medium text-highlighted">
                    {{ t('account.twoFactor.passkeys') }}
                </span>
                <UButton
                    color="primary"
                    variant="soft"
                    class="me-3"
                    :loading="addPasskey.pending.value"
                    data-testid="two-factor-passkey-add"
                    @click="askPassword({ kind: 'passkey' })"
                >
                    {{ t('account.twoFactor.addPasskey') }}
                </UButton>
            </div>

            <div
                v-if="factors.length"
                class="flex items-center gap-3 py-1 ps-4 pe-1"
            >
                <span class="factor-icon" :class="iconTone(codesLeft > 0)">
                    <UIcon name="i-lucide-life-buoy" class="size-4" />
                </span>
                <div class="min-w-0 flex-1 py-2">
                    <p class="text-sm font-medium text-highlighted">
                        {{ t('account.twoFactor.recoveryCodes') }}
                    </p>
                    <p
                        class="text-xs"
                        :class="codesLeft < 3 ? 'text-warning' : 'text-muted'"
                        data-testid="two-factor-codes-left"
                    >
                        {{
                            t(
                                'account.twoFactor.codesLeft',
                                { n: codesLeft },
                                codesLeft,
                            )
                        }}
                    </p>
                </div>
                <UButton
                    color="neutral"
                    variant="soft"
                    class="me-3"
                    data-testid="two-factor-codes-regenerate"
                    @click="askPassword({ kind: 'codes' })"
                >
                    {{ t('account.twoFactor.renewCodes') }}
                </UButton>
            </div>
        </UPageCard>

        <LayoutDialogShell
            v-model="setupOpen"
            :title="t('account.twoFactor.authenticatorApp')"
            :max-width="420"
            data-testid="two-factor-setup-dialog"
        >
            <UForm
                id="totp-setup-form"
                :state="{ code: setupCode }"
                class="flex flex-col items-center gap-4"
                @submit="confirmTotp"
            >
                <img
                    v-if="qrDataUrl"
                    :src="qrDataUrl"
                    :alt="t('account.twoFactor.qrAlt')"
                    class="size-48 rounded-lg bg-white p-2"
                />
                <code
                    class="w-full break-all rounded-md bg-elevated px-3 py-2 text-center font-mono text-sm select-all"
                    data-testid="two-factor-secret"
                >
                    {{ formattedSecret }}
                </code>
                <UFormField
                    :label="t('account.twoFactor.code')"
                    name="code"
                    class="w-full"
                >
                    <UPinInput
                        :model-value="setupDigits"
                        type="number"
                        otp
                        :length="OTP_LENGTH"
                        size="lg"
                        class="w-full justify-between"
                        data-testid="two-factor-setup-code"
                        @update:model-value="setupCode = otpCode($event)"
                        @complete="confirmTotp"
                    />
                </UFormField>
            </UForm>
            <template #actions>
                <UButton
                    color="neutral"
                    variant="ghost"
                    @click="setupOpen = false"
                >
                    {{ t('actions.cancel') }}
                </UButton>
                <div class="flex-1" />
                <UButton
                    type="submit"
                    form="totp-setup-form"
                    color="primary"
                    :disabled="setupCode.length !== OTP_LENGTH"
                    :loading="confirmSetup.pending.value"
                    data-testid="two-factor-setup-confirm"
                >
                    {{ t('account.twoFactor.verify') }}
                </UButton>
            </template>
        </LayoutDialogShell>

        <LayoutDialogShell
            :model-value="!!pending"
            :title="passwordTitle"
            :max-width="420"
            data-testid="two-factor-password-dialog"
            @update:model-value="!$event && (pending = undefined)"
        >
            <form
                id="two-factor-password-form"
                @submit.prevent="submitPassword"
            >
                <input
                    type="text"
                    name="username"
                    autocomplete="username"
                    :value="accountName"
                    readonly
                    hidden
                    data-testid="two-factor-username"
                />
                <UserPasswordField
                    v-model="password"
                    :label="t('account.password')"
                    name="password"
                    autocomplete="current-password"
                    autofocus
                    data-testid="two-factor-password"
                />
            </form>
            <template #actions>
                <UButton
                    color="neutral"
                    variant="ghost"
                    data-testid="two-factor-password-cancel"
                    @click="pending = undefined"
                >
                    {{ t('actions.cancel') }}
                </UButton>
                <div class="flex-1" />
                <UButton
                    type="submit"
                    form="two-factor-password-form"
                    :color="pending?.kind === 'remove' ? 'error' : 'primary'"
                    :disabled="!password"
                    :loading="withPassword.pending.value"
                    data-testid="two-factor-password-confirm"
                >
                    {{ passwordAction }}
                </UButton>
            </template>
        </LayoutDialogShell>

        <LayoutDialogShell
            v-model="codesOpen"
            persistent
            :title="t('account.twoFactor.recoveryCodes')"
            :max-width="420"
            data-testid="two-factor-codes-dialog"
        >
            <ul
                class="grid grid-cols-2 gap-2 font-mono text-sm"
                data-testid="two-factor-codes"
            >
                <li
                    v-for="code in recoveryCodes"
                    :key="code"
                    class="rounded-md bg-elevated px-2 py-1 text-center"
                >
                    {{ code }}
                </li>
            </ul>
            <template #actions>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-copy"
                    @click="copyCodes"
                >
                    {{ t('account.twoFactor.copy') }}
                </UButton>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-download"
                    @click="downloadCodes"
                >
                    {{ t('account.twoFactor.download') }}
                </UButton>
                <div class="flex-1" />
                <UButton
                    color="primary"
                    data-testid="two-factor-codes-done"
                    @click="codesOpen = false"
                >
                    {{ t('account.twoFactor.done') }}
                </UButton>
            </template>
        </LayoutDialogShell>
    </section>
</template>

<script setup lang="ts">
import { formatDate } from '#shared/utils/formatting'
import { OTP_LENGTH, otpCode, otpDigits } from '~/utils/otp'
import { deviceLabel } from '~/utils/push'
import {
    createPasskey,
    isPasskeyCancel,
    passkeysSupported,
} from '~/utils/webauthn'

type Factor = {
    id: string
    kind: 'totp' | 'passkey'
    name: string
    created: string
    last_used: string
}
type FactorResult = { factor: Factor; recoveryCodes?: string[] }
type PendingAction =
    | { kind: 'remove'; factor: Factor }
    | { kind: 'codes' }
    | { kind: 'totp' }
    | { kind: 'passkey' }

const LIST = 'min-w-0 p-0 sm:p-0 gap-y-0 divide-y divide-default'

const { t, locale } = useI18n()
const pb = usePocketbase()
const { success, error: notifyError } = useNotification()
const setup = useAsyncAction()
const confirmSetup = useAsyncAction()
const addPasskey = useAsyncAction()
const withPassword = useAsyncAction()

const factors = ref<Factor[]>([])
const codesLeft = ref(0)
const loadError = ref(false)
const loaded = ref(false)
const totp = computed(() => factors.value.find((f) => f.kind === 'totp'))
const passkeys = computed(() =>
    factors.value.filter((f) => f.kind === 'passkey'),
)
const canAddPasskey = ref(false)

async function load() {
    try {
        const result = await pb.send<{
            factors: Factor[]
            recoveryCodesLeft: number
        }>('/api/account/mfa', {})
        factors.value = result.factors
        codesLeft.value = result.recoveryCodesLeft
        loadError.value = false
    } catch {
        loadError.value = true
    } finally {
        loaded.value = true
    }
}

onMounted(() => {
    canAddPasskey.value = passkeysSupported()
    load()
})

function iconTone(active: boolean) {
    return active ? 'bg-primary/10 text-primary' : 'bg-elevated text-muted'
}

function usedLabel(factor: Factor) {
    const date = factor.last_used || factor.created
    const formatted = formatDate(date, {
        locale: locale.value,
        dateStyle: 'medium',
    })
    return factor.last_used
        ? t('account.twoFactor.lastUsed', { date: formatted })
        : t('account.twoFactor.added', { date: formatted })
}

const recoveryCodes = ref<string[]>([])
const codesOpen = ref(false)

function showRecoveryCodes(codes?: string[]) {
    if (!codes?.length) return
    recoveryCodes.value = codes
    codesLeft.value = codes.length
    codesOpen.value = true
}

const setupOpen = ref(false)
const secret = ref('')
const setupCode = ref('')
const qrDataUrl = ref('')
const setupDigits = computed(() => otpDigits(setupCode.value))
const formattedSecret = computed(() =>
    secret.value.replace(/(.{4})/g, '$1 ').trim(),
)

const setupPassword = ref('')
watch(setupOpen, (open) => {
    if (!open) setupPassword.value = ''
})

async function startTotpSetup(confirmedPassword: string) {
    const result = await pb.send<{ secret: string; uri: string }>(
        '/api/account/totp/setup',
        { method: 'POST', body: { password: confirmedPassword } },
    )
    pending.value = undefined
    setupPassword.value = confirmedPassword
    await setup.run(async () => {
        secret.value = result.secret
        setupCode.value = ''
        const { default: QRCode } = await import('qrcode')
        qrDataUrl.value = await QRCode.toDataURL(result.uri, {
            margin: 0,
            width: 192,
        })
        setupOpen.value = true
    })
}

function confirmTotp() {
    if (confirmSetup.pending.value || setupCode.value.length !== OTP_LENGTH)
        return
    return confirmSetup.run(
        async () => {
            const result = await pb.send<FactorResult>('/api/account/totp', {
                method: 'POST',
                body: {
                    secret: secret.value,
                    code: setupCode.value.trim(),
                    password: setupPassword.value,
                },
            })
            factors.value = [...factors.value, result.factor]
            setupOpen.value = false
            setupPassword.value = ''
            showRecoveryCodes(result.recoveryCodes)
        },
        {
            success: t('account.twoFactor.enabled'),
            error: t('account.twoFactor.invalidCode'),
        },
    )
}

async function registerPasskey(confirmedPassword: string) {
    const { ceremony, options } = await pb.send<{
        ceremony: string
        options: unknown
    }>('/api/account/passkeys/options', {
        method: 'POST',
        body: { password: confirmedPassword },
    })
    pending.value = undefined
    await addPasskey.run(
        async () => {
            let credential: unknown
            try {
                credential = await createPasskey(options)
            } catch (err) {
                if (isPasskeyCancel(err)) return
                throw err
            }
            const result = await pb.send<FactorResult>(
                '/api/account/passkeys',
                {
                    method: 'POST',
                    body: {
                        ceremony,
                        credential,
                        name: deviceLabel(navigator.userAgent),
                    },
                },
            )
            factors.value = [...factors.value, result.factor]
            success(t('account.twoFactor.passkeyAdded'))
            showRecoveryCodes(result.recoveryCodes)
        },
        { error: t('account.twoFactor.passkeyFailed') },
    )
}

const password = ref('')
const pending = ref<PendingAction>()
const accountName = computed(
    () => pb.authStore.record?.email || pb.authStore.record?.username || '',
)
const passwordTitle = computed(() => {
    const action = pending.value
    if (!action) return ''
    if (action.kind === 'codes') return t('account.twoFactor.newCodes')
    if (action.kind === 'totp') return t('account.twoFactor.authenticatorApp')
    if (action.kind === 'passkey') return t('account.twoFactor.addPasskey')
    return action.factor.kind === 'totp'
        ? t('account.twoFactor.removeAuthenticator')
        : t('account.twoFactor.removePasskey', { name: action.factor.name })
})
const passwordAction = computed(
    () =>
        ({
            remove: t('actions.delete'),
            codes: t('account.twoFactor.renewCodes'),
            totp: t('account.twoFactor.setUp'),
            passkey: t('account.twoFactor.addPasskey'),
        })[pending.value?.kind ?? 'codes'],
)

function askPassword(action: PendingAction) {
    pending.value = action
    password.value = ''
}

function passwordError(err: unknown) {
    const status = (err as { status?: number })?.status
    if (status === 429) return t('notifications.error.account_locked')
    return status === 400
        ? t('account.wrongOldPassword')
        : t('notifications.error.generic')
}

function submitPassword() {
    const action = pending.value
    if (!action || !password.value) return
    return withPassword.run(
        async () => {
            if (action.kind === 'totp') return startTotpSetup(password.value)
            if (action.kind === 'passkey')
                return registerPasskey(password.value)
            if (action.kind === 'codes') {
                const result = await pb.send<{ recoveryCodes: string[] }>(
                    '/api/account/recovery-codes',
                    { method: 'POST', body: { password: password.value } },
                )
                pending.value = undefined
                showRecoveryCodes(result.recoveryCodes)
                return
            }
            await pb.send(`/api/account/mfa/${action.factor.id}`, {
                method: 'DELETE',
                body: { password: password.value },
            })
            factors.value = factors.value.filter(
                (f) => f.id !== action.factor.id,
            )
            if (!factors.value.length) codesLeft.value = 0
            pending.value = undefined
        },
        { error: passwordError },
    )
}

const drafts = ref<Record<string, string>>({})

watch(
    factors,
    (list) => {
        for (const factor of list) drafts.value[factor.id] ??= factor.name
    },
    { deep: true },
)

function nameChanged(factor: Factor) {
    return (drafts.value[factor.id] ?? '').trim() !== factor.name
}

const namesChanged = computed(() => factors.value.some(nameChanged))

async function saveNames() {
    const changed = factors.value.filter(nameChanged)
    const updated = await Promise.all(
        changed.map((factor) =>
            pb.send<Factor>(`/api/account/mfa/${factor.id}`, {
                method: 'PATCH',
                body: { name: drafts.value[factor.id] },
            }),
        ),
    )
    const byId = new Map(updated.map((factor) => [factor.id, factor]))
    factors.value = factors.value.map((f) => byId.get(f.id) ?? f)
    for (const factor of updated) drafts.value[factor.id] = factor.name
}

function resetNames() {
    for (const factor of factors.value) drafts.value[factor.id] = factor.name
}

defineExpose({ namesChanged, saveNames, resetNames })

const codesText = computed(() => recoveryCodes.value.join('\n'))

async function copyCodes() {
    await navigator.clipboard
        .writeText(codesText.value)
        .then(() => success(t('account.twoFactor.copied')))
        .catch(() => notifyError(t('notifications.error.generic')))
}

function downloadCodes() {
    const url = URL.createObjectURL(
        new Blob([codesText.value + '\n'], { type: 'text/plain' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'gripello-recovery-codes.txt'
    link.click()
    URL.revokeObjectURL(url)
}
</script>

<style scoped>
@reference "~/assets/css/main.css";

.factor-icon {
    @apply inline-flex size-9 shrink-0 items-center justify-center rounded-lg;
}

.factor-row {
    @apply grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 ps-4 pe-1;
}
</style>
