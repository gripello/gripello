<template>
    <section class="flex flex-col gap-3" data-testid="platform-user-security">
        <USwitch
            :model-value="!!user.platform_admin"
            :label="t('platform.users.platformAdmin')"
            :disabled="state.isSelf"
            data-testid="platform-user-platform-admin"
            @update:model-value="
                (on) => request(on ? 'grantAdmin' : 'revokeAdmin')
            "
        />
        <div v-if="state.canAct" class="flex flex-wrap gap-2">
            <UBadge
                v-if="state.locked"
                color="warning"
                variant="subtle"
                icon="i-lucide-lock"
                data-testid="platform-user-locked"
            >
                {{ t('platform.users.locked') }}
            </UBadge>
            <UButton
                v-if="state.locked"
                color="neutral"
                variant="soft"
                icon="i-lucide-lock-open"
                :loading="busy && action === 'unlock'"
                data-testid="platform-user-unlock"
                @click="perform('unlock')"
            >
                {{ t('platform.users.unlock') }}
            </UButton>
            <UButton
                color="neutral"
                variant="soft"
                icon="i-lucide-log-out"
                :disabled="!state.sessions"
                data-testid="platform-user-revoke-sessions"
                @click="request('revokeSessions')"
            >
                {{ t('platform.users.revokeSessions') }}
            </UButton>
            <UButton
                color="neutral"
                variant="soft"
                icon="i-lucide-shield-off"
                :disabled="!state.mfa"
                data-testid="platform-user-reset-mfa"
                @click="request('resetMfa')"
            >
                {{ t('platform.users.resetMfa') }}
            </UButton>
            <UButton
                color="neutral"
                variant="soft"
                icon="i-lucide-key-square"
                data-testid="platform-user-set-password"
                @click="request('setPassword')"
            >
                {{ t('platform.users.setPassword') }}
            </UButton>
        </div>

        <LayoutDialogShell
            :model-value="!!action && action !== 'unlock'"
            :title="action ? t(`platform.users.actions.${action}.title`) : ''"
            :max-width="440"
            data-testid="platform-user-security-dialog"
            @update:model-value="(isOpen: boolean) => !isOpen && close()"
            :submit-label="
                action ? t(`platform.users.actions.${action}.confirm`) : ''
            "
            :submit-color="action === 'grantAdmin' ? 'primary' : 'error'"
            :submit-loading="busy"
            :submit-disabled="!canConfirm"
            submit-test-id="platform-user-security-confirm"
            cancel-test-id="platform-user-security-cancel"
            @submit="confirmAction"
        >
            <div class="flex flex-col gap-4">
                <p
                    v-if="action && action !== 'unlock'"
                    class="text-sm text-muted"
                >
                    {{
                        t(`platform.users.actions.${action}.message`, {
                            name: displayName(user),
                        })
                    }}
                </p>
                <UserPasswordChangeFields
                    v-if="action === 'setPassword'"
                    v-model:password="dialog.password"
                    v-model:password-confirm="dialog.passwordConfirm"
                    :require-old-password="false"
                    @validity="dialog.passwordValid = $event"
                />
                <UserReauthField
                    v-if="needsPassword"
                    v-model="adminPassword"
                    data-testid="platform-user-admin-password"
                />
            </div>
        </LayoutDialogShell>
    </section>
</template>

<script setup lang="ts">
import { displayName } from '~/utils/avatar'
import { useAuthState } from '~/api/auth'
import {
    clearUserLockout,
    grantPlatformAdmin,
    resetUserMfa,
    revokePlatformAdmin,
    revokeUserSessions,
    setUserPassword,
} from '~/api/platform'
import { userSecurityState, type PlatformUser } from '~/utils/platformUsers'

type SecurityAction =
    | 'unlock'
    | 'revokeSessions'
    | 'resetMfa'
    | 'setPassword'
    | 'grantAdmin'
    | 'revokeAdmin'

const props = defineProps<{ user: PlatformUser }>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()

const state = computed(() =>
    userSecurityState(props.user, useAuthState().currentUserId() ?? ''),
)

const action = ref<SecurityAction | null>(null)
const {
    password: adminPassword,
    confirm: reauthenticate,
    errorText: reauthError,
} = useReauth(action)
const dialog = reactive({
    password: '',
    passwordConfirm: '',
    passwordValid: false,
})

const PASSWORDLESS: SecurityAction[] = ['unlock', 'revokeSessions']
const needsPassword = computed(
    () => !!action.value && !PASSWORDLESS.includes(action.value),
)
const canConfirm = computed(
    () =>
        (!needsPassword.value || !!adminPassword.value) &&
        (action.value !== 'setPassword' || dialog.passwordValid),
)

function request(next: SecurityAction) {
    Object.assign(dialog, {
        password: '',
        passwordConfirm: '',
        passwordValid: false,
    })
    action.value = next
}

function close() {
    action.value = null
}

const { pending: busy, run } = useAsyncAction()

const calls: Record<SecurityAction, (id: string) => Promise<unknown>> = {
    unlock: clearUserLockout,
    revokeSessions: revokeUserSessions,
    resetMfa: resetUserMfa,
    setPassword: (id) =>
        setUserPassword(id, dialog.password, dialog.passwordConfirm),
    grantAdmin: grantPlatformAdmin,
    revokeAdmin: revokePlatformAdmin,
}

async function perform(next: SecurityAction) {
    action.value = next
    const done = await run(
        async () => {
            if (needsPassword.value) await reauthenticate()
            await calls[next](props.user.id)
            return true
        },
        {
            success: t(`platform.users.actions.${next}.done`),
            error: reauthError(t('notifications.error.generic')),
        },
    )
    if (done) {
        close()
        emit('changed')
    } else if (next === 'unlock') close()
}

function confirmAction() {
    if (action.value && canConfirm.value) return perform(action.value)
}
</script>
