<template>
    <div class="flex flex-col gap-6" data-testid="platform-oauth-settings">
        <LayoutEmptyState
            v-if="error"
            variant="error"
            :title="t('errors.loadFailed')"
        />
        <LayoutPanel v-else :title="t('platform.settings.oauth2.title')" flush>
            <LayoutListGroup flush>
                <li
                    v-for="item in providers ?? []"
                    :key="item.provider"
                    :data-testid="`platform-oauth-${item.provider}`"
                    :data-status="oauthProviderStatus(item)"
                >
                    <button
                        type="button"
                        class="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-elevated/50 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset sm:px-6"
                        :aria-expanded="open === item.provider"
                        :data-testid="`platform-oauth-${item.provider}-toggle`"
                        @click="
                            open = open === item.provider ? null : item.provider
                        "
                    >
                        <span
                            class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-elevated"
                        >
                            <UIcon
                                :name="oauth2ProviderIcon(item.provider)"
                                class="size-5"
                            />
                        </span>
                        <span class="flex min-w-0 flex-1 flex-col">
                            <span class="font-semibold text-highlighted">
                                {{
                                    t(
                                        `platform.settings.oauth2.providers.${item.provider}`,
                                    )
                                }}
                            </span>
                            <span class="truncate font-mono text-xs text-muted">
                                {{ providerDetail(item) }}
                            </span>
                        </span>
                        <UBadge
                            :color="STATUS_COLORS[oauthProviderStatus(item)]"
                            variant="subtle"
                        >
                            {{
                                t(
                                    `platform.settings.oauth2.status.${oauthProviderStatus(item)}`,
                                )
                            }}
                        </UBadge>
                        <UIcon
                            name="i-lucide-chevron-down"
                            class="size-5 shrink-0 text-muted transition-transform"
                            :class="{ 'rotate-180': open === item.provider }"
                        />
                    </button>
                    <div
                        v-if="open === item.provider && forms[item.provider]"
                        class="mx-4 mb-5 flex flex-col gap-5 border-t border-default pt-5 sm:mx-6 sm:ml-[4.75rem]"
                    >
                        <div class="flex flex-wrap gap-2">
                            <UBadge
                                v-for="(done, check) in oauthProviderChecks(
                                    item,
                                )"
                                :key="check"
                                :color="done ? 'success' : 'neutral'"
                                variant="soft"
                                :icon="
                                    done
                                        ? 'i-lucide-circle-check'
                                        : 'i-lucide-circle'
                                "
                            >
                                {{
                                    t(
                                        `platform.settings.oauth2.checks.${check}`,
                                    )
                                }}
                            </UBadge>
                        </div>
                        <USwitch
                            v-model="forms[item.provider]!.enabled"
                            :label="t('platform.settings.oauth2.enabled')"
                            :data-testid="`platform-oauth-${item.provider}-enabled`"
                        />
                        <div class="grid gap-4 sm:grid-cols-2">
                            <UFormField
                                v-if="item.provider === 'oidc'"
                                :label="
                                    t('platform.settings.oauth2.displayName')
                                "
                            >
                                <UInput
                                    v-model="forms[item.provider]!.display_name"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                v-if="item.provider === 'oidc'"
                                :label="t('platform.settings.oauth2.issuerUrl')"
                            >
                                <UInput
                                    v-model="forms[item.provider]!.issuer_url"
                                    type="url"
                                    placeholder="https://auth.example.com/realms/club"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                v-if="item.provider === 'microsoft'"
                                :label="t('platform.settings.oauth2.tenant')"
                                class="sm:col-span-2"
                            >
                                <UInput
                                    v-model="forms[item.provider]!.tenant"
                                    placeholder="common"
                                    class="w-full font-mono"
                                />
                            </UFormField>
                            <UFormField
                                :label="t('platform.settings.oauth2.clientId')"
                            >
                                <UInput
                                    v-model="forms[item.provider]!.client_id"
                                    autocomplete="off"
                                    class="w-full font-mono"
                                    :data-testid="`platform-oauth-${item.provider}-client-id`"
                                />
                            </UFormField>
                            <UFormField
                                v-if="item.provider !== 'apple'"
                                :label="
                                    t('platform.settings.oauth2.clientSecret')
                                "
                            >
                                <UInput
                                    v-model="
                                        forms[item.provider]!.client_secret
                                    "
                                    type="password"
                                    autocomplete="new-password"
                                    :placeholder="
                                        item.client_secret_set
                                            ? t(
                                                  'platform.settings.mail.passwordSet',
                                              )
                                            : ''
                                    "
                                    class="w-full"
                                />
                            </UFormField>
                            <template v-if="item.provider === 'apple'">
                                <UFormField
                                    :label="
                                        t('platform.settings.oauth2.teamId')
                                    "
                                >
                                    <UInput
                                        v-model="forms[item.provider]!.team_id"
                                        class="w-full font-mono"
                                    />
                                </UFormField>
                                <UFormField
                                    :label="t('platform.settings.oauth2.keyId')"
                                >
                                    <UInput
                                        v-model="forms[item.provider]!.key_id"
                                        class="w-full font-mono"
                                    />
                                </UFormField>
                                <UFormField
                                    :label="
                                        t('platform.settings.oauth2.privateKey')
                                    "
                                    class="sm:col-span-2"
                                >
                                    <UTextarea
                                        v-model="
                                            forms[item.provider]!.private_key
                                        "
                                        :rows="3"
                                        :placeholder="
                                            item.private_key_set
                                                ? t(
                                                      'platform.settings.mail.passwordSet',
                                                  )
                                                : ''
                                        "
                                        class="w-full font-mono text-xs"
                                    />
                                </UFormField>
                            </template>
                        </div>
                        <UFormField
                            :label="t('platform.settings.oauth2.redirectUri')"
                        >
                            <div
                                class="flex w-full items-center gap-2 rounded-md border border-dashed border-accented bg-elevated/40 py-1 pr-1 pl-3"
                            >
                                <code class="min-w-0 flex-1 truncate text-xs">{{
                                    item.redirect_uri
                                }}</code>
                                <UButton
                                    color="neutral"
                                    variant="outline"
                                    size="sm"
                                    icon="i-lucide-copy"
                                    @click="copy(item.redirect_uri)"
                                >
                                    {{ t('platform.settings.oauth2.copy') }}
                                </UButton>
                            </div>
                        </UFormField>
                        <div class="flex items-center gap-2">
                            <UButton
                                color="neutral"
                                variant="ghost"
                                :disabled="!changed(item)"
                                @click="
                                    forms[item.provider] =
                                        oauthProviderForm(item)
                                "
                            >
                                {{ t('actions.cancel') }}
                            </UButton>
                            <span class="flex-1" />
                            <UButton
                                color="primary"
                                :disabled="!changed(item)"
                                :data-testid="`platform-oauth-${item.provider}-save`"
                                @click="pending = item.provider"
                            >
                                {{ t('actions.save') }}
                            </UButton>
                        </div>
                    </div>
                </li>
            </LayoutListGroup>
        </LayoutPanel>

        <ConfirmDialog
            :model-value="!!pending"
            :title="
                pending
                    ? t(`platform.settings.oauth2.providers.${pending}`)
                    : ''
            "
            :message="t('platform.settings.oauth2.confirm')"
            :confirm-text="t('actions.save')"
            confirm-color="primary"
            :loading="saving"
            @update:model-value="(open: boolean) => !open && (pending = null)"
            @confirm="save"
        >
            <UserReauthField
                v-model="adminPassword"
                class="mt-3"
                data-testid="platform-oauth-admin-password"
            />
        </ConfirmDialog>
    </div>
