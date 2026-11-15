<script setup lang="ts">
import { listLinkedAccounts } from '~/api/account'
import { listAuthMethods } from '~/api/auth'
import { oauth2ProviderIcon, oauth2ProviderName } from '~/utils/oauth2'
import { reportCaughtError } from '~/utils/clientErrors'

const password = defineModel<string>({ default: '' })

const { t } = useI18n()
const { error: notifyError } = useNotification()
const { data: linked } = useAsyncData('linked-accounts', listLinkedAccounts, {
    server: false,
})
const { data: providers } = useAsyncData(
    'oauth2-providers',
    async () => (await listAuthMethods()).oauth2.providers,
    { server: false, default: () => [] },
)
const { pending, failed, confirmed, confirmWith } = useProviderReauth()

const passwordless = computed(() => linked.value?.hasPassword === false)

function providerName(name: string) {
    return oauth2ProviderName(
        providers.value?.find((provider) => provider.name === name) ?? { name },
    )
}

async function confirm(provider: string) {
    try {
        await confirmWith(provider)
    } catch (error) {
        reportCaughtError(error)
        notifyError(t('auth.reauth.failed'))
    }
}

watch(failed, (isFailed) => {
    if (isFailed) notifyError(t('auth.reauth.failed'))
})
</script>

<template>
    <div
        v-if="passwordless"
        class="flex flex-col gap-2"
        data-testid="reauth-providers"
    >
        <UButton
            v-for="account in linked?.items ?? []"
            :key="account.id"
            :icon="
                confirmed
                    ? 'i-lucide-circle-check'
                    : oauth2ProviderIcon(account.provider)
            "
            :color="confirmed ? 'success' : 'neutral'"
            variant="soft"
            block
            :loading="pending === account.provider"
            :disabled="confirmed"
            :data-testid="`reauth-provider-${account.provider}`"
            @click="confirm(account.provider)"
        >
            {{
                confirmed
                    ? t('auth.reauth.confirmed')
                    : t('auth.reauth.confirmWith', {
                          provider: providerName(account.provider),
                      })
            }}
        </UButton>
    </div>
    <UserPasswordField
        v-else
        v-model="password"
        :label="t('platform.users.adminPassword')"
        icon="i-lucide-shield-check"
    />
</template>
