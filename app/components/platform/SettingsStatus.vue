<template>
    <div
        class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4"
        data-testid="platform-settings-status"
    >
        <NuxtLink
            v-for="tile in tiles"
            :key="tile.key"
            :to="tile.to"
            class="flex flex-col gap-1 rounded-lg bg-default p-4 ring ring-default transition-shadow hover:ring-accented focus-visible:outline-2 focus-visible:outline-primary"
            :data-testid="`platform-settings-status-${tile.key}`"
        >
            <span class="flex items-center gap-2 text-sm text-muted">
                <span class="flex-1">{{ tile.label }}</span>
                <UBadge
                    v-if="tile.badge"
                    :color="tile.badgeColor"
                    variant="subtle"
                    size="sm"
                >
                    {{ tile.badge }}
                </UBadge>
            </span>
            <span class="truncate text-lg font-bold text-highlighted">
                {{ tile.value }}
            </span>
            <span class="truncate text-xs text-muted">{{ tile.detail }}</span>
        </NuxtLink>
    </div>
</template>

<script setup lang="ts">
import { CLIENT_ONLY } from '~/utils/platformMail'
import { listBackups } from '~/api/backups'
import { getMailSettings, listOAuthProviderSettings } from '~/api/platform'
import { formatDate } from '#shared/utils/formatting'
import { oauthProviderStatus } from '~/utils/oauthSettings'

const props = defineProps<{ allowRegistration: boolean; auditDays: number }>()

const { t, locale } = useI18n()

const { data: mail } = useAsyncData(
    'platform-mail',
    getMailSettings,
    CLIENT_ONLY,
)
const { data: providers } = useAsyncData(
    'platform-oauth2',
    listOAuthProviderSettings,
    CLIENT_ONLY,
)
const { data: backups } = useAsyncData(
    'platform-backups',
    listBackups,
    CLIENT_ONLY,
)

const tiles = computed(() => {
    const statuses = (providers.value ?? []).map(oauthProviderStatus)
    const live = statuses.filter((status) => status === 'live').length
    const configured = statuses.filter((status) => status !== 'missing').length
    const latest = backups.value?.items[0]
    return [
        {
            key: 'registration',
            label: t('platform.settings.status.registration'),
            value: props.allowRegistration
                ? t('platform.settings.status.open')
                : t('platform.settings.status.inviteOnly'),
            detail: t('platform.settings.status.auditDays', props.auditDays),
            to: '/platform/settings?section=access',
        },
        {
            key: 'mail',
            label: t('platform.settings.mail.title'),
            value:
                mail.value?.source === 'database'
                    ? mail.value.smtp_host
                    : mail.value?.source === 'environment'
                      ? t('platform.settings.mail.fromEnvironment')
                      : mail.value
                        ? t('platform.settings.mail.notConfigured')
                        : '—',
            detail:
                mail.value?.source === 'database'
                    ? `${mail.value.sender_address} · ${mail.value.smtp_tls ? 'TLS' : 'STARTTLS'} ${mail.value.smtp_port}`
                    : '',
            badge: !mail.value
                ? undefined
                : mail.value.source === 'none'
                  ? t('platform.settings.oauth2.status.missing')
                  : t('platform.settings.oauth2.status.configured'),
            badgeColor:
                mail.value?.source === 'none'
                    ? ('warning' as const)
                    : ('success' as const),
            to: '/platform/settings?section=mail',
        },
        {
            key: 'sign-in',
            label: t('platform.settings.oauth2.title'),
            value: t('platform.settings.status.configured', configured),
            detail: '',
            badge: t('platform.settings.status.live', live),
            badgeColor: live ? ('success' as const) : ('neutral' as const),
            to: '/platform/settings?section=signIn',
        },
        {
            key: 'backups',
            label: t('platform.backups.title'),
            value: backups.value?.last_error
                ? t('platform.backups.failed')
                : latest
                  ? formatDate(latest.created, {
                        locale: locale.value,
                        withTime: true,
                    })
                  : '—',
            detail:
                backups.value?.enabled === false
                    ? t('platform.backups.off')
                    : '',
            badge: backups.value?.last_error
                ? t('platform.backups.failed')
                : undefined,
            badgeColor: 'error' as const,
            to: '/platform/backups',
        },
    ]
})
</script>