</template>

<script setup lang="ts">
import { CLIENT_ONLY } from '~/utils/platformMail'
import { copyText } from '~/utils/clipboard'
import {
    listOAuthProviderSettings,
    saveOAuthProviderSettings,
    type OAuthProviderSettings,
} from '~/api/platform'
import { oauth2ProviderIcon } from '~/utils/oauth2'
import {
    oauthProviderChecks,
    oauthProviderForm,
    oauthProviderPayload,
    oauthProviderStatus,
    type OAuthProviderForm,
} from '~/utils/oauthSettings'

const { t } = useI18n()
const { success: notifySuccess, error: notifyError } = useNotification()

const { data: providers, error } = useAsyncData(
    'platform-oauth2',
    listOAuthProviderSettings,
    CLIENT_ONLY,
)

const open = ref<string | null>(null)
const STATUS_COLORS = {
    live: 'success',
    configured: 'info',
    missing: 'neutral',
} as const

function providerDetail(item: OAuthProviderSettings) {
    if (!item.client_id) return t('platform.settings.oauth2.status.missing')
    return item.provider === 'microsoft' && item.tenant
        ? `${t('platform.settings.oauth2.tenant')} ${item.tenant}`
        : item.client_id
}

const { form: forms } = useDraft(
    providers,
    (items): Record<string, OAuthProviderForm> =>
        Object.fromEntries(
            (items ?? []).map((item) => [
                item.provider,
                oauthProviderForm(item),
            ]),
        ),
)

function changed(item: OAuthProviderSettings) {
    const form = forms[item.provider]
    return (
        !!form &&
        JSON.stringify(form) !== JSON.stringify(oauthProviderForm(item))
    )
}

async function copy(text: string) {
    if (await copyText(text))
        notifySuccess(t('platform.settings.oauth2.copied'))
    else notifyError(t('notifications.error.generic'))
}

const pending = ref<string | null>(null)
const {
    password: adminPassword,
    confirm: reauthenticate,
    errorText: reauthError,
} = useReauth(pending)

const { pending: saving, run } = useAsyncAction()

async function save() {
    const provider = pending.value
    const form = provider ? forms[provider] : undefined
    if (!provider || !form) return
    await run(
        async () => {
            await reauthenticate()
            providers.value = await saveOAuthProviderSettings(
                provider,
                oauthProviderPayload(form),
            )
            const saved = providers.value.find((p) => p.provider === provider)
            if (saved) forms[provider] = oauthProviderForm(saved)
            pending.value = null
        },
        {
            success: t('settings.saveSuccess'),
            error: reauthError(t('settings.saveError')),
        },
    )
}
</script>
