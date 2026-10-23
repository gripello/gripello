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
                    <UButton
                        color="neutral"
                        variant="soft"
                        icon="i-lucide-ban"
                        :disabled="!!user.platform_admin"
                        data-testid="platform-user-suspend-account"
                        @click="emit('suspend', user.id)"
                    >
                        {{ t('platform.users.suspend') }}
                    </UButton>
                    <UButton
                        color="error"
                        variant="soft"
                        icon="i-lucide-trash-2"
                        :disabled="!!user.platform_admin"
                        data-testid="platform-user-delete-account"
                        @click="emit('delete', user.id)"
                    >
                        {{ t('users.delete') }}
                    </UButton>
                </div>
            </UForm>

            <PlatformUserSecurity :user="user" @changed="emit('changed')" />

            <section class="mt-6 flex flex-col gap-3">
                <h3 class="text-sm font-semibold text-highlighted">
                    {{ t('platform.users.memberships') }}
                </h3>
                <LayoutListGroup
                    v-if="chips.length"
                    data-testid="platform-user-memberships"
                >
                    <li
                        v-for="chip in chips"
                        :key="chip.id"
                        class="flex flex-wrap items-center gap-2 px-4 py-3"
                        :data-testid="`platform-user-membership-${chip.gym}`"
                    >
                        <span
                            class="min-w-0 basis-full sm:basis-0 sm:flex-1 truncate text-sm font-medium"
                        >
                            {{ chip.gymTitle }}
                        </span>
                        <USelect
                            :model-value="chip.role"
                            :items="roleItems(chip.gym)"
                            value-key="value"
                            :aria-label="t('members.role')"
                            class="min-w-0 flex-1 sm:w-40 sm:flex-none"
                            :disabled="membershipBusy"
                            data-testid="platform-user-membership-role"
                            @update:model-value="
                                (role) => changeRole(chip, String(role))
                            "
                        />
                        <UButton
                            icon="i-lucide-user-minus"
                            color="error"
                            variant="ghost"
                            class="icon-btn"
                            :aria-label="t('members.remove')"
                            :disabled="membershipBusy"
                            data-testid="platform-user-membership-remove"
                            @click="removeMembership(chip)"
                        />
                    </li>
                </LayoutListGroup>
                <div
                    v-if="joinable.length"
                    class="flex flex-wrap items-center gap-2"
                >
                    <USelect
                        v-model="newMembership.gym"
                        :items="joinable"
                        value-key="value"
                        :placeholder="t('platform.users.gym')"
                        :aria-label="t('platform.users.gym')"
                        class="min-w-0 basis-full sm:basis-0 sm:flex-1"
                        data-testid="platform-user-add-gym"
                    />
                    <USelect
                        v-model="newMembership.role"
                        :items="roleItems(newMembership.gym)"
                        value-key="value"
                        :placeholder="t('members.role')"
                        :aria-label="t('members.role')"
                        :disabled="!newMembership.gym"
                        class="min-w-0 flex-1 sm:w-40 sm:flex-none"
                        data-testid="platform-user-add-role"
                    />
                    <UButton
                        icon="i-lucide-plus"
                        color="primary"
                        variant="soft"
                        :loading="membershipBusy"
                        :disabled="!newMembership.gym || !newMembership.role"
                        data-testid="platform-user-add-membership"
                        @click="grantMembership"
                    >
                        {{ t('platform.users.addMembership') }}
                    </UButton>
                </div>
            </section>
        </template>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import { avatarUrl } from '~/utils/avatar'
import { THUMBS } from '#shared/utils/thumbs'
import { useObjectUrl } from '@vueuse/core'
import type { Form } from '@nuxt/ui'
import {
    changeMembershipRole,
    addMembership,
    deleteMembership,
} from '~/api/members'
import type { GymRecord, RoleRecord, UserRecord } from '~/types/models'
import { updatePlatformUser } from '~/api/platform'
import { requestPasswordReset, useAuthState } from '~/api/auth'
import { gymTitle } from '~/utils/gymNames'
import {
    joinableGyms,
    membershipChips,
    rolesOfGym,
    type MembershipChip,
    type PlatformUser,
} from '~/utils/platformUsers'
import {
    required,
    validEmail,
    validUsername,
    validateRules,
} from '~/utils/validation'

const open = defineModel<boolean>({ default: false })
const props = defineProps<{
    user: PlatformUser | null
    gyms: GymRecord[]
    roles: RoleRecord[]
}>()
const emit = defineEmits<{
    changed: []
    delete: [id: string]
    suspend: [id: string]
}>()

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
const newMembership = reactive({ gym: '', role: '' })

watch([open, () => props.user?.id], () => {
    Object.assign(form, formFrom(props.user))
    Object.assign(newMembership, { gym: '', role: '' })
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

watch(
    () => newMembership.gym,
    (gym) => {
        const gymRoles = rolesOfGym(props.roles, gym)
        newMembership.role =
            gymRoles.find((role) => role.name !== 'admin')?.id ??
            gymRoles[0]?.id ??
            ''
    },
)

const chips = computed(() =>
    props.user ? membershipChips(props.user, props.gyms, props.roles) : [],
)
const joinable = computed(() =>
    joinableGyms(chips.value, props.gyms).map((gym) => ({
        label: gymTitle(gym),
        value: gym.id,
    })),
)

function roleItems(gymId: string) {
    return rolesOfGym(props.roles, gymId).map((role) => ({
        label: role.name,
        value: role.id,
    }))
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

const { pending: membershipBusy, run: runMembership } = useAsyncAction()

function membershipError(error: unknown) {
    return (error as { status?: number })?.status === 400
        ? t('platform.users.lastAdmin')
        : t('notifications.error.generic')
}

async function updateMemberships(
    action: () => Promise<unknown>,
    error: string | ((error: unknown) => string) = membershipError,
) {
    const done = await runMembership(
        async () => {
            await action()
            return true
        },
        {
            success: t('notifications.success.edit'),
            error,
        },
    )
    if (done) emit('changed')
}

function changeRole(chip: MembershipChip, role: string) {
    if (role === chip.role) return
    return updateMemberships(() => changeMembershipRole(chip.id, role))
}

function removeMembership(chip: MembershipChip) {
    return updateMemberships(() => deleteMembership(chip.id))
}

async function grantMembership() {
    const user = props.user
    if (!user) return
    await updateMemberships(
        () =>
            addMembership({
                user: user.id,
                gym: newMembership.gym,
                role: newMembership.role,
            }),
        t('notifications.error.generic'),
    )
    Object.assign(newMembership, { gym: '', role: '' })
}
</script>
