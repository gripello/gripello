<template>
    <ul class="divide-y divide-default text-sm">
        <li
            v-for="server in servers"
            :key="server.name"
            class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
            :data-testid="`platform-server-${server.name}`"
        >
            <span
                class="size-2 shrink-0 rounded-full"
                :class="server.online ? 'bg-success' : 'bg-error'"
                role="img"
                :aria-label="
                    server.online
                        ? t('platform.overview.servers.online')
                        : t('platform.overview.servers.offline')
                "
            />
            <span class="min-w-0 flex-1 truncate font-mono text-highlighted">
                {{ server.name }}
            </span>
            <UBadge color="neutral" variant="outline" size="sm">
                {{ server.version }} · {{ server.role }}
            </UBadge>
            <span
                class="w-full pl-5 text-xs text-muted"
                :class="{ 'text-error': !server.online }"
            >
                {{ serverDetails(server) }}
            </span>
        </li>
    </ul>
</template>

<script setup lang="ts">
import type { ServerReplica } from '~/api/platform'
import { formatBytes } from '~/utils/backups'
import { formatUptime } from '~/utils/platformTraffic'
import { formatDate } from '#shared/utils/formatting'

defineProps<{ servers: ServerReplica[] }>()

const { t, locale } = useI18n()

function serverDetails(server: ServerReplica) {
    if (!server.online)
        return t('platform.overview.servers.lastSeen', {
            time: formatDate(server.last_seen, {
                locale: locale.value,
                withTime: true,
            }),
        })
    return [
        t('platform.overview.servers.uptime', {
            time: formatUptime(server.started, locale.value),
        }),
        t('platform.overview.servers.connections', server.realtime_clients),
        formatBytes(server.memory_bytes, locale.value),
    ].join(' · ')
}
</script>
