<template>
    <section
        v-if="linked?.items.length || providers?.length"
        class="flex flex-col"
        data-testid="linked-accounts"
    >
        <LayoutEyebrow>{{ t('account.linkedAccounts.title') }}</LayoutEyebrow>
        <UPageCard variant="outline" :ui="{ container: LIST }">
            <div
                v-for="account in linked?.items ?? []"
                :key="account.id"
                class="flex items-center gap-3 py-1 ps-4 pe-1"
                :data-testid="`linked-account-${account.provider}`"
            >
                <UIcon
                    :name="oauth2ProviderIcon(account.provider)"
                    class="size-4 shrink-0 text-muted"
                />
                <div class="min-w-0 flex-1 py-2">
                    <p class="truncate text-sm font-medium text-highlighted">
                        {{ providerName(account.provider) }}
                    </p>
                    <p v-if="account.email" class="truncate text-xs text-muted">
                        {{ account.email }}
                    </p>
                </div>
                <UButton
                    color="error"
                    variant="ghost"
                    icon="i-lucide-unlink"
                    class="icon-btn"
                    :aria-label="t('account.linkedAccounts.unlink')"
                    :data-testid="`linked-account-unlink-${account.provider}`"
                    @click="unlinking = account"
                />
            </div>
            <div
                v-for="provider in linkable"
                :key="provider.name"
                class="flex items-center gap-3 py-1 ps-4 pe-1"
            >
                <UIcon
                    :name="oauth2ProviderIcon(provider.name)"
                    class="size-4 shrink-0 text-muted"
                />
                <p
                    class="min-w-0 flex-1 truncate py-2 text-sm font-medium text-highlighted"
                >
                    {{ oauth2ProviderName(provider) }}
                </p>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-link"
                    :loading="linking === provider.name"
                    :data-testid="`linked-account-link-${provider.name}`"
                    @click="link(provider.name)"
                >
                    {{ t('account.linkedAccounts.link') }}
                </UButton>
            </div>
        </UPageCard>

        <ConfirmDialog
            :model-value="!!unlinking"
            :title="t('account.linkedAccounts.unlink')"
            :message="
                t('account.linkedAccounts.unlinkConfirm', {
                    provider: unlinking ? providerName(unlinking.provider) : '',
                })
            "
            :confirm-text="t('account.linkedAccounts.unlink')"
            :loading="removing"
            @update:model-value="(open: boolean) => !open && (unlinking = null)"
            @confirm="unlink"
        />

        <ConfirmDialog
            :model-value="!!confirmLink"
            :title="t('account.linkedAccounts.link')"
            :message="t('account.linkedAccounts.linkConfirm')"
            :confirm-text="t('account.linkedAccounts.link')"
            confirm-color="primary"
            :loading="!!linking"
            @update:model-value="(open: boolean) => !open && (confirmLink = '')"
            @confirm="startLink(confirmLink)"
        >
            <UserPasswordField
                v-model="password"
                :label="t('platform.users.adminPassword')"
                icon="i-lucide-shield-check"
                class="mt-3"
                data-testid="linked-account-password"
            />
        </ConfirmDialog>
    </section>
</template>

<script setup lang="ts">
import {
    listLinkedAccounts,
    reauthenticate,
    unlinkAccount,
    type LinkedAccount,
} from '~/api/account'
import { finishOAuth2Link, listOAuth2Providers, startOAuth2 } from '~/api/auth'
import { isWrongPassword } from '~/utils/reauth'
import {
    oauth2ErrorKey,
    oauth2ProviderIcon,
    oauth2ProviderName,
} from '~/utils/oauth2'
import { openSignInPage } from '~/utils/native'

const LIST = 'min-w-0 p-0 sm:p-0 gap-y-0 divide-y divide-default'

const { t } = useI18n()
const { success: notifySuccess, error: notifyError } = useNotification()
const route = useRoute()
const router = useRouter()

// The provider callback lands here with a link ticket (or an error); the ticket only works in this browser.
onMounted(async () => {
    const { oauth2Link, oauth2Error, ...rest } = route.query
    if (!oauth2Link && !oauth2Error) return
    router.replace({ query: rest })
    if (oauth2Error) {
        notifyError(t(oauth2ErrorKey(oauth2Error)))
        return
    }
    try {
        await finishOAuth2Link(String(oauth2Link))
        notifySuccess(t('account.linkedAccounts.linked'))
        await refresh()
    } catch (err) {
        const code = (
            err as { response?: { data?: { ticket?: { code?: string } } } }
        )?.response?.data?.ticket?.code
        notifyError(t(oauth2ErrorKey(code)))
    }
})

const { data: linked, refresh } = useAsyncData(
    'linked-accounts',
    listLinkedAccounts,
    { server: false },
)
useAccountChanges('identities', refresh)
const { data: providers } = useAsyncData(
    'oauth2-providers',
    listOAuth2Providers,
    { server: false, default: () => [] },
)

const linkable = computed(() =>
    (providers.value ?? []).filter(
        (provider) =>
            !linked.value?.items.some(
                (item) => item.provider === provider.name,
            ),
    ),
)

function providerName(name: string) {
    return oauth2ProviderName(
        providers.value?.find((provider) => provider.name === name) ?? { name },
    )
}

const linking = ref('')
const confirmLink = ref('')
const password = ref('')

// Accounts with a password confirm it first, so a stolen session can't add a lasting way in.
function link(provider: string) {
    if (!linked.value?.hasPassword) return startLink(provider)
    password.value = ''
    confirmLink.value = provider
}

async function startLink(provider: string) {
    linking.value = provider
    try {
        if (confirmLink.value) await reauthenticate(password.value)
        const { url } = await startOAuth2(provider, { link: true })
        await openSignInPage(url)
        linking.value = ''
    } catch (err) {
        linking.value = ''
        notifyError(
            isWrongPassword(err)
                ? t('platform.users.adminPasswordWrong')
                : t('auth.oauth2.errors.failed'),
        )
    }
}

const unlinking = ref<LinkedAccount | null>(null)
const { pending: removing, run } = useAsyncAction()

async function unlink() {
    const account = unlinking.value
    if (!account) return
    await run(
        async () => {
            await unlinkAccount(account.id)
            unlinking.value = null
            await refresh()
        },
        {
            error: (err) =>
                (err as { status?: number })?.status === 409
                    ? t('account.linkedAccounts.lastMethod')
                    : t('notifications.error.generic'),
        },
    )
}
</script>
