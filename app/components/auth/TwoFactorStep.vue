<template>
    <div ref="root" class="flex flex-col gap-6" data-testid="two-factor-step">
        <form
            v-if="method !== 'passkey'"
            class="flex flex-col gap-5"
            data-testid="two-factor-form"
            @submit.prevent="verify"
        >
            <UFormField
                :label="
                    method === 'totp'
                        ? t('account.twoFactor.code')
                        : t('account.twoFactor.recoveryCode')
                "
                name="code"
                :error="error || false"
                :ui="{ label: 'sr-only', error: 'text-center' }"
            >
                <UPinInput
                    v-if="method === 'totp'"
                    :model-value="codeDigits"
                    type="number"
                    otp
                    :length="OTP_LENGTH"
                    :separator="3"
                    size="xl"
                    :color="error ? 'error' : 'success'"
                    :highlight="!!error"
                    :disabled="pending"
                    autofocus
                    :class="{ 'two-factor-shake': shaking }"
                    :ui="{
                        root: 'w-full justify-center gap-2',
                        base: 'size-11 text-xl font-semibold tabular-nums sm:size-12',
                    }"
                    data-testid="two-factor-code"
                    @update:model-value="typeCode(otpCode($event))"
                    @complete="verify"
                    @animationend="shaking = false"
                />
                <UInput
                    v-else
                    :model-value="recovery"
                    placeholder="xxxx-xxxx-xxxx-xxxx"
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck="false"
                    size="xl"
                    :color="error ? 'error' : 'success'"
                    :highlight="!!error"
                    :disabled="pending"
                    autofocus
                    class="w-full"
                    :class="{ 'two-factor-shake': shaking }"
                    :ui="{
                        base: 'text-center font-mono tracking-wider',
                    }"
                    data-testid="two-factor-recovery"
                    @update:model-value="typeRecovery(String($event))"
                    @animationend="shaking = false"
                />
            </UFormField>

            <UButton
                type="submit"
                color="primary"
                block
                size="lg"
                :loading="pending"
                :disabled="!ready"
                class="font-semibold"
                data-testid="two-factor-submit"
            >
                {{ t('account.twoFactor.verify') }}
            </UButton>
        </form>

        <div v-else class="flex flex-col items-center gap-5">
            <span
                class="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"
            >
                <UIcon name="i-lucide-fingerprint" class="size-8" />
            </span>
            <p
                v-if="error"
                class="text-center text-sm text-error"
                data-testid="two-factor-error"
            >
                {{ error }}
            </p>
            <UButton
                color="primary"
                block
                size="lg"
                icon="i-lucide-key-round"
                :loading="pending"
                class="font-semibold"
                data-testid="two-factor-passkey"
                @click="usePasskey"
            >
                {{ t('account.twoFactor.usePasskey') }}
            </UButton>
        </div>

        <section v-if="otherMethods.length" class="flex flex-col gap-3">
            <USeparator
                :label="t('account.twoFactor.otherMethod')"
                :ui="{ label: 'text-xs text-muted' }"
            />
            <LayoutListGroup>
                <li v-for="other in otherMethods" :key="other">
                    <button
                        type="button"
                        class="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-elevated/60 disabled:opacity-60"
                        :disabled="pending"
                        :data-testid="`two-factor-method-${other}`"
                        @click="switchMethod(other)"
                    >
                        <span
                            class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-elevated text-muted"
                        >
                            <UIcon :name="METHOD_ICONS[other]" class="size-4" />
                        </span>
                        <span
                            class="flex-1 text-sm font-medium text-highlighted"
                        >
                            {{ t(`account.twoFactor.method.${other}`) }}
                        </span>
                        <UIcon
                            name="i-lucide-chevron-right"
                            class="size-4 text-dimmed rtl:rotate-180"
                        />
                    </button>
                </li>
            </LayoutListGroup>
        </section>

        <UButton
            color="neutral"
            variant="ghost"
            block
            icon="i-lucide-arrow-left"
            :disabled="pending"
            data-testid="two-factor-back"
            @click="emit('back')"
        >
            {{ t('account.twoFactor.backToLogin') }}
        </UButton>
    </div>
