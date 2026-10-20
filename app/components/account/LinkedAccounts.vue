<template>
    <section
        v-if="linked?.items.length || providers?.length"
        class="flex flex-col"
        data-testid="linked-accounts"
    >
        <LayoutEyebrow>{{ t('account.linkedAccounts.title') }}</LayoutEyebrow>
        <LayoutListGroup>
            <LayoutListRow
                v-for="account in linked?.items ?? []"
                :key="account.id"
                dense
                :icon="oauth2ProviderIcon(account.provider)"
                :data-testid="`linked-account-${account.provider}`"
            >
                <div class="min-w-0 flex-1">
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
            </LayoutListRow>
            <LayoutListRow
                v-for="provider in linkable"
                :key="provider.name"
                dense
                :icon="oauth2ProviderIcon(provider.name)"
            >
                <p
                    class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted"
                >
                    {{ oauth2ProviderName(provider) }}
                </p>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-link"
                    class="me-3"
                    :loading="linking === provider.name"
                    :data-testid="`linked-account-link-${provider.name}`"
                    @click="link(provider.name)"
                >
                    {{ t('account.linkedAccounts.link') }}
                </UButton>
            </LayoutListRow>
        </LayoutListGroup>

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
            <UserReauthField
                v-model="password"
                class="mt-3"
                data-testid="linked-account-password"
            />
        </ConfirmDialog>
    </section>
</template>

<script setup lang="ts">
import {
    listLinkedAccounts,
    unlinkAccount,
    type LinkedAccount,
} from '~/api/account'
import { finishOAuth2Link, listAuthMethods, startOAuth2 } from '~/api/auth'
import {
    oauth2ErrorKey,
    oauth2ProviderIcon,
    oauth2ProviderName,
} from '~/utils/oauth2'
import { openSignInPage } from '~/utils/native'

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
    async () => (await listAuthMethods()).oauth2.providers,
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
const {
    password,
    confirm: reauthenticate,
    errorText: reauthError,
} = useReauth(confirmLink)

// Accounts with a password confirm it first, so a stolen session can't add a lasting way in.
function link(provider: string) {
    if (!linked.value?.hasPassword) return startLink(provider)
    confirmLink.value = provider
}

async function startLink(provider: string) {
    linking.value = provider
    try {
        if (confirmLink.value) await reauthenticate()
        const { url } = await startOAuth2(provider, { link: true })
        await openSignInPage(url)
        linking.value = ''
    } catch (err) {
        linking.value = ''
        notifyError(reauthError(t('auth.oauth2.errors.failed'))(err))
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
