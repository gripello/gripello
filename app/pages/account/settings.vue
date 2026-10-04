<template>
    <div
        class="w-full px-4 pt-4"
        :class="{ 'max-lg:pb-24': sectionChanged[activeTab] }"
        data-testid="settings-page"
    >
        <div data-testid="profile-header">
            <LayoutPageHeader :title="t('accountSettings.title')" />
            <nav ref="tabNav" class="account-tabs">
                <UNavigationMenu
                    :items="tabs"
                    highlight
                    class="w-max min-w-full border-b border-default"
                />
            </nav>
        </div>

        <div class="flex flex-col gap-4 sm:gap-6 pb-8">
            <LayoutSaveBar
                :show="sectionChanged[activeTab]"
                :loading="saving"
                :disabled="!canSave(activeTab) || saving"
                test-id-prefix="profile"
                cancelable
                @save="saveUser(activeTab)"
                @cancel="resetSection(activeTab)"
            />

            <UPageCard :title="sectionTitle" variant="naked" />

            <UPageCard v-if="activeTab === 'profile'" variant="subtle">
                <UForm
                    ref="profileForm"
                    :state="user"
                    :validate="validateProfile"
                    class="grid gap-5 lg:grid-cols-2"
                >
                    <UFormField
                        :label="t('accountSettings.avatar')"
                        :description="t('accountSettings.avatarDescription')"
                        class="flex flex-row-reverse items-center justify-end gap-4 lg:col-span-2"
                    >
                        <UserAvatarPicker
                            :preview="avatarPreview"
                            test-id-prefix="profile"
                            @select="selectAvatar"
                        />
                    </UFormField>
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
                variant="subtle"
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

            <template v-else>
                <UPageCard variant="subtle" :ui="{ container: 'gap-y-4' }">
                    <UserPasswordChangeFields
                        class="lg:grid lg:grid-cols-2 lg:gap-x-6 lg:[&>*:nth-child(2)]:col-start-1"
                        v-model:old-password="user.oldPassword"
                        v-model:password="user.password"
                        v-model:password-confirm="user.passwordConfirm"
                        :require-old-password="true"
                        @validity="passwordFieldsValid = $event"
                    />
                </UPageCard>

                <UPageCard
                    :title="t('account.deleteAccount')"
                    :description="t('account.deleteAccountHint')"
                    variant="subtle"
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
        />

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
import type { ClientResponseError } from 'pocketbase'
import type { Form, NavigationMenuItem } from '@nuxt/ui'
import { SUPPORTED_LOCALES, isLocaleCode } from '~/utils/locales'
import type { ThemeMode } from '~/composables/useThemeMode'
import type { UserRecord } from '~/types/models'

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

const pb = usePocketbase()
const authRecord = pb.authStore.record as UserRecord | null

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
    user.avatar ? usePbFileUrl(user, user.avatar, { thumb: '100x100' }) : null

onMounted(() => {
    avatarPreview.value = savedAvatarUrl()
})

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

const tabs = computed<NavigationMenuItem[]>(() => [
    {
        label: t('account.tabs.profile'),
        icon: 'i-lucide-user-pen',
        to: { query: { tab: 'profile' } },
        active: activeTab.value === 'profile',
        'data-testid': 'profile-tab-profile',
    },
    {
        label: t('account.tabs.preferences'),
        icon: 'i-lucide-sliders-horizontal',
        to: { query: { tab: 'preferences' } },
        active: activeTab.value === 'preferences',
        'data-testid': 'profile-tab-preferences',
    },
    {
        label: t('account.tabs.notifications'),
        icon: 'i-lucide-bell',
        to: { query: { tab: 'notifications' } },
        active: activeTab.value === 'notifications',
        'data-testid': 'profile-tab-notifications',
    },
    {
        label: t('account.tabs.security'),
        icon: 'i-lucide-shield-check',
        to: { query: { tab: 'security' } },
        active: activeTab.value === 'security',
        chip: showSecurityWarning.value ? { color: 'warning' } : undefined,
        'data-testid': 'profile-tab-security',
    },
])

const tabNav = useTemplateRef<HTMLElement>('tabNav')
watch(
    [activeTab, tabNav],
    () =>
        tabNav.value
            ?.querySelector('[aria-current="page"]')
            ?.scrollIntoView({ block: 'nearest', inline: 'center' }),
    { flush: 'post' },
)

