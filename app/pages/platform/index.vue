<template>
    <div class="w-full p-4">
        <LayoutPageHeader :title="t('platform.overview.title')">
            <template #actions>
                <UButton
                    :href="dashboardUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-database"
                    data-testid="platform-dashboard-link"
                >
                    {{ t('platform.overview.dashboard') }}
                </UButton>
                <UButton
                    to="/platform/settings"
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-sliders-horizontal"
                >
                    {{ t('platform.settings.title') }}
                </UButton>
            </template>
        </LayoutPageHeader>

        <LayoutEmptyState
            v-if="error"
            variant="error"
            :title="t('errors.loadFailed')"
        >
            <template #actions>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-refresh-cw"
                    @click="refresh()"
                >
                    {{ t('errors.retry') }}
                </UButton>
            </template>
        </LayoutEmptyState>

        <template v-else-if="overview">
            <div class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div
                    v-for="tile in tiles"
                    :key="tile.key"
                    class="rounded-lg border border-default bg-default p-4"
                    :data-testid="`platform-stat-${tile.key}`"
                >
                    <LayoutStatTile
                        :label="tile.label"
                        :value="tile.value"
                        :icon="tile.icon"
                    />
                </div>
            </div>

            <UPageCard
                :title="t('platform.overview.admins')"
                variant="subtle"
                data-testid="platform-admins"
            >
                <ul class="flex flex-col gap-3">
                    <li
                        v-for="admin in overview.admins"
                        :key="admin.id"
                        :data-testid="`platform-admin-${admin.id}`"
                    >
                        <UUser
                            :name="userDisplayName(admin)"
                            :description="admin.email"
                            :avatar="{
                                src:
                                    usePbFileUrl(admin, admin.avatar, {
                                        thumb: '100x100',
                                    }) || undefined,
                                alt: userDisplayName(admin),
                            }"
                            :ui="{ name: 'truncate', description: 'truncate' }"
                        />
                    </li>
                </ul>
            </UPageCard>
        </template>
    </div>
</template>

<script setup lang="ts">
import type { UserRecord } from '~/types/models'

definePageMeta({ middleware: ['auth'], platformAdmin: true })

const { t } = useI18n()
const pb = usePocketbase()

useHead({ title: () => t('platform.overview.title') })

const dashboardUrl = (import.meta.dev ? 'http://localhost:8090' : '') + '/_/'

const count = (collection: string, filter = '') =>
    pb
        .collection(collection)
        .getList(1, 1, { filter, fields: 'id', requestKey: null })
        .then((result) => result.totalItems)

const {
    data: overview,
    error,
    refresh,
} = await useAsyncData('platform-overview', async () => {
    const [gyms, activeGyms, memberships, routes, admins] = await Promise.all([
        count('gyms'),
        count('gyms', 'active = true'),
        count('memberships'),
        count('routes'),
        pb.collection('users').getFullList<UserRecord>({
            filter: 'platform_admin = true',
            fields: 'id,collectionId,email,username,firstname,name,avatar',
            sort: 'email',
            requestKey: null,
        }),
    ])
    return { gyms, activeGyms, memberships, routes, admins }
})

const tiles = computed(() => [
    {
        key: 'gyms',
        label: t('platform.gyms.title'),
        value: overview.value?.gyms ?? 0,
        icon: 'i-lucide-building-2',
    },
    {
        key: 'active-gyms',
        label: t('platform.overview.activeGyms'),
        value: overview.value?.activeGyms ?? 0,
        icon: 'i-lucide-circle-check',
    },
    {
        key: 'memberships',
        label: t('platform.overview.memberships'),
        value: overview.value?.memberships ?? 0,
        icon: 'i-lucide-users-round',
    },
    {
        key: 'routes',
        label: t('platform.overview.routes'),
        value: overview.value?.routes ?? 0,
        icon: 'i-lucide-waypoints',
    },
])

function userDisplayName(user: UserRecord) {
    return (
        [user.firstname, user.name].filter(Boolean).join(' ') ||
        user.username ||
        user.email ||
        ''
    )
}
</script>
