<template>
    <div
        class="w-full px-4 pt-4"
        :class="{ 'max-lg:pb-24': sectionChanged[activeTab] }"
        data-testid="settings-page"
    >
        <div data-testid="profile-header">
            <LayoutPageHeader :title="t('accountSettings.title')" />
            <div ref="tabNav" class="mb-4">
                <LayoutTabs
                    v-model="selectedTab"
                    :items="tabs"
                    :content="false"
                >
                    <template #default="{ item }">
                        <UChip
                            :show="
                                item.value === 'security' && showSecurityWarning
                            "
                            color="warning"
                            size="sm"
                        >
                            <span :data-testid="`profile-tab-${item.value}`">
                                {{ item.label }}
                            </span>
                        </UChip>
                    </template>
                </LayoutTabs>
            </div>
        </div>

        <div class="flex flex-col gap-4 sm:gap-6 pb-8">
            <LayoutSaveBar
                :show="sectionChanged[activeTab]"
                :loading="saving"
                :disabled="!canSave(activeTab) || saving"
                test-id-prefix="profile"
                class="lg:-mb-6"
                cancelable
                @save="saveUser(activeTab)"
                @cancel="resetSection(activeTab)"
            />

            <UPageCard v-if="activeTab === 'profile'" variant="outline">
                <UForm
                    ref="profileForm"
                    :state="user"
                    :validate="validateProfile"
                    class="grid gap-5 lg:grid-cols-2"
                >
                    <UserProfileImages
                        :banner="bannerPreview"
                        :avatar="avatarPreview"
                        :name="`${user.firstname ?? ''} ${user.name ?? ''}`"
                        :user-id="user.id"
                        class="lg:col-span-2"
                        @banner="selectBanner"
                        @remove-banner="removeBanner"
                        @avatar="selectAvatar"
                    />
                    <UFormField
                        :label="t('account.firstname')"
                        name="firstname"
                        required
                    >
                        <UInput
                            :model-value="user.firstname ?? ''"
                            @update:model-value="user.firstname = $event"
                            :placeholder="t('account.placeholders.firstname')"
                            autocomplete="given-name"
                            :maxlength="50"
                            class="w-full"
                            data-testid="profile-firstname"
                        />
                    </UFormField>
                    <UFormField
                        :label="t('account.lastname')"
                        name="name"
                        required
                    >
                        <UInput
                            :model-value="user.name ?? ''"
                            @update:model-value="user.name = $event"
                            :placeholder="t('account.placeholders.lastname')"
                            autocomplete="family-name"
                            :maxlength="50"
                            class="w-full"
                            data-testid="profile-lastname"
                        />
                    </UFormField>
                    <UFormField
                        :label="t('account.email')"
                        name="email"
                        required
                        :help="
                            emailChangeRequested
                                ? t('account.emailChangeConfirmHint')
                                : undefined
                        "
                    >
                        <UInput
                            v-model="user.email"
                            type="email"
                            autocomplete="email"
                            class="w-full"
                            data-testid="profile-email"
                        />
                    </UFormField>
                </UForm>
            </UPageCard>

            <UPageCard
                v-else-if="activeTab === 'preferences'"
                variant="outline"
                :ui="{ container: 'lg:grid-cols-2 gap-y-5' }"
            >
                <UFormField :label="t('accountSettings.language')">
                    <UPopover :content="{ align: 'start', sideOffset: 4 }">
                        <UButton
                            color="neutral"
                            variant="outline"
                            icon="i-lucide-languages"
                            trailing-icon="i-lucide-chevron-down"
                            size="lg"
                            block
                            :ui="{ trailingIcon: 'ms-auto text-dimmed' }"
                            class="justify-start"
                            data-testid="profile-language"
                        >
                            {{ currentLocale.name }}
                        </UButton>

                        <template #content="{ close }">
                            <div
                                class="flex min-w-[170px] flex-col gap-0.5 p-1"
                            >
                                <button
                                    v-for="loc in SUPPORTED_LOCALES"
                                    :key="loc.code"
                                    type="button"
                                    class="flex items-center rounded-lg px-2.5 py-1.5 text-sm text-start hover:bg-elevated"
                                    :class="{
                                        'bg-primary/10 text-primary':
                                            user.language === loc.code,
                                    }"
                                    :aria-pressed="user.language === loc.code"
                                    :data-testid="`profile-language-${loc.code}`"
                                    @click="selectLanguage(loc.code, close)"
                                >
                                    <span class="locale-code mr-3">{{
                                        loc.code.toUpperCase()
                                    }}</span>
                                    {{ loc.name }}
                                </button>
                            </div>
                        </template>
                    </UPopover>
                </UFormField>
                <UFormField :label="t('accountSettings.theme')">
                    <USelect
                        :model-value="themeMode"
                        :items="themeOptions"
                        :icon="themeIcon"
                        class="w-full"
                        data-testid="profile-theme"
                        @update:model-value="setThemeMode($event)"
                    />
                </UFormField>
            </UPageCard>

            <AccountPushSettings v-else-if="activeTab === 'notifications'" />

            <AccountPrivacySettings v-else-if="activeTab === 'privacy'" />

            <template v-else>
                <UPageCard variant="outline" :ui="{ container: 'gap-y-4' }">
                    <UserPasswordChangeFields
                        class="lg:grid lg:grid-cols-2 lg:gap-x-6 lg:[&>*:nth-child(2)]:col-start-1"
                        v-model:old-password="user.oldPassword"
                        v-model:password="user.password"
                        v-model:password-confirm="user.passwordConfirm"
                        :require-old-password="true"
                        @validity="passwordFieldsValid = $event"
                    />
                </UPageCard>

                <AccountTwoFactorSettings ref="twoFactor" />

                <AccountSessionList />

                <UPageCard
                    :title="t('account.exportData')"
                    :description="t('account.exportDataHint')"
                    variant="outline"
                    orientation="horizontal"
                >
                    <UButton
                        color="neutral"
                        variant="soft"
                        icon="i-lucide-download"
                        class="w-fit lg:ms-auto"
                        data-testid="account-export"
                        :loading="exportPending"
                        @click="downloadExport"
                    >
                        {{ t('account.exportDataDownload') }}
                    </UButton>
                </UPageCard>

                <UPageCard
                    :title="t('account.deleteAccount')"
                    :description="t('account.deleteAccountHint')"
                    variant="outline"
                    orientation="horizontal"
                    highlight
                    highlight-color="error"
                >
                    <UButton
                        color="error"
                        variant="soft"
                        icon="i-lucide-trash-2"
                        class="w-fit lg:ms-auto"
                        data-testid="profile-delete-open"
                        @click="deleteDialog = true"
                    >
                        {{ t('account.deleteAccount') }}
                    </UButton>
                </UPageCard>
            </template>
        </div>

        <ConfirmDialog
            v-model="deleteDialog"
            :title="t('account.deleteAccount')"
            :message="t('account.deleteAccountConfirm')"
            :confirm-text="t('actions.delete')"
            :loading="deleting"
            @confirm="deleteAccount"
        >
            <UFormField :label="t('account.oldPassword')" class="mt-4">
                <UInput
                    v-model="deletePassword"
                    type="password"
                    autocomplete="current-password"
                    class="w-full"
                    data-testid="profile-delete-password"
                />
            </UFormField>
        </ConfirmDialog>

        <ConfirmDialog
            v-model="discardDialogOpen"
            :title="t('account.unsavedChanges')"
            :message="t('mapEditor.discard')"
            :confirm-text="t('mapPlacement.discard')"
            @confirm="settleDiscard(true)"
        />
    </div>
