<template>
    <LayoutListGroup :flush="flush" class="text-sm">
        <LayoutListRow
            v-for="server in servers"
            :key="server.name"
            :data-testid="`platform-server-${server.name}`"
        >
            <div
                class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1"
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
                <span
                    class="min-w-0 flex-1 truncate font-mono text-highlighted"
                >
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
                <span
                    v-if="serverStrain(server)"
                    class="w-full pl-5 text-xs text-warning"
                    :data-testid="`platform-server-strain-${server.name}`"
                >
                    {{ serverStrain(server) }}
                </span>
            </div>
        </LayoutListRow>
    </LayoutListGroup>
</template>

<script setup lang="ts">
import { formatBytes } from '#shared/utils/number'
import type { ServerReplica } from '~/api/platform'
import { formatUptime } from '~/utils/platformTraffic'
import { formatDate } from '#shared/utils/formatting'

defineProps<{ servers: ServerReplica[]; flush?: boolean }>()

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
        t('platform.overview.servers.heap', {
            size: formatBytes(server.heap_bytes, locale.value),
        }),
        t('platform.overview.servers.goroutines', server.goroutines),
        t('platform.overview.servers.dbPool', {
            used: server.db_conns_in_use,
            max: server.db_conns_max,
        }),
    ].join(' · ')
}

function serverStrain(server: ServerReplica) {
    return server.strain
        .map((strain) =>
            t(`platform.overview.servers.strain.${strain}`, {
                waits: server.db_waits,
                ms: Math.round(server.db_wait_ms),
                dropped: server.realtime_dropped,
                seconds: Math.round(server.bus_lag_ms / 1000),
            }),
        )
        .join(' · ')
}
</script>
