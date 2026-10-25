<template>
    <LayoutDialogShell
        v-model="open"
        :title="t('users.edit')"
        :max-width="600"
        sheet-on-mobile
        closable
        data-testid="platform-user-dialog"
        :submit-label="t('actions.save')"
        :submit-loading="saving"
        :submit-disabled="locked || (emailChanged && !adminPassword)"
        submit-test-id="platform-user-save"
        cancel-test-id="platform-user-cancel"
        @submit="userForm?.submit()"
    >
        <template v-if="user">
            <UForm
                ref="userForm"
                :state="form"
                :validate="validateUser"
                :disabled="locked"
                class="flex flex-col gap-4"
                @submit="saveUser"
            >
                <UserAvatarPicker
                    :preview="avatarPreview"
                    removable
                    test-id-prefix="platform-user"
                    @select="selectAvatar"
                    @remove="removeAvatar"
                />
                <div class="grid gap-3 sm:grid-cols-2">
                    <UFormField
                        :label="t('account.firstname')"
                        name="firstname"
                    >
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
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                    <UFormField :label="t('account.username')" name="username">
                        <UInput
                            v-model="form.username"
                            autocomplete="off"
                            class="w-full"
                            data-testid="platform-user-username"
                        />
                    </UFormField>
                    <UFormField :label="t('account.email')" name="email">
                        <UInput
                            v-model="form.email"
                            type="email"
                            autocomplete="off"
                            :disabled="ownAccount"
                            class="w-full"
                            data-testid="platform-user-email"
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
                </div>
                <div class="flex flex-wrap gap-2">
                    <UButton
                        color="neutral"
                        variant="soft"
                        icon="i-lucide-key-round"
                        :loading="sendingReset"
                        :disabled="locked || !user.email"
                        data-testid="platform-user-password-reset"
                        @click="sendPasswordReset"
                    >
                        {{ t('platform.users.sendPasswordReset') }}
                    </UButton>
                </div>
            </UForm>
        </template>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import { avatarUrl } from '~/utils/avatar'
import { THUMBS } from '#shared/utils/thumbs'
import { useObjectUrl } from '@vueuse/core'
import type { Form } from '@nuxt/ui'
import type { UserRecord } from '~/types/models'
import { updatePlatformUser } from '~/api/platform'
import { requestPasswordReset, useAuthState } from '~/api/auth'
import type { PlatformUser } from '~/utils/platformUsers'
import {
    required,
    validEmail,
    validUsername,
    validateRules,
} from '~/utils/validation'

const open = defineModel<boolean>({ default: false })
const props = defineProps<{ user: PlatformUser | null }>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()

const authState = useAuthState()
const ownAccount = computed(
    () => !!props.user && props.user.id === authState.currentUserId(),
)
const locked = computed(() => !!props.user?.platform_admin && !ownAccount.value)

function formFrom(user: UserRecord | null) {
    return {
        username: user?.username ?? '',
        firstname: user?.firstname ?? '',
        name: user?.name ?? '',
        email: user?.email ?? '',
        verified: !!user?.verified,
    }
}

const form = reactive(formFrom(props.user))
const {
    password: adminPassword,
    reset: resetPassword,
    confirm: reauthenticate,
    errorText: reauthError,
} = useReauth()
const emailChanged = computed(
    () => !!props.user && form.email.trim() !== (props.user.email ?? ''),
)
const userForm = ref<Form<typeof form> | null>(null)

watch([open, () => props.user?.id], () => {
    Object.assign(form, formFrom(props.user))
    avatarFile.value = null
    avatarRemoved.value = false
    resetPassword()
})

const avatarFile = ref<File | null>(null)
const avatarRemoved = ref(false)
const avatarObjectUrl = useObjectUrl(avatarFile)
const avatarPreview = computed(() => {
    if (avatarFile.value) return avatarObjectUrl.value ?? null
    if (avatarRemoved.value || !props.user?.avatar) return null
    return avatarUrl(props.user, THUMBS.avatarLarge)
})

function selectAvatar(file: File) {
    avatarFile.value = file
    avatarRemoved.value = false
}

function removeAvatar() {
    avatarFile.value = null
    avatarRemoved.value = true
}

function validateUser(state: typeof form) {
    return validateRules(state, {
        username: validUsername(t),
        email: [required(t), validEmail(t)],
    })
}

const { pending: saving, run: runSave } = useAsyncAction()

async function saveUser() {
    const user = props.user
    if (!user) return
    const saved = await runSave(
        async () => {
            if (emailChanged.value) await reauthenticate()
            await updatePlatformUser(
                user.id,
                {
                    ...(form.username.trim() !== user.username && {
                        username: form.username.trim(),
                    }),
                    firstname: form.firstname.trim(),
                    name: form.name.trim(),
                    verified: form.verified,
                    ...(emailChanged.value && { email: form.email.trim() }),
                },
                {
                    ...(avatarFile.value && { avatar: avatarFile.value }),
                    ...(avatarRemoved.value && { avatar: null }),
                },
            )
            return true
        },
        {
            success: t('notifications.success.edit'),
            error: reauthError(t('notifications.error.edit')),
        },
    )
    if (!saved) return
    open.value = false
    emit('changed')
}

const { pending: sendingReset, run: runReset } = useAsyncAction()
const { capHeaders } = useCapToken()

async function sendPasswordReset() {
    const email = props.user?.email
    if (!email) return
    await runReset(
        async () =>
            requestPasswordReset(email, await capHeaders('password-reset')),
        {
            success: t('platform.users.passwordResetSent'),
            error: t('notifications.error.resetPassword'),
        },
    )
}
</script>
