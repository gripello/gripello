<template>
    <AuthTokenAction
        testid-prefix="verify"
        brand-headline="login"
        :form-heading="{
            eyebrow: $t('account.eyebrowVerifyEmail'),
            title: $t('account.verifyEmail'),
            subtitle: $t('account.verifyEmailHint'),
        }"
        :done-title="$t('account.emailVerified')"
        :done-subtitle="$t('notifications.success.verifyEmail')"
        :invalid-subtitle="$t('notifications.error.verifyEmail')"
        :action="verify"
        :is-token-error="isInvalidToken"
        :error-message="passwordError"
    >
        <template #default="{ submit, loading }">
            <UForm
                ref="form"
                :state="formState"
                :validate="validateForm"
                data-testid="verify-form"
                @submit="submit"
            >
                <UserPasswordField
                    v-model="password"
                    name="password"
                    :label="$t('account.password')"
                    icon="i-lucide-lock"
                    size="xl"
                    class="mb-2"
                    data-testid="verify-password"
                />
            </UForm>

            <UButton
                color="success"
                block
                size="xl"
                :loading="loading"
                :disabled="loading || !valid"
                class="mb-3 font-semibold"
                data-testid="verify-submit"
                @click="validateAndSubmit(submit)"
            >
                {{ $t('account.verifyEmail') }}
            </UButton>
        </template>
    </AuthTokenAction>
</template>

<script setup lang="ts">
import type { Form } from '@nuxt/ui'
import { required, validateRules } from '~/utils/validation'
import { needsPasswordFirst } from '~/utils/reauth'
import { apiFieldErrors, fieldErrorCode } from '~/utils/fieldErrors'
import { throttledErrorKey } from '~/utils/authErrors'
import { confirmVerification } from '~/api/auth'

defineOptions({ name: 'ConfirmVerificationPage' })
definePageMeta({ layout: 'blank', auth: false })

const { t } = useI18n()

useHead({ title: t('page.title.verifyEmail') })

const form = useTemplateRef<Form<{ password: string }>>('form')
const password = ref('')
const formState = computed(() => ({ password: password.value }))
const validateForm = (state: Record<string, unknown>) =>
    validateRules(state, { password: [required(t)] })
const valid = computed(() => validateForm(formState.value).length === 0)

async function validateAndSubmit(submit: () => Promise<void>) {
    if ((await form.value?.validate({ silent: true })) !== false) await submit()
}

const verify = (token: string) => confirmVerification(token, password.value)

function passwordError(error: unknown) {
    if (needsPasswordFirst(error)) return t('account.passwordRequired')
    const throttled = throttledErrorKey(error)
    if (throttled) return t(throttled)
    if (fieldErrorCode(error, 'password')) return t('account.wrongPassword')
    return t('notifications.error.unknown')
}

const isInvalidToken = (error: unknown) => 'token' in apiFieldErrors(error)
</script>
