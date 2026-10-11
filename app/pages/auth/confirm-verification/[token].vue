<template>
    <AuthTokenAction
        testid-prefix="verify"
        brand-headline="login"
        auto
        :form-heading="{
            eyebrow: $t('account.eyebrowVerifyEmail'),
            title: $t('account.verifyEmail'),
            subtitle: $t('account.verifyEmailHint'),
        }"
        :done-title="$t('account.emailVerified')"
        :done-subtitle="$t('notifications.success.verifyEmail')"
        :invalid-subtitle="$t('notifications.error.verifyEmail')"
        :action="verify"
    />
</template>

<script setup lang="ts">
import { confirmVerification } from '~/api/auth'

defineOptions({ name: 'ConfirmVerificationPage' })
definePageMeta({ layout: 'blank', auth: false })

const { t } = useI18n()

useHead({ title: t('page.title.verifyEmail') })

const verify = (token: string) => confirmVerification(token)
</script>
