<template>
    <div class="w-full p-4">
        <LayoutPageHeader :title="t('platform.overview.title')" class="mb-6">
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
                    @click="retry"
                >
                    {{ t('errors.retry') }}
                </UButton>
            </template>
        </LayoutEmptyState>

        <template v-else>
            <div class="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <AnalyticsStatsCard
                    v-for="tile in tiles"
                    :key="tile.key"
                    :title="tile.label"
                    :value="tile.value"
                    :icon="tile.icon"
                    :color="tile.color"
                    :data-testid="`platform-stat-${tile.key}`"
                />
            </div>

            <div class="grid grid-cols-12 gap-3">
                <div class="col-span-12 flex lg:col-span-8">
                    <AnalyticsSection
                        :title="t('platform.gyms.title')"
                        icon="i-lucide-building-2"
                        :empty="!gyms.length"
                        empty-icon="i-lucide-building-2"
                        :empty-text="t('table.no_data')"
                        flush
                        testid="platform-gyms"
                    >
                        <template #actions>
                            <UButton
                                to="/platform/gyms"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                trailing-icon="i-lucide-arrow-right"
                                data-testid="platform-gyms-manage"
                            >
                                {{ t('nav.manageGyms') }}
                            </UButton>
                        </template>
                        <ul class="divide-y divide-default">
                            <li
                                v-for="gym in gyms"
                                :key="gym.id"
                                class="flex items-center gap-3 px-4 py-3"
                                :data-testid="`platform-overview-gym-${gym.slug}`"
                            >
                                <NuxtLink
                                    :to="`/platform/gyms/${gym.id}`"
                                    class="min-w-0 flex-1"
                                >
                                    <PlatformGymIdentity :gym="gym" />
                                </NuxtLink>
                                <div
                                    class="hidden shrink-0 items-center gap-4 text-sm text-muted sm:flex"
                                >
                                    <span
                                        v-for="count in gymCounts(gym)"
                                        :key="count.key"
                                        class="flex w-14 items-center justify-end gap-1 tabular-nums"
                                        :data-testid="`platform-gym-${count.key}-${gym.slug}`"
                                    >
                                        <UIcon
                                            :name="count.icon"
                                            class="size-4"
                                        />
                                        {{ count.value }}
                                        <span class="sr-only">
                                            {{ count.label }}
                                        </span>
                                    </span>
                                </div>
                                <div class="flex shrink-0 items-center">
                                    <UButton
                                        v-if="gym.active"
                                        :to="`/${gym.slug}`"
                                        icon="i-lucide-external-link"
                                        color="neutral"
                                        variant="ghost"
                                        class="icon-btn"
                                        :aria-label="t('platform.gyms.open')"
                                        :data-testid="`platform-gym-open-${gym.slug}`"
                                    />
                                    <UButton
                                        :to="`/platform/gyms/${gym.id}`"
                                        icon="i-lucide-pencil"
                                        color="neutral"
                                        variant="ghost"
                                        class="icon-btn"
                                        :aria-label="t('actions.edit')"
                                        :data-testid="`platform-gym-edit-${gym.slug}`"
                                    />
                                </div>
                            </li>
                        </ul>
                    </AnalyticsSection>
                </div>

                <div class="col-span-12 flex lg:col-span-4">
                    <AnalyticsSection
                        :title="t('platform.overview.admins')"
                        icon="i-lucide-shield-user"
                        color="secondary"
                        flush
                        testid="platform-admins"
                    >
                        <ul class="divide-y divide-default">
                            <li
                                v-for="admin in admins"
                                :key="admin.id"
                                class="px-4 py-3"
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
                                    :ui="{
                                        name: 'truncate',
                                        description: 'truncate',
                                    }"
                                />
                            </li>
                        </ul>
                    </AnalyticsSection>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import type { UserRecord } from '~/types/models'
import { platformTotals, type PlatformGym } from '~/utils/platformGyms'
import { userDisplayName } from '~/utils/platformUsers'

definePageMeta({ middleware: ['auth'], platformAdmin: true })

const { t } = useI18n()
const pb = usePocketbase()

useHead({ title: () => t('platform.overview.title') })

const dashboardUrl = (import.meta.dev ? 'http://localhost:8090' : '') + '/_/'

const [
    { data: gyms, error: gymsError, refresh: refreshGyms },
    { data: admins, error: adminsError, refresh: refreshAdmins },
] = await Promise.all([
    usePlatformGyms(),
    useAsyncData(
        'platform-admins',
        () =>
            pb.collection('users').getFullList<UserRecord>({
                filter: 'platform_admin = true',
                fields: 'id,collectionId,email,username,firstname,name,avatar',
                sort: 'email',
                requestKey: null,
            }),
        { default: () => [] },
    ),
])

const error = computed(() => gymsError.value || adminsError.value)

function retry() {
    return Promise.all([refreshGyms(), refreshAdmins()])
}

const tiles = computed(() => {
    const totals = platformTotals(gyms.value)
    return [
        {
            key: 'gyms',
            label: t('platform.gyms.title'),
            value: totals.gyms,
            icon: 'i-lucide-building-2',
            color: 'primary',
        },
        {
            key: 'active-gyms',
            label: t('platform.overview.activeGyms'),
            value: totals.activeGyms,
            icon: 'i-lucide-circle-check',
            color: 'success',
        },
        {
            key: 'memberships',
            label: t('platform.overview.memberships'),
            value: totals.members,
            icon: 'i-lucide-users-round',
            color: 'info',
        },
        {
            key: 'routes',
            label: t('platform.overview.routes'),
            value: totals.routes,
            icon: 'i-lucide-waypoints',
            color: 'warning',
        },
    ]
})

function gymCounts(gym: PlatformGym) {
    return [
        {
            key: 'members',
            label: t('members.title'),
            value: gym.members,
            icon: 'i-lucide-users-round',
        },
        {
            key: 'routes',
            label: t('platform.overview.routes'),
            value: gym.routes,
            icon: 'i-lucide-waypoints',
        },
    ]
}
</script>