</template>

<script setup lang="ts">
import {
    loginWithRecoveryCode,
    loginWithTOTP,
    type AuthResult,
    type SecondFactorMethod,
} from '~/api/auth'
import { OTP_LENGTH, formatRecoveryCode, otpCode, otpDigits } from '~/utils/otp'
import { isPasskeyCancel, passkeysSupported } from '~/utils/webauthn'

const METHOD_ICONS: Record<SecondFactorMethod, string> = {
    totp: 'i-lucide-smartphone',
    passkey: 'i-lucide-key-round',
    recovery: 'i-lucide-life-buoy',
}
const RECOVERY_LENGTH = 19

const props = defineProps<{
    mfaId: string
    methods: SecondFactorMethod[]
}>()
const method = defineModel<SecondFactorMethod>('method', { required: true })
const emit = defineEmits<{
    authenticated: [result: AuthResult]
    failed: [error: unknown]
    back: []
}>()

const { t } = useI18n()
const passkey = usePasskeyLogin()
const root = useTemplateRef<HTMLElement>('root')

const code = ref('')
const recovery = ref('')
const error = ref('')
const pending = ref(false)
const shaking = ref(false)

const codeDigits = computed(() => otpDigits(code.value))
const otherMethods = computed(() =>
    props.methods.filter((other) => other !== method.value),
)
const ready = computed(() =>
    method.value === 'totp'
        ? code.value.length === OTP_LENGTH
        : recovery.value.length === RECOVERY_LENGTH,
)

function typeCode(value: string) {
    code.value = value
    error.value = ''
}

function typeRecovery(value: string) {
    recovery.value = formatRecoveryCode(value)
    error.value = ''
}

function switchMethod(next: SecondFactorMethod) {
    method.value = next
    code.value = ''
    recovery.value = ''
    error.value = ''
    if (next === 'passkey') usePasskey()
}

function endsStep(err: unknown) {
    const { status, response } = (err ?? {}) as {
        status?: number
        response?: { message?: string }
    }
    return status === 429 || /MFA session/i.test(response?.message ?? '')
}

async function rejectCode(message: string) {
    error.value = message
    code.value = ''
    recovery.value = ''
    shaking.value = true
    await nextTick()
    root.value?.querySelector<HTMLInputElement>('input')?.focus()
}

async function verify() {
    if (pending.value || !ready.value) return
    pending.value = true
    try {
        emit(
            'authenticated',
            method.value === 'totp'
                ? await loginWithTOTP(props.mfaId, code.value)
                : await loginWithRecoveryCode(props.mfaId, recovery.value),
        )
    } catch (err) {
        if (endsStep(err)) emit('failed', err)
        else
            await rejectCode(
                method.value === 'totp'
                    ? t('account.twoFactor.invalidCode')
                    : t('account.twoFactor.invalidRecoveryCode'),
            )
    } finally {
        pending.value = false
    }
}

async function usePasskey() {
    if (pending.value) return
    pending.value = true
    error.value = ''
    try {
        emit('authenticated', await passkey.signIn({ mfaId: props.mfaId }))
    } catch (err) {
        if (isPasskeyCancel(err)) return
        if (endsStep(err)) emit('failed', err)
        else error.value = t('account.twoFactor.passkeyFailed')
    } finally {
        pending.value = false
    }
}

onMounted(() => {
    if (method.value === 'passkey' && passkeysSupported()) usePasskey()
})
</script>

<style scoped>
.two-factor-shake {
    animation: two-factor-shake 0.32s ease-in-out;
}

@keyframes two-factor-shake {
    20%,
    60% {
        transform: translateX(-6px);
    }
    40%,
    80% {
        transform: translateX(6px);
    }
}

@media (prefers-reduced-motion: reduce) {
    .two-factor-shake {
        animation: none;
    }
}
</style>
