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
        :error-message="$t('account.wrongOldPassword')"
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
                    class="mb-2"
                    data-testid="email-change-password"
                />
            </UForm>

            <UButton
                color="success"
                block
                size="lg"
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

const isInvalidToken = (error: unknown) =>
    !!(error as { data?: { data?: { token?: unknown } } })?.data?.data?.token
</script>
