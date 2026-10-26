<template>
    <UForm
        ref="userForm"
        :state="form"
        :validate="validateUser"
        :disabled="locked"
        class="flex flex-col gap-4"
        data-testid="platform-user-profile"
        @submit="saveUser"
    >
        <UserProfileImages
            v-if="!locked"
            :banner="bannerPreview"
            :avatar="avatarPreview"
            :name="displayName(form, '?')"
            :user-id="user.id"
            removable-avatar
            @banner="selectBanner"
            @remove-banner="removeBanner"
            @avatar="selectAvatar"
            @remove-avatar="removeAvatar"
        />
        <div class="grid grid-cols-2 gap-3">
            <UFormField :label="t('account.firstname')" name="firstname">
                <UInput
                    v-model="form.firstname"
                    class="w-full"
                    data-testid="platform-user-firstname"
                />
            </UFormField>
            <UFormField :label="t('account.lastname')" name="name">
                <UInput
                    v-model="form.name"
                    class="w-full"
                    data-testid="platform-user-lastname"
                />
            </UFormField>
            <UFormField
                :label="t('account.email')"
                name="email"
                class="col-span-2"
            >
                <UInput
                    v-model="form.email"
                    type="email"
                    autocomplete="off"
                    :disabled="locked || ownAccount"
                    class="w-full"
                    data-testid="platform-user-email"
                />
            </UFormField>
            <UFormField :label="t('account.username')" name="username">
                <UInput
                    v-model="form.username"
                    autocomplete="off"
                    class="w-full"
                    data-testid="platform-user-username"
                />
            </UFormField>
            <UFormField :label="t('accountSettings.language')" name="language">
                <USelect
                    v-model="language"
                    :items="languages"
                    class="w-full"
                    data-testid="platform-user-language"
                />
            </UFormField>
        </div>
        <UserReauthField
            v-if="emailChanged"
            v-model="adminPassword"
            data-testid="platform-user-email-admin-password"
        />
        <div class="flex flex-wrap gap-x-6 gap-y-3">
            <USwitch
                v-model="form.verified"
                :label="t('platform.users.verified')"
                data-testid="platform-user-verified"
            />
            <USwitch
                v-model="form.email_visibility"
                :label="t('platform.users.emailVisible')"
                data-testid="platform-user-email-visible"
            />
        </div>
        <div v-if="dirty" class="flex items-center gap-2">
            <UButton
                color="neutral"
                variant="ghost"
                class="ms-auto"
                :disabled="saving"
                data-testid="platform-user-discard"
                @click="discard"
            >
                {{ t('platform.users.discard') }}
            </UButton>
            <UButton
                type="submit"
                :loading="saving"
                :disabled="emailChanged && !adminPassword"
                data-testid="platform-user-save"
            >
                {{ t('actions.save') }}
            </UButton>
        </div>
    </UForm>
</template>

<script setup lang="ts">
import { useObjectUrl } from '@vueuse/core'
import type { Form } from '@nuxt/ui'
import { fileUrl } from '~/api/client'
import { updatePlatformUser } from '~/api/platform'
import { useAuthState } from '~/api/auth'
import { avatarUrl, displayName } from '~/utils/avatar'
import { SUPPORTED_LOCALES } from '~/utils/locales'
import { changedFields } from '~/utils/routes'
import type { PlatformUser } from '~/utils/platformUsers'
import { THUMBS } from '#shared/utils/thumbs'
import {
    required,
    validEmail,
    validUsername,
    validateRules,
} from '~/utils/validation'

const BROWSER_LANGUAGE = 'browser'

const props = defineProps<{ user: PlatformUser }>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()

const authState = useAuthState()
const ownAccount = computed(() => props.user.id === authState.currentUserId())
const locked = computed(() => !!props.user.platform_admin && !ownAccount.value)