</template>

<script setup lang="ts">
import { required, validEmail, validateRules } from '~/utils/validation'
import { fileUrl, type ApiError } from '~/api/client'
import type { Form } from '@nuxt/ui'
import { SUPPORTED_LOCALES, isLocaleCode } from '~/utils/locales'
import type { ThemeMode } from '~/composables/useThemeMode'
import type { UserRecord } from '~/types/models'
import { requestEmailChange, useAuthState } from '~/api/auth'
import { changePassword, deleteMe, updateMe } from '~/api/account'

type EditableSelf = UserRecord & {
    language: string
    oldPassword: string
    password: string
    passwordConfirm: string
}

const SECTIONS = [
    'profile',
    'preferences',
    'notifications',
    'privacy',
    'security',
] as const
type Section = (typeof SECTIONS)[number]

definePageMeta({
    middleware: ['auth'],
})

const { t, locale, setLocale } = useI18n()
useSeoMeta({ title: () => t('page.title.accountSettings') })

const route = useRoute()
const activeTab = computed<Section>(
    () => SECTIONS.find((section) => section === route.query.tab) ?? 'profile',
)

const auth = useAuthState()
const { pending: exportPending, download: downloadExport } = useAccountExport()
const authRecord = auth.currentUser<UserRecord>()

const user = reactive<EditableSelf>({
    ...(authRecord ?? {
        id: '',
        username: '',
        firstname: '',
        name: '',
        email: '',
        avatar: null,
    }),
    language: authRecord?.language || locale.value,
    oldPassword: '',
    password: '',
    passwordConfirm: '',
})

const currentLocale = computed(
    () =>
        SUPPORTED_LOCALES.find((l) => l.code === user.language) ??
        SUPPORTED_LOCALES[0],
)

