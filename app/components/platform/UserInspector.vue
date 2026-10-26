<template>
    <LayoutPanel as="article" flush data-testid="platform-user-inspector">
        <header class="flex flex-col gap-3 p-4 pb-0">
            <div class="flex items-start gap-3">
                <ClimberAvatar
                    :id="user.id"
                    :name="name"
                    :avatar="user.avatar"
                    size="md"
                />
                <div class="min-w-0 flex-1">
                    <h2 class="truncate text-lg font-semibold text-highlighted">
                        {{ name }}
                    </h2>
                    <p class="truncate text-sm text-muted">{{ user.email }}</p>
                    <p class="truncate text-xs text-muted">
                        @{{ user.username }} ·
                        <span class="font-mono">{{ user.id }}</span>
                    </p>
                </div>
            </div>
            <PlatformUserBadges :user="user" />
            <UAlert
                v-if="alert"
                :color="ALERT_COLORS[alert]"
                variant="subtle"
                :icon="ALERT_ICONS[alert]"
                :title="t(`platform.users.alerts.${alert}`)"
                :actions="alertActions"
                data-testid="platform-user-alert"
            />
        </header>
        <LayoutTabs v-model="tab" :items="tabs" fill class="mt-3" />

        <div class="flex flex-col gap-4 p-4">
            <template v-if="tab === 'overview'">
                <PlatformUserProfile
                    :key="user.id"
                    :user="user"
                    @changed="emit('changed')"
                />
                <div
                    class="grid grid-cols-2 gap-3 rounded-lg bg-elevated p-3"
                    data-testid="platform-user-overview"
                >
                    <LayoutStatTile
                        :label="t('platform.users.lastActive')"
                        :value="lastActive"
                        value-test-id="platform-user-last-active"
                    />
                    <LayoutStatTile
                        :label="t('platform.users.joined')"
                        :value="joined"
                    />
                    <LayoutStatTile
                        :label="t('platform.users.ticks')"
                        :value="
                            detail
                                ? formatNumber(
                                      detail.ticks_count ?? 0,
                                      locale,
                                      0,
                                  )
                                : '–'
                        "
                        value-test-id="platform-user-ticks"
                    />
                    <LayoutStatTile
                        :label="t('platform.users.reviews')"
                        :value="
                            detail
                                ? formatNumber(
                                      detail.ratings_count ?? 0,
                                      locale,
                                      0,
                                  )
                                : '–'
                        "
                    />
                </div>
                <PlatformUserMemberships
                    :user="user"
                    :gyms="gyms"
                    :roles="roles"
                    @changed="emit('changed')"
                />
            </template>

            <template v-else-if="tab === 'security'">
                <PlatformUserSecurity :user="user" @changed="changed" />
                <LayoutEyebrow>{{
                    t('platform.users.sessions')
                }}</LayoutEyebrow>
                <LayoutLoadingState
                    v-if="sessionsPending && !sessions.length"
                    :count="2"
                />
                <LayoutListGroup
                    v-else-if="sessions.length"
                    data-testid="platform-user-sessions"
                >
                    <LayoutListRow
                        v-for="session in sessions"
                        :key="session.id"
                        dense
                        :icon="
                            isMobileDevice(deviceOf(session))
                                ? 'i-lucide-smartphone'
                                : 'i-lucide-monitor'
                        "
                    >
                        <div class="min-w-0 flex-1">
                            <p class="truncate text-sm font-medium">
                                {{ deviceOf(session) }}
                            </p>
                            <p class="truncate text-xs text-muted">
                                {{
                                    [
                                        session.ip,
                                        timeAgo(session.last_seen, t, locale),
                                    ]
                                        .filter(Boolean)
                                        .join(' · ')
                                }}
                            </p>
                        </div>
                    </LayoutListRow>
                </LayoutListGroup>
                <p v-else class="text-sm text-muted">
                    {{ t('platform.users.noSessions') }}
                </p>
            </template>

            <template v-else>
                <LayoutLoadingState
                    v-if="activityPending && !activity.length"
                    :count="3"
                />
                <LayoutListGroup
                    v-else-if="activity.length"
                    data-testid="platform-user-activity"
                >
                    <AuditCard
                        v-for="entry in activity"
                        :key="entry.id"
                        :entry="entry"
                    />
                </LayoutListGroup>
                <p v-else class="text-sm text-muted">
                    {{ t('platform.users.noActivity') }}
                </p>
            </template>
        </div>

        <footer
            class="mt-auto flex flex-wrap items-center gap-2 border-t border-default p-4"
        >
            <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-ban"
                :disabled="!!user.platform_admin"
                data-testid="platform-user-suspend-account"
                @click="emit('suspend', user.id)"
            >
                {{ t('platform.users.suspend') }}
            </UButton>
            <UButton
                color="error"
                variant="ghost"
                icon="i-lucide-trash-2"
                class="ms-auto"
                :disabled="!!user.platform_admin"
                data-testid="platform-user-delete-account"
                @click="emit('delete', user.id)"
            >
                {{ t('users.delete') }}
            </UButton>
        </footer>
    </LayoutPanel>
</template>

