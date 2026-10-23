<template>
    <section class="flex flex-col">
        <LayoutEyebrow>{{ t('account.sessions.title') }}</LayoutEyebrow>
        <LayoutEmptyState
            v-if="loadError"
            variant="error"
            :title="t('errors.loadFailed')"
            data-testid="sessions-load-error"
        >
            <template #actions>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-refresh-cw"
                    @click="load"
                >
                    {{ t('errors.retry') }}
                </UButton>
            </template>
        </LayoutEmptyState>
        <LayoutLoadingState v-else-if="!loaded" :count="2" />
        <LayoutListGroup v-else data-testid="sessions">
            <LayoutListRow
                v-for="session in sessions"
                :key="session.id"
                dense
                :icon="
                    isMobileDevice(label(session))
                        ? 'i-lucide-smartphone'
                        : 'i-lucide-monitor'
                "
                :icon-active="session.id === currentId"
                data-testid="session-row"
            >
                <div class="min-w-0 flex-1">
                    <p
                        class="flex items-center gap-2 text-sm font-medium text-highlighted"
                    >
                        <span class="truncate">{{ label(session) }}</span>
                        <UBadge
                            v-if="session.id === currentId"
                            :label="t('account.sessions.thisDevice')"
                            variant="subtle"
                            size="sm"
                            data-testid="session-current"
                        />
                    </p>
                    <p class="truncate text-xs text-muted">
                        {{
                            [session.ip, timeAgo(session.last_seen, t, locale)]
                                .filter(Boolean)
                                .join(' · ')
                        }}
                    </p>
                </div>
                <UButton
                    v-if="session.id !== currentId"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-log-out"
                    class="icon-btn"
                    :aria-label="
                        t('account.sessions.signOut', {
                            device: label(session),
                        })
                    "
                    :loading="revoking === session.id"
                    data-testid="session-revoke"
                    @click="revoke(session)"
                />
            </LayoutListRow>
            <li v-if="sessions.length > 1" class="flex justify-end px-4 py-3">
                <UButton
                    color="error"
                    variant="soft"
                    icon="i-lucide-log-out"
                    :loading="signOutOthers.pending.value"
                    data-testid="sessions-sign-out-others"
                    @click="confirmOthers = true"
                >
                    {{ t('account.sessions.signOutOthers') }}
                </UButton>
            </li>
        </LayoutListGroup>

        <ConfirmDialog
            v-model="confirmOthers"
            :title="t('account.sessions.signOutOthers')"
            :message="t('account.sessions.signOutOthersConfirm')"
            :confirm-text="t('account.sessions.signOutOthers')"
            :loading="signOutOthers.pending.value"
            @confirm="revokeOthers"
        />
    </section>
</template>

<script setup lang="ts">
import { timeAgo } from '#shared/utils/formatting'
import { deviceLabel, isMobileDevice } from '~/utils/push'
import { currentSessionId } from '~/utils/session'
import type { SessionRecord } from '~/types/models'
import {
    listSessions,
    revokeSession,
    signOutOtherSessions,
} from '~/api/account'
import { useAuthState } from '~/api/auth'

const { t, locale } = useI18n()
const { token, onAuthChange } = useAuthState()
const { error: notifyError } = useNotification()
const signOutOthers = useAsyncAction()

const sessions = ref<SessionRecord[]>([])
const loadError = ref(false)
const loaded = ref(false)
const revoking = ref('')
const confirmOthers = ref(false)
const currentId = ref(currentSessionId(token()))
const stopAuthWatch = onAuthChange(
    (changed) => (currentId.value = currentSessionId(changed)),
)
onBeforeUnmount(stopAuthWatch)

function label(session: SessionRecord) {
    return (
        deviceLabel(session.user_agent ?? '') ||
        t('account.sessions.unknownDevice')
    )
}

async function load() {
    try {
        const list = await listSessions()
        sessions.value = list.sort(
            (a, b) =>
                Number(b.id === currentId.value) -
                Number(a.id === currentId.value),
        )
        loadError.value = false
    } catch {
        loadError.value = true
    } finally {
        loaded.value = true
    }
}

onMounted(load)
useAccountChanges('sessions', load)

async function revoke(session: SessionRecord) {
    revoking.value = session.id
    try {
        await revokeSession(session.id)
        sessions.value = sessions.value.filter((s) => s.id !== session.id)
    } catch {
        notifyError(t('notifications.error.delete'))
    } finally {
        revoking.value = ''
    }
}

function revokeOthers() {
    return signOutOthers.run(async () => {
        await signOutOtherSessions()
        sessions.value = sessions.value.filter((s) => s.id === currentId.value)
        confirmOthers.value = false
    })
}
</script>
