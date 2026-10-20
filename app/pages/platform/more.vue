<template>
    <div class="flex w-full flex-col gap-4 p-4">
        <LayoutPageHeader :title="t('nav.more')" />

        <section>
            <LayoutEyebrow as="h2">{{
                t('platform.more.operations')
            }}</LayoutEyebrow>
            <LayoutListGroup data-testid="platform-more-links">
                <LayoutListRow
                    v-for="link in links"
                    :key="link.to"
                    :to="link.to"
                    :data-testid="`platform-more-${navTestId(link.to)}`"
                >
                    <UIcon :name="link.icon" class="size-5 text-muted" />
                    <span class="flex-1 text-highlighted">
                        {{ t(link.label) }}
                    </span>
                    <span
                        v-if="link.status"
                        class="text-sm font-semibold"
                        :class="link.tone ?? 'text-muted'"
                    >
                        {{ link.status }}
                    </span>
                    <UIcon
                        name="i-lucide-chevron-right"
                        class="size-5 text-dimmed"
                    />
                </LayoutListRow>
            </LayoutListGroup>
        </section>

        <section v-if="system?.replicas.length">
            <LayoutEyebrow as="h2">
                {{ t('platform.overview.servers.title') }}
            </LayoutEyebrow>
            <PlatformServerList :servers="system.replicas" />
        </section>

        <LayoutListGroup>
            <LayoutListRow
                :to="climbingPath"
                data-testid="platform-more-back-to-climbing"
            >
                <UIcon name="i-lucide-arrow-left" class="size-5 text-muted" />
                <span class="flex-1 text-highlighted">
                    {{ t('nav.backToClimbing') }}
                </span>
            </LayoutListRow>
            <LayoutListRow to="/account" data-testid="platform-more-account">
                <UIcon
                    name="i-lucide-circle-user-round"
                    class="size-5 text-muted"
                />
                <span class="flex-1 text-highlighted">
                    {{ t('nav.you') }}
                </span>
                <UIcon
                    name="i-lucide-chevron-right"
                    class="size-5 text-dimmed"
                />
            </LayoutListRow>
        </LayoutListGroup>

        <p class="text-center text-xs text-muted">{{ appVersionLabel }}</p>
    </div>
</template>

<script setup lang="ts">
import { getPlatformSystem } from '~/api/platform'
import { formatDate } from '#shared/utils/formatting'
import { PLATFORM_MORE_LINKS } from '~/utils/navigation'

definePageMeta({ middleware: ['auth'], platformAdmin: true })

const { t, locale } = useI18n()

useHead({ title: () => t('nav.more') })

const gymCookie = useGymCookie()
const climbingPath = computed(() =>
    gymCookie.value ? `/${gymCookie.value}` : '/',
)
const { appVersionLabel } = useVersionCheck()

const { data: system, refresh: refreshSystem } = useAsyncData(
    'platform-system',
    getPlatformSystem,
    { server: false },
)
usePlatformLive(
    [
        'backup.created',
        'backup.deleted',
        'backup.updated',
        'platform_config.updated',
    ],
    refreshSystem,
)

const links = computed(() => {
    const state = system.value
    const status: Record<string, { status: string; tone?: string }> = {}
    if (state) {
        status['/platform/backups'] = state.pg_dump_missing
            ? { status: t('platform.backups.pgDumpOff'), tone: 'text-error' }
            : state.backup_error
              ? { status: t('platform.backups.failed'), tone: 'text-error' }
              : {
                    status: state.last_backup
                        ? formatDate(state.last_backup, {
                              locale: locale.value,
                              withTime: true,
                          })
                        : '—',
                }
        if (state.mail_configured === false)
            status['/platform/settings'] = {
                status: t('platform.overview.system.mailOff'),
                tone: 'text-warning',
            }
    }
    return PLATFORM_MORE_LINKS.map((link) => ({
        ...link,
        ...status[link.to],
    }))
})
</script>