<script setup lang="ts">
import type { AlertProps } from '@nuxt/ui'
import { listPlatformAudit } from '~/api/audit'
import { requestVerification } from '~/api/auth'
import {
    clearUserLockout,
    getPlatformUser,
    liftSuspension,
    listUserSessions,
    updatePlatformUser,
} from '~/api/platform'
import type { GymRecord, RoleRecord, SessionRecord } from '~/types/models'
import { displayName } from '~/utils/avatar'
import { deviceLabel, isMobileDevice } from '~/utils/push'
import { formatDate, timeAgo } from '#shared/utils/formatting'
import { formatNumber } from '#shared/utils/number'
import {
    lastSeenLabel,
    mergeActivity,
    userAlert,
    type PlatformUser,
    type UserAlertKind,
} from '~/utils/platformUsers'

type Tab = 'overview' | 'security' | 'activity'

const props = defineProps<{
    user: PlatformUser
    gyms: GymRecord[]
    roles: RoleRecord[]
}>()
const emit = defineEmits<{
    changed: []
    delete: [id: string]
    suspend: [id: string]
}>()

const { t, locale } = useI18n()

const ALERT_COLORS: Record<UserAlertKind, AlertProps['color']> = {
    suspended: 'error',
    locked: 'warning',
    unverified: 'warning',
    staffNoMfa: 'warning',
}
const ALERT_ICONS: Record<UserAlertKind, string> = {
    suspended: 'i-lucide-ban',
    locked: 'i-lucide-lock',
    unverified: 'i-lucide-mail-warning',
    staffNoMfa: 'i-lucide-shield-off',
}

const name = computed(() => displayName(props.user, '?'))
const tab = ref<Tab>('overview')
const tabs = computed(() => [
    {
        label: t('platform.users.tabs.overview'),
        icon: 'i-lucide-layout-dashboard',
        value: 'overview' as const,
    },
    {
        label: t('platform.users.tabs.security'),
        icon: 'i-lucide-shield',
        value: 'security' as const,
    },
    {
        label: t('platform.users.tabs.activity'),
        icon: 'i-lucide-history',
        value: 'activity' as const,
    },
])

const now = useMountedNow(30_000)
const lastActive = computed(() =>
    lastSeenLabel(
        props.user.last_seen,
        t,
        locale.value,
        now.value?.getTime() ?? Date.now(),
    ),
)
const joined = computed(() =>
    props.user.created
        ? formatDate(props.user.created, { locale: locale.value })
        : '–',
)

const { data: detail, refresh: refreshDetail } = useAsyncData(
    () => `platform-user-detail:${props.user.id}`,
    () => getPlatformUser(props.user.id),
    { server: false, enabled: () => tab.value === 'overview', watch: [tab] },
)

const {
    data: sessions,
    pending: sessionsPending,
    refresh: refreshSessions,
} = useAsyncData(
    () => `platform-user-sessions:${props.user.id}`,
    () => listUserSessions(props.user.id),
    {
        server: false,
        default: () => [],
        enabled: () => tab.value === 'security',
        watch: [tab],
    },
)

const { data: activity, pending: activityPending } = useAsyncData(
    () => `platform-user-activity:${props.user.id}`,
    async () => {
        const [about, by] = await Promise.all([
            listPlatformAudit({ record: props.user.id, limit: 20 }),
            listPlatformAudit({ actor: props.user.id, limit: 20 }),
        ])
        return mergeActivity(about.items, by.items).slice(0, 30)
    },
    {
        server: false,
        default: () => [],
        enabled: () => tab.value === 'activity',
        watch: [tab],
    },
)

function deviceOf(session: SessionRecord) {
    return (
        deviceLabel(session.user_agent) || t('account.sessions.unknownDevice')
    )
}

function changed() {
    emit('changed')
    void refreshSessions()
}

const alert = computed(() => userAlert(props.user))

const { pending: fixing, run } = useAsyncAction()

const ALERT_FIXES: Partial<
    Record<UserAlertKind, { label: string; call: (id: string) => unknown }>
> = {
    suspended: { label: 'platform.users.liftSuspension', call: liftSuspension },
    locked: { label: 'platform.users.unlock', call: clearUserLockout },
    unverified: {
        label: 'platform.users.markVerified',
        call: (id) => updatePlatformUser(id, { verified: true }),
    },
}

const { capHeaders } = useCapToken()
const { pending: resending, run: runResend } = useAsyncAction()

const alertActions = computed(() => {
    const fix = alert.value && ALERT_FIXES[alert.value]
    if (!fix) return undefined
    const actions = [
        {
            label: t(fix.label),
            color: 'neutral' as const,
            variant: 'outline' as const,
            loading: fixing.value,
            'data-testid': 'platform-user-alert-action',
            onClick: () => fixAlert(fix.call),
        },
    ]
    if (alert.value === 'unverified' && props.user.email) {
        actions.push({
            label: t('platform.users.resendVerification'),
            color: 'neutral' as const,
            variant: 'outline' as const,
            loading: resending.value,
            'data-testid': 'platform-user-alert-resend',
            onClick: () => resendVerification(),
        })
    }
    return actions
})

async function resendVerification() {
    const email = props.user.email
    if (resending.value || !email) return
    await runResend(
        async () =>
            requestVerification(email, await capHeaders('verification')),
        {
            success: t('platform.users.verificationSent'),
            error: t('notifications.error.generic'),
        },
    )
}

async function fixAlert(call: (id: string) => unknown) {
    if (fixing.value) return
    const done = await run(
        async () => {
            await call(props.user.id)
            return true
        },
        {
            success: t('notifications.success.edit'),
            error: t('notifications.error.generic'),
        },
    )
    if (done) {
        emit('changed')
        void refreshDetail()
    }
}
</script>