function formFrom(user: PlatformUser) {
    return {
        username: user.username ?? '',
        firstname: user.firstname ?? '',
        name: user.name ?? '',
        email: user.email ?? '',
        language: user.language ?? '',
        verified: !!user.verified,
        email_visibility: !!user.email_visibility,
    }
}

const {
    form,
    pristine,
    hasChanges,
    reset: resetForm,
    commit,
} = useDraft(() => props.user, formFrom)

const languages = computed(() => [
    { value: BROWSER_LANGUAGE, label: t('platform.users.browserLanguage') },
    ...SUPPORTED_LOCALES.map((l) => ({ value: l.code, label: l.name })),
])
const language = computed({
    get: () => form.language || BROWSER_LANGUAGE,
    set: (value: string) => {
        form.language = (
            value === BROWSER_LANGUAGE ? '' : value
        ) as typeof form.language
    },
})

const {
    password: adminPassword,
    reset: resetPassword,
    confirm: reauthenticate,
    errorText: reauthError,
} = useReauth()
const emailChanged = computed(
    () => form.email.trim() !== (props.user.email ?? ''),
)
const userForm = ref<Form<typeof form> | null>(null)

const avatarFile = ref<File | null>(null)
const avatarRemoved = ref(false)
const avatarObjectUrl = useObjectUrl(avatarFile)
const avatarPreview = computed(() => {
    if (avatarFile.value) return avatarObjectUrl.value ?? null
    if (avatarRemoved.value || !props.user.avatar) return null
    return avatarUrl(props.user, THUMBS.avatarLarge)
})

const bannerFile = ref<File | null>(null)
const bannerRemoved = ref(false)
const bannerObjectUrl = useObjectUrl(bannerFile)
const bannerPreview = computed(() => {
    if (bannerFile.value) return bannerObjectUrl.value ?? null
    if (bannerRemoved.value || !props.user.banner) return null
    return fileUrl('users', props.user, props.user.banner, {
        thumb: THUMBS.banner,
    })
})

const imagesChanged = computed(
    () =>
        !!avatarFile.value ||
        avatarRemoved.value ||
        !!bannerFile.value ||
        bannerRemoved.value,
)
const dirty = computed(() => hasChanges.value || imagesChanged.value)

function selectAvatar(file: File) {
    avatarFile.value = file
    avatarRemoved.value = false
}

function removeAvatar() {
    avatarFile.value = null
    avatarRemoved.value = !!props.user.avatar
}

function selectBanner(file: File) {
    bannerFile.value = file
    bannerRemoved.value = false
}

function removeBanner() {
    bannerFile.value = null
    bannerRemoved.value = !!props.user.banner
}

function discard() {
    resetForm()
    avatarFile.value = null
    avatarRemoved.value = false
    bannerFile.value = null
    bannerRemoved.value = false
    resetPassword()
}

function validateUser(state: typeof form) {
    return validateRules(state, {
        username: validUsername(t),
        email: [required(t), validEmail(t)],
    })
}

const { pending: saving, run: runSave } = useAsyncAction()

async function saveUser() {
    if (saving.value || locked.value) return
    const patch = changedFields(
        {
            ...form,
            username: form.username.trim(),
            firstname: form.firstname.trim(),
            name: form.name.trim(),
            email: form.email.trim(),
        },
        pristine.value,
    )
    const saved = await runSave(
        async () => {
            if (emailChanged.value) await reauthenticate()
            return updatePlatformUser(props.user.id, patch, {
                ...(avatarFile.value && { avatar: avatarFile.value }),
                ...(avatarRemoved.value && { avatar: null }),
                ...(bannerFile.value && { banner: bannerFile.value }),
                ...(bannerRemoved.value && { banner: null }),
            })
        },
        {
            success: t('notifications.success.edit'),
            error: reauthError(t('notifications.error.edit')),
        },
    )
    if (!saved) return
    commit(saved)
    discard()
    emit('changed')
}
</script>