function selectLanguage(code: string, close: () => void) {
    user.language = code
    close()
}

const { mode: themeMode, setMode } = useThemeMode()
const themeOptions = computed(() => [
    { value: 'system', label: t('nav.themeSystem'), icon: 'i-lucide-monitor' },
    { value: 'light', label: t('nav.themeLight'), icon: 'i-lucide-sun' },
    { value: 'dark', label: t('nav.themeDark'), icon: 'i-lucide-moon' },
])
const themeIcon = computed(
    () => themeOptions.value.find((o) => o.value === themeMode.value)?.icon,
)
const setThemeMode = (next: string) => setMode(next as ThemeMode)

const avatarFile = ref<File | null>(null)
const avatarPreview = ref<string | null>(null)

const savedAvatarUrl = () =>
    user.avatar
        ? fileUrl('users', user, user.avatar, { thumb: '100x100' })
        : null

onMounted(() => {
    avatarPreview.value = savedAvatarUrl()
})

const bannerFile = ref<File | null>(null)
const bannerRemoved = ref(false)
const bannerPreview = ref<string | null>(null)

const savedBannerUrl = () =>
    user.banner
        ? fileUrl('users', user, user.banner, { thumb: '1600x400' })
        : null

onMounted(() => {
    bannerPreview.value = savedBannerUrl()
})

const revokeBlobUrl = (url: string | null | undefined) => {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
}
watch(avatarPreview, (_, previous) => revokeBlobUrl(previous))
watch(bannerPreview, (_, previous) => revokeBlobUrl(previous))
onBeforeUnmount(() => {
    revokeBlobUrl(avatarPreview.value)
    revokeBlobUrl(bannerPreview.value)
})

function selectBanner(file: File) {
    bannerFile.value = file
    bannerRemoved.value = false
    bannerPreview.value = URL.createObjectURL(file)
}

function removeBanner() {
    bannerFile.value = null
    bannerRemoved.value = !!user.banner
    bannerPreview.value = null
}

function resetBanner() {
    bannerFile.value = null
    bannerRemoved.value = false
    bannerPreview.value = savedBannerUrl()
}

function selectAvatar(file: File) {
    avatarFile.value = file
    avatarPreview.value = URL.createObjectURL(file)
}

const passwordChangeRequested = computed(
    () => !!(user.password || user.passwordConfirm),
)

const passwordFieldsValid = ref(false)

const showSecurityWarning = computed(
    () =>
        activeTab.value !== 'security' &&
        passwordChangeRequested.value &&
        !passwordFieldsValid.value,
)

const tabIcons: Record<Section, string> = {
    profile: 'i-lucide-user-pen',
    preferences: 'i-lucide-sliders-horizontal',
    notifications: 'i-lucide-bell',
    privacy: 'i-lucide-eye',
    security: 'i-lucide-shield-check',
}
const tabs = computed(() =>
    SECTIONS.map((section) => ({
        label: t(`account.tabs.${section}`),
        icon: tabIcons[section],
        value: section,
    })),
)
const selectedTab = computed({
    get: () => activeTab.value,
    set: (tab: Section) => navigateTo({ query: { tab } }),
})

const tabNav = useTemplateRef<HTMLElement>('tabNav')
watch(
    [activeTab, tabNav],
    () =>
        tabNav.value
            ?.querySelector('[data-state="active"]')
            ?.scrollIntoView({ block: 'nearest', inline: 'center' }),
    { flush: 'post' },
)

const validateProfile = (state: Record<string, unknown>) =>
    validateRules(state, {
        firstname: [required(t)],
        name: [required(t)],
        email: [required(t), validEmail(t)],
    })

const profileForm = ref<Form<EditableSelf> | null>(null)

const original = reactive({
    firstname: user.firstname,
    name: user.name,
    email: user.email,
    language: user.language,
})

const normalizedEmail = (value: unknown) =>
    String(value ?? '')
        .trim()
        .toLowerCase()

const emailChangeRequested = computed(
    () =>
        !!normalizedEmail(user.email) &&
        normalizedEmail(user.email) !== normalizedEmail(original.email),
)

const twoFactor = useTemplateRef<{
    namesChanged: boolean
    saveNames: () => Promise<void>
    resetNames: () => void
}>('twoFactor')

const sectionChanged = computed<Record<Section, boolean>>(() => ({
    profile:
        !!avatarFile.value ||
        !!bannerFile.value ||
        bannerRemoved.value ||
        emailChangeRequested.value ||
        user.firstname !== original.firstname ||
        user.name !== original.name,
    preferences: user.language !== original.language,
    notifications: false,
    privacy: false,
    security: passwordChangeRequested.value || !!twoFactor.value?.namesChanged,
}))

const hasChanges = computed(() =>
    Object.values(sectionChanged.value).some(Boolean),
)

