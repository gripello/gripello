<template>
    <LayoutDialogShell
        :model-value="!!setup"
        :title="t('account.twoFactor.authenticatorApp')"
        :max-width="420"
        data-testid="two-factor-setup-dialog"
        :submit-label="t('account.twoFactor.verify')"
        submit-form="totp-setup-form"
        :submit-loading="confirmSetup.pending.value"
        :submit-disabled="code.length !== OTP_LENGTH"
        submit-test-id="two-factor-setup-confirm"
        @update:model-value="!$event && emit('update:setup', null)"
    >
        <UForm
            id="totp-setup-form"
            :state="{ code }"
            class="flex flex-col items-center gap-4"
            @submit="confirm"
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
                    :model-value="digits"
                    type="number"
                    otp
                    :length="OTP_LENGTH"
                    size="lg"
                    class="w-full justify-between"
                    data-testid="two-factor-setup-code"
                    @update:model-value="code = otpCode($event)"
                    @complete="confirm"
                />
            </UFormField>
        </UForm>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import { OTP_LENGTH, otpCode, otpDigits } from '~/utils/otp'
import { totpEnable, type Factor } from '~/api/account'

export interface TotpSetupState {
    secret: string
    uri: string
    password: string
}

const props = defineProps<{ setup: TotpSetupState | null }>()
const emit = defineEmits<{
    'update:setup': [value: null]
    enabled: [factor: Factor, recoveryCodes?: string[]]
}>()

const { t } = useI18n()
const confirmSetup = useAsyncAction()
const code = ref('')
const digits = computed(() => otpDigits(code.value))
const qrDataUrl = ref('')
const formattedSecret = computed(() =>
    (props.setup?.secret ?? '').replace(/(.{4})/g, '$1 ').trim(),
)

watch(
    () => props.setup,
    async (setup) => {
        code.value = ''
        qrDataUrl.value = ''
        if (!setup) return
        const { default: QRCode } = await import('qrcode')
        const dataUrl = await QRCode.toDataURL(setup.uri, {
            margin: 0,
            width: 192,
        })
        if (props.setup === setup) qrDataUrl.value = dataUrl
    },
    { immediate: true },
)

function confirm() {
    const setup = props.setup
    if (
        !setup ||
        confirmSetup.pending.value ||
        code.value.length !== OTP_LENGTH
    )
        return
    return confirmSetup.run(
        async () => {
            const result = await totpEnable({
                secret: setup.secret,
                code: code.value.trim(),
                password: setup.password,
            })
            emit('update:setup', null)
            emit('enabled', result.factor, result.recoveryCodes)
        },
        {
            success: t('account.twoFactor.enabled'),
            error: t('account.twoFactor.invalidCode'),
        },
    )
}
</script>
