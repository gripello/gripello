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
        <LayoutListGroup v-else data-testid="two-factor-settings">
            <LayoutListRow
                v-if="totp"
                dense
                icon="i-lucide-smartphone"
                icon-active
            >
                <div class="flex min-w-0 flex-1 flex-col gap-1 py-1">
                    <UInput
                        v-model="drafts[totp.id]"
                        :placeholder="t('account.twoFactor.authenticatorApp')"
                        :aria-label="t('account.twoFactor.name')"
                        maxlength="60"
                        size="sm"
                        :data-testid="`two-factor-name-${totp.id}`"
                    />
                    <p class="truncate text-xs text-muted">
                        {{ usedLabel(totp) }}
                    </p>
                </div>
                <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-x"
                    class="icon-btn"
                    :aria-label="t('account.twoFactor.removeAuthenticator')"
                    data-testid="two-factor-totp-remove"
                    @click="askPassword({ kind: 'remove', factor: totp })"
                />
            </LayoutListRow>
            <LayoutListRow v-else dense icon="i-lucide-smartphone">
                <span
                    class="flex-1 truncate text-sm font-medium text-highlighted"
                >
                    {{ t('account.twoFactor.authenticatorApp') }}
                </span>
                <UButton
                    color="primary"
                    variant="soft"
                    class="me-3"
                    :loading="withPassword.pending.value"
                    data-testid="two-factor-totp-setup"
                    @click="askPassword({ kind: 'totp' })"
                >
                    {{ t('account.twoFactor.setUp') }}
                </UButton>
            </LayoutListRow>

            <LayoutListRow
                v-for="passkey in passkeys"
                :key="passkey.id"
                dense
                icon="i-lucide-key-round"
                icon-active
                data-testid="two-factor-passkey"
            >
                <div class="flex min-w-0 flex-1 flex-col gap-1 py-1">
                    <UInput
                        v-model="drafts[passkey.id]"
                        :placeholder="t('account.twoFactor.passkey')"
                        :aria-label="t('account.twoFactor.name')"
                        maxlength="60"
                        size="sm"
                        :data-testid="`two-factor-name-${passkey.id}`"
                    />
                    <p class="truncate text-xs text-muted">
                        {{ usedLabel(passkey) }}
                    </p>
                </div>
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
            </LayoutListRow>

            <LayoutListRow v-if="canAddPasskey" dense icon="i-lucide-key-round">
                <span class="flex-1 text-sm font-medium text-highlighted">
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
            </LayoutListRow>

            <LayoutListRow
                v-if="factors.length"
                dense
                icon="i-lucide-life-buoy"
                :icon-active="codesLeft > 0"
            >
                <div class="min-w-0 flex-1">
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
            </LayoutListRow>
        </LayoutListGroup>

        <AccountTotpSetup
            v-model:setup="totpSetupState"
            @enabled="totpEnabled"
        />

        <LayoutDialogShell
            :model-value="!!pending"
            :title="passwordTitle"
            :max-width="420"
            data-testid="two-factor-password-dialog"
            @update:model-value="!$event && (pending = undefined)"
            :submit-label="passwordAction"
            submit-form="two-factor-password-form"
            :submit-color="pending?.kind === 'remove' ? 'error' : 'primary'"
            :submit-loading="withPassword.pending.value"
            :submit-disabled="!password"
            submit-test-id="two-factor-password-confirm"
            cancel-test-id="two-factor-password-cancel"
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
        </LayoutDialogShell>

        <AccountRecoveryCodes v-model:codes="recoveryCodes" />
    </section>
</template>

<script setup lang="ts">
import { formatDate } from '#shared/utils/formatting'
import { deviceLabel } from '~/utils/push'
import { needsPasswordFirst } from '~/utils/reauth'
import {
    createPasskey,
    isPasskeyCancel,
    passkeysSupported,
} from '~/utils/webauthn'
import {
    deleteMFAFactor,
    listMFAFactors,
    passkeyRegister,
    passkeyRegistrationOptions,
    regenerateRecoveryCodes,
    renameMFAFactor,
    totpSetup,
    type Factor,
} from '~/api/account'
import { useAuthState } from '~/api/auth'
import type { TotpSetupState } from './TotpSetup.vue'

type PendingAction =
    | { kind: 'remove'; factor: Factor }
    | { kind: 'codes' }
    | { kind: 'totp' }
    | { kind: 'passkey' }

const { t, locale } = useI18n()
const { currentUser } = useAuthState()
const { success } = useNotification()
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
        const result = await listMFAFactors()
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
useAccountChanges('mfa', load)

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

function showRecoveryCodes(codes?: string[]) {
    if (!codes?.length) return
    recoveryCodes.value = codes
    codesLeft.value = codes.length
}

const totpSetupState = ref<TotpSetupState | null>(null)

async function startTotpSetup(confirmedPassword: string) {
    const { secret, uri } = await totpSetup(confirmedPassword)
    pending.value = undefined
    totpSetupState.value = { secret, uri, password: confirmedPassword }
}

function totpEnabled(factor: Factor, codes?: string[]) {
    factors.value = [...factors.value, factor]
    showRecoveryCodes(codes)
}

async function registerPasskey(confirmedPassword: string) {
    const { ceremony, options } =
        await passkeyRegistrationOptions(confirmedPassword)
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
            const result = await passkeyRegister({
                ceremony,
                credential,
                name: deviceLabel(navigator.userAgent),
            })
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
    () => currentUser()?.email || currentUser()?.username || '',
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
    if (needsPasswordFirst(err)) return t('account.passwordRequired')
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
                const result = await regenerateRecoveryCodes(password.value)
                pending.value = undefined
                showRecoveryCodes(result.recoveryCodes)
                return
            }
            await deleteMFAFactor(action.factor.id, password.value)
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
            renameMFAFactor(factor.id, drafts.value[factor.id]!),
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
</script>