function resetSection(section: Section) {
    if (section === 'profile') {
        user.firstname = original.firstname
        user.name = original.name
        user.email = original.email
        avatarFile.value = null
        avatarPreview.value = savedAvatarUrl()
        resetBanner()
    } else if (section === 'preferences') {
        user.language = original.language
    } else if (section === 'security') {
        user.oldPassword = ''
        user.password = ''
        user.passwordConfirm = ''
        twoFactor.value?.resetNames()
    }
}

const resetAll = () => SECTIONS.forEach(resetSection)

const canSave = (section: Section) =>
    sectionChanged.value[section] &&
    (section !== 'security' ||
        !passwordChangeRequested.value ||
        passwordFieldsValid.value)

const { discardDialogOpen, confirmDiscard, settleDiscard } = useDiscardConfirm(
    () => hasChanges.value,
)
onBeforeRouteLeave(() => confirmDiscard())

const { notify, error: notifyError } = useNotification()

const saving = ref(false)

async function saveUser(section: Section) {
    if (
        section === 'profile' &&
        (await profileForm.value?.validate({ silent: true })) === false
    )
        return

    if (section === 'security') {
        if (passwordChangeRequested.value && !passwordFieldsValid.value) return
        if (twoFactor.value?.namesChanged) {
            saving.value = true
            try {
                await twoFactor.value.saveNames()
            } catch {
                notifyError(t('notifications.error.edit'))
                saving.value = false
                return
            }
            saving.value = false
        }
        if (!passwordChangeRequested.value) {
            notify(t('notifications.success.edit'))
            return
        }
    }

    saving.value = true

    const requestedEmail = (user.email ?? '').trim()
    const wantsEmailChange = section === 'profile' && emailChangeRequested.value

    const formData = new FormData()
    if (section === 'profile') {
        formData.append('firstname', user.firstname ?? '')
        formData.append('name', user.name ?? '')
        if (avatarFile.value) formData.append('avatar', avatarFile.value)
        if (bannerFile.value) formData.append('banner', bannerFile.value)
        else if (bannerRemoved.value) formData.append('banner', '')
    } else if (section === 'preferences') {
        formData.append('language', user.language)
    }

    try {
        const updated =
            section === 'security'
                ? await changePassword({
                      oldPassword: user.oldPassword,
                      password: user.password,
                      passwordConfirm: user.passwordConfirm,
                  })
                : await updateMe(formData)

        if (section === 'profile') {
            user.firstname = updated.firstname
            user.name = updated.name
            user.avatar = updated.avatar
            avatarFile.value = null
            avatarPreview.value = savedAvatarUrl()
            user.banner = updated.banner
            resetBanner()
            original.firstname = updated.firstname
            original.name = updated.name
        } else if (section === 'preferences') {
            user.language = updated.language ?? ''
            original.language = updated.language ?? ''
            if (isLocaleCode(updated.language))
                await setLocale(updated.language)
        } else {
            resetSection('security')
        }

        if (wantsEmailChange) {
            try {
                await requestEmailChange(requestedEmail)
                notify(t('account.emailChangeSent'))
            } catch (mailError) {
                console.error('Error requesting email change:', mailError)
                notifyError(t('account.emailChangeFailed'))
            }
            user.email = original.email
        } else {
            notify(t('notifications.success.edit'))
        }
    } catch (err) {
        const code = (err as ApiError)?.response?.data?.oldPassword?.code
        if (code === 'validation_invalid_old_password') {
            notifyError(t('account.wrongOldPassword'))
        } else {
            notifyError(t('notifications.error.edit'))
        }
    } finally {
        saving.value = false
    }
}

const deleteDialog = ref(false)
const deleting = ref(false)
const deletePassword = ref('')

watch(deleteDialog, () => {
    deletePassword.value = ''
})

async function deleteAccount() {
    deleting.value = true
    try {
        await deleteMe(deletePassword.value)
        auth.clearAuth()
        deleteDialog.value = false
        resetAll()
        await navigateTo('/auth/login')
    } catch (err) {
        const code = (err as ApiError)?.response?.data?.password?.code
        if (code === 'validation_invalid_password') {
            notifyError(t('account.wrongOldPassword'))
        } else {
            console.error('Error deleting account:', err)
            notifyError(t('notifications.error.delete'))
        }
    } finally {
        deleting.value = false
    }
}
</script>

<style scoped>
.locale-code {
    min-width: 28px;
    padding: 2px 0;
    border-radius: 6px;
    border: 1px solid
        color-mix(in oklab, var(--ui-text-highlighted) 20%, transparent);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-align: center;
    color: color-mix(in oklab, var(--ui-text-highlighted) 70%, transparent);
}
</style>
