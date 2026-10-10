<template>
    <AuthTokenAction
        testid-prefix="reset"
        brand-headline="reset"
        :form-heading="{
            eyebrow: $t('account.eyebrowAccountRecovery'),
            title: $t('account.reset_password'),
            subtitle: $t('account.newPasswordHint'),
        }"
        :done-title="$t('account.passwordSet')"
        :done-subtitle="$t('notifications.success.passwordChanged')"
        :invalid-subtitle="$t('notifications.error.resetLinkInvalid')"
        :action="resetPassword"
        :is-token-error="isInvalidToken"
    >
        <template #default="{ submit, loading }">
            <UserPasswordChangeFields
                v-model:password="newPassword"
                v-model:password-confirm="confirmPassword"
                :require-old-password="false"
                @validity="fieldsValid = $event"
            />

            <UButton
                color="success"
                block
                size="lg"
                :loading="loading"
                :disabled="loading || !fieldsValid"
                class="mt-4 mb-3 font-semibold"
                data-testid="confirm-reset-submit"
                @click="submit"
            >
                {{ $t('actions.save') }}
            </UButton>
        </template>
    </AuthTokenAction>
</template>

<script setup lang="ts">
import { confirmPasswordReset } from '~/api/auth'

defineOptions({ name: 'ResetPasswordPage' })
definePageMeta({ layout: 'blank', auth: false })

const { t } = useI18n()

useHead({ title: t('page.title.resetPassword') })

const fieldsValid = ref(false)
const newPassword = ref('')
const confirmPassword = ref('')

const resetPassword = (token: string) =>
    confirmPasswordReset(token, newPassword.value, confirmPassword.value)

const isInvalidToken = (error: unknown) =>
    (error as { data?: { data?: { token?: { code?: string } } } })?.data?.data
        ?.token?.code === 'validation_invalid_token'
</script>
