<template>
    <AuthTokenAction
        testid-prefix="email-change"
        brand-headline="login"
        :form-heading="{
            eyebrow: $t('account.eyebrowEmailChange'),
            title: $t('account.emailChange'),
            subtitle: $t('account.emailChangeHint'),
        }"
        :done-title="$t('account.emailChanged')"
        :done-subtitle="$t('notifications.success.emailChange')"
        :invalid-subtitle="$t('notifications.error.emailChange')"
        :action="confirmEmailChange"
        :is-token-error="isInvalidToken"
        :error-message="passwordError"
    >
        <template #default="{ submit, loading }">
            <UForm
                ref="form"
                :state="formState"
                :validate="validateForm"
                data-testid="email-change-form"
                @submit="submit"
            >
                <UserPasswordField
                    v-model="password"
                    name="password"
                    :label="$t('account.password')"
                    icon="i-lucide-lock"
                    size="xl"
                    class="mb-2"
                    data-testid="email-change-password"
                />
            </UForm>

            <UButton
                color="success"
                block
                size="xl"
                :loading="loading"
                :disabled="loading || !valid"
                class="mb-3 font-semibold"
                data-testid="email-change-submit"
                @click="validateAndSubmit(submit)"
            >
                {{ $t('actions.save') }}
            </UButton>
        </template>
    </AuthTokenAction>
</template>

<script setup lang="ts">
import type { Form } from '@nuxt/ui'
import { required, validateRules } from '~/utils/validation'
import { needsPasswordFirst } from '~/utils/reauth'
import { apiFieldErrors, blockedFieldError } from '~/utils/fieldErrors'
import { confirmEmailChange as confirmChange, useAuthState } from '~/api/auth'

defineOptions({ name: 'ConfirmEmailChangePage' })
definePageMeta({ layout: 'blank', auth: false })

const { t } = useI18n()
const { clearAuth } = useAuthState()

useHead({ title: t('page.title.emailChange') })

const form = useTemplateRef<Form<{ password: string }>>('form')
const password = ref('')
const formState = computed(() => ({ password: password.value }))
const validateForm = (state: Record<string, unknown>) =>
    validateRules(state, { password: [required(t)] })
const valid = computed(() => validateForm(formState.value).length === 0)

async function validateAndSubmit(submit: () => Promise<void>) {
    if ((await form.value?.validate({ silent: true })) !== false) await submit()
}

async function confirmEmailChange(token: string) {
    await confirmChange(token, password.value)
    clearAuth()
}

function passwordError(error: unknown) {
    if (needsPasswordFirst(error)) return t('account.passwordRequired')
    const blocked = blockedFieldError(error, ['newEmail'])
    return t(blocked?.key ?? 'account.wrongOldPassword')
}

const isInvalidToken = (error: unknown) => 'token' in apiFieldErrors(error)
</script>