const sectionTitle = computed(
    () =>
        ({
            profile: t('account.tabs.profile'),
            preferences: t('account.tabs.preferences'),
            notifications: t('account.tabs.notifications'),
            security: t('account.password'),
        })[activeTab.value],
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

const sectionChanged = computed<Record<Section, boolean>>(() => ({
    profile:
        !!avatarFile.value ||
        emailChangeRequested.value ||
        user.firstname !== original.firstname ||
        user.name !== original.name,
    preferences: user.language !== original.language,
    notifications: false,
    security: passwordChangeRequested.value,
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
    } else if (section === 'preferences') {
        user.language = original.language
    } else if (section === 'security') {
        user.oldPassword = ''
        user.password = ''
        user.passwordConfirm = ''
    }
}

const resetAll = () => SECTIONS.forEach(resetSection)

const canSave = (section: Section) =>
    sectionChanged.value[section] &&
    (section !== 'security' || passwordFieldsValid.value)

const { discardDialogOpen, confirmDiscard, settleDiscard } = useDiscardConfirm(
    () => hasChanges.value,
)
onBeforeRouteLeave(() => confirmDiscard())

const { notify, error: notifyError } = useNotification()
const { capHeaders } = useCapToken()

const saving = ref(false)

async function saveUser(section: Section) {
    if (
        section === 'profile' &&
        (await profileForm.value?.validate({ silent: true })) === false
    )
        return

    if (section === 'security' && !passwordFieldsValid.value) return

    saving.value = true

    const requestedEmail = (user.email ?? '').trim()
    const wantsEmailChange = section === 'profile' && emailChangeRequested.value

    const formData = new FormData()
    if (section === 'profile') {
        formData.append('firstname', user.firstname ?? '')
        formData.append('name', user.name ?? '')
        if (avatarFile.value) formData.append('avatar', avatarFile.value)
    } else if (section === 'preferences') {
        formData.append('language', user.language)
    } else {
        formData.append('oldPassword', user.oldPassword)
        formData.append('password', user.password)
        formData.append('passwordConfirm', user.passwordConfirm)
    }

    try {
        const updated = await pb.collection('users').update(user.id, formData)

        const newPassword = section === 'security' ? user.password : ''
        if (section === 'profile') {
            user.firstname = updated.firstname
            user.name = updated.name
            user.avatar = updated.avatar
            avatarFile.value = null
            avatarPreview.value = savedAvatarUrl()
            original.firstname = updated.firstname
            original.name = updated.name
        } else if (section === 'preferences') {
            user.language = updated.language
            original.language = updated.language
            if (isLocaleCode(updated.language))
                await setLocale(updated.language)
        } else {
            resetSection('security')
        }

        if (newPassword) {
            const reauthenticated = await capHeaders('login')
                .then((headers) =>
                    pb
                        .collection('users')
                        .authWithPassword(
                            updated.email || original.email,
                            newPassword,
                            { headers },
                        ),
                )
                .then(
                    () => true,
                    () => false,
                )
            if (!reauthenticated) {
                pb.authStore.clear()
                notifyError(t('account.passwordChangedSignInAgain'))
                resetAll()
                await navigateTo('/auth/login')
                return
            }
        } else {
            pb.authStore.save(pb.authStore.token, updated)
        }

        if (wantsEmailChange) {
            try {
                await pb.collection('users').requestEmailChange(requestedEmail)
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
        const code = (err as ClientResponseError)?.response?.data?.oldPassword
            ?.code
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

async function deleteAccount() {
    deleting.value = true
    try {
        await pb.collection('users').delete(user.id)
        pb.authStore.clear()
        deleteDialog.value = false
        resetAll()
        await navigateTo('/auth/login')
    } catch (err) {
        console.error('Error deleting account:', err)
        notifyError(t('notifications.error.delete'))
    } finally {
        deleting.value = false
    }
}
</script>

<style scoped>
.account-tabs {
    position: sticky;
    top: calc(var(--app-top) + var(--app-top-inset, 0px));
    z-index: 10;
    margin: 0 -16px 24px;
    padding: 0 16px;
    overflow-x: auto;
    background: var(--app-bg);
    scrollbar-width: none;
}

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
