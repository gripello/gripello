<template>
    <div class="w-full p-4">
        <LayoutPageHeader :title="t('platform.users.title')" />

        <PlatformUserKpis v-model="kind" :summary="summary" class="mb-4" />

        <FilterBar
            v-model="search"
            :search-label="t('platform.users.search')"
            :active-filter-count="activeFilterCount"
            @clear="clearFilters"
        >
            <template #filters>
                <div class="contents">
                    <SegmentedControl
                        v-if="lgAndUp"
                        v-model="kindTab"
                        :items="kindTabs"
                        size="sm"
                        test-id="platform-users-show"
                    />
                    <FilterSelect
                        v-else
                        v-model="kind"
                        :label="t('platform.users.show')"
                        :items="kindItems"
                        value-key="value"
                        :placeholder="t('filter.all')"
                        clear
                        data-testid="platform-users-filter"
                        @clear="kind = null"
                    />
                    <FilterSelect
                        v-model="gym"
                        :label="t('platform.users.gym')"
                        :items="gymItems"
                        value-key="value"
                        :placeholder="t('filter.all')"
                        clear
                        data-testid="platform-users-gym"
                        @clear="gym = null"
                    />
                    <FilterSelect
                        v-if="!lgAndUp"
                        v-model="sort"
                        :label="t('table.sort_by')"
                        :items="sortItems"
                        value-key="value"
                        data-testid="platform-users-sort"
                    />
                    <UButton
                        v-if="lgAndUp"
                        :icon="compact ? 'i-lucide-rows-4' : 'i-lucide-rows-3'"
                        color="neutral"
                        :variant="compact ? 'soft' : 'ghost'"
                        class="icon-btn"
                        :aria-label="t('platform.users.compact')"
                        :aria-pressed="compact"
                        data-testid="platform-users-compact"
                        @click="compact = !compact"
                    />
                </div>
            </template>
        </FilterBar>

        <LayoutEmptyState
            v-if="error || lookupError"
            variant="error"
            :title="t('errors.loadFailed')"
        >
            <template #actions>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-refresh-cw"
                    @click="reloadAll"
                >
                    {{ t('errors.retry') }}
                </UButton>
            </template>
        </LayoutEmptyState>

        <LayoutLoadingState v-else-if="loading && !users.length" />

        <LayoutEmptyState
            v-else-if="!users.length"
            icon="i-lucide-user-x"
            :title="t('users.noUsers')"
        />

        <div v-else-if="lgAndUp" class="flex items-start gap-4">
            <div class="min-w-0 flex-1">
                <UTable
                    :data="rows"
                    :columns="columns"
                    :get-row-id="(row: UserRow) => row.id"
                    :meta="tableMeta"
                    :ui="{ td: compact ? 'py-1.5' : 'py-3' }"
                    data-testid="platform-user-table"
                    @select="(_event, row) => select(row.original.id)"
                >
                    <template #user-cell="{ row }">
                        <div
                            class="max-w-80 min-w-0"
                            :data-testid="`platform-user-${row.original.id}`"
                        >
                            <AdminMemberIdentity
                                :member="row.original.identity"
                            />
                        </div>
                    </template>
                    <template #status-cell="{ row }">
                        <PlatformUserBadges :user="row.original" />
                    </template>
                    <template #gyms-cell="{ row }">
                        <PlatformUserChips
                            :chips="row.original.chips"
                            class="max-w-56"
                        />
                    </template>
                    <template #mfa-cell="{ row }">
                        <PlatformUserMfa
                            :enabled="row.original.mfa_enabled"
                            :staff="row.original.chips.length > 0"
                        />
                    </template>
                    <template #last_seen-cell="{ row }">
                        <PlatformUserLastSeen
                            :last-seen="row.original.last_seen"
                            :compact="compact"
                        />
                    </template>
                    <template #created-cell="{ row }">
                        <span class="whitespace-nowrap text-muted">
                            {{ joined(row.original) }}
                        </span>
                    </template>
                    <template #actions-cell="{ row }">
                        <div class="flex justify-end" @click.stop>
                            <UDropdownMenu :items="rowMenu(row.original)">
                                <UButton
                                    icon="i-lucide-ellipsis-vertical"
                                    color="neutral"
                                    variant="ghost"
                                    class="icon-btn"
                                    :aria-label="t('actions.more')"
                                    data-testid="platform-user-menu"
                                />
                            </UDropdownMenu>
                        </div>
                    </template>
                </UTable>
                <LayoutLoadMore
                    v-if="hasMore"
                    :loading="loadingMore"
                    test-id="platform-users-load-more"
                    @load="loadMore"
                />
            </div>
            <PlatformUserInspector
                v-if="selectedUser"
                :user="selectedUser"
                :gyms="gyms"
                :roles="roles"
                class="sticky top-20 w-96 shrink-0"
                @changed="reloadLoaded"
                @suspend="openSuspend"
                @delete="openDelete"
            />
            <LayoutEmptyState
                v-else
                icon="i-lucide-mouse-pointer-click"
                :title="t('platform.users.selectUser')"
                class="sticky top-20 w-96 shrink-0"
                data-testid="platform-user-no-selection"
            />
        </div>

        <template v-else>
            <LayoutListGroup data-testid="platform-user-list">
                <li
                    v-for="user in rows"
                    :key="user.id"
                    :data-testid="`platform-user-${user.id}`"
                >
                    <button
                        type="button"
                        class="flex w-full items-center gap-3 px-4 py-3 text-left"
                        data-testid="platform-user-open"
                        @click="select(user.id)"
                    >
                        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                            <AdminMemberIdentity :member="user.identity" />
                            <PlatformUserBadges :user="user" />
                            <PlatformUserChips
                                :chips="user.chips"
                                class="max-md:hidden"
                            />
                        </div>
                        <PlatformUserLastSeen
                            :last-seen="user.last_seen"
                            compact
                            class="shrink-0 text-xs"
                        />
                        <UIcon
                            name="i-lucide-chevron-right"
                            class="size-5 shrink-0 text-muted"
                        />
                    </button>
                </li>
            </LayoutListGroup>
            <LayoutLoadMore
                v-if="hasMore"
                :loading="loadingMore"
                test-id="platform-users-load-more"
                @load="loadMore"
            />

            <LayoutDialogShell
                v-model="sheetOpen"
                :title="t('platform.users.columns.user')"
                sheet-on-mobile
                flush
                closable
            >
                <PlatformUserInspector
                    v-if="selectedUser"
                    :user="selectedUser"
                    :gyms="gyms"
                    :roles="roles"
                    class="ring-0"
                    @changed="reloadLoaded"
                    @suspend="openSuspend"
                    @delete="openDelete"
                />
            </LayoutDialogShell>
        </template>

        <PlatformSuspendDialog
            v-model="suspendOpen"
            :user="suspendingUser"
            @changed="reloadLoaded"
        />

        <ConfirmDialog
            v-model="deleteOpen"
            :title="t('users.delete')"
            :message="
                t('platform.users.deleteConfirm', {
                    name: displayName(deletingUser),
                })
            "
            :loading="removing"
            @confirm="deleteUser"
        >
            <UserReauthField
                v-model="adminPassword"
                class="mt-3"
                data-testid="platform-delete-admin-password"
            />
        </ConfirmDialog>
    </div>
</template>

<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { useIntervalFn, useTimeoutFn } from '@vueuse/core'
import { listGyms } from '~/api/gyms'
import { listRoles } from '~/api/members'
import {
    deletePlatformUser,
    listPlatformUsers,
    platformUserSummary,
} from '~/api/platform'
import { avatarUrl, displayName, nameInitials } from '~/utils/avatar'
import { gymTitle } from '~/utils/gymNames'
import { PLATFORM_USERS_COMPACT_KEY } from '~/utils/clientStorage'
import { formatDate } from '#shared/utils/formatting'
import { sortHeader } from '~/utils/tableSortHeader'
import {
    DEFAULT_PLATFORM_USER_SORT,
    PLATFORM_USER_SORTS,
    membershipChips,
    nextPlatformUserSort,
    platformUserFilterFrom,
    platformUserSortFrom,
    sortOrderOf,
    userKeptThroughReload,
    type PlatformUser,
    type PlatformUserFilter,
    type PlatformUserSortColumn,
} from '~/utils/platformUsers'

definePageMeta({ middleware: ['auth'], platformAdmin: true })

const { t, locale } = useI18n()
const route = useRoute()
const { lgAndUp } = useDisplay()

useHead({ title: () => t('platform.users.title') })

const {
    data: lookups,
    error: lookupError,
    refresh: refreshLookups,
} = await useAsyncData(
    'platform-user-lookups',
    async () => {
        const [gyms, roles] = await Promise.all([
            listGyms({ all: true }),
            listRoles(null),
        ])
        return { gyms, roles }
    },
    { default: () => ({ gyms: [], roles: [] }) },
)
const gyms = computed(() => lookups.value.gyms)
const roles = computed(() => lookups.value.roles)

const { data: summary, refresh: refreshSummary } = useAsyncData(
    'platform-user-summary',
    platformUserSummary,
    { server: false },
)

const search = ref('')
const kind = ref<PlatformUserFilter | null>(
    platformUserFilterFrom(route.query.show),
)
const gym = ref<string | null>(
    typeof route.query.gym === 'string' ? route.query.gym : null,
)
const sort = ref(platformUserSortFrom(route.query.sort))
const selectedId = ref<string | null>(
    typeof route.query.user === 'string' ? route.query.user : null,
)

const activeFilterCount = computed(
    () => Number(!!kind.value) + Number(!!gym.value),
)

function clearFilters() {
    kind.value = null
    gym.value = null
}

const FILTER_LABELS: Record<PlatformUserFilter, string> = {
    staff: 'platform.users.filters.staff',
    platform_admins: 'platform.overview.admins',
    unverified: 'platform.users.unverified',
    suspended: 'platform.overview.suspended',
    locked: 'platform.users.filters.locked',
    no_mfa: 'platform.users.filters.noMfa',
    staff_no_mfa: 'platform.users.kpis.staffNoMfa',
    active: 'platform.users.kpis.active',
    online: 'platform.users.onlineNow',
}
const TAB_FILTERS = [
    'online',
    'staff',
    'platform_admins',
    'unverified',
    'suspended',
    'locked',
    'no_mfa',
] as const

const kindItems = computed(() =>
    (Object.keys(FILTER_LABELS) as PlatformUserFilter[]).map((value) => ({
        label: t(FILTER_LABELS[value]),
        value,
    })),
)
const kindTabs = computed(() => [
    { label: t('filter.all'), value: 'all' },
    ...TAB_FILTERS.map((value) => ({ label: t(FILTER_LABELS[value]), value })),
    // KPI-only filters still show as the selected tab while active.
    ...(kind.value && !(TAB_FILTERS as readonly string[]).includes(kind.value)
        ? [{ label: t(FILTER_LABELS[kind.value]), value: kind.value }]
        : []),
])
const kindTab = computed({
    get: () => kind.value ?? 'all',
    set: (value: string) => {
        kind.value = platformUserFilterFrom(value)
    },
})

const gymItems = computed(() =>
    gyms.value.map((entry) => ({ label: gymTitle(entry), value: entry.id })),
)
const sortItems = computed(() =>
    PLATFORM_USER_SORTS.map((value) => ({
        label: t(`platform.users.sorts.${value}`),
        value,
    })),
)

const {
    items: users,
    loading,
    loadingMore,
    hasMore,
    error,
    refresh: reloadUsers,
    reloadLoaded: reloadLoadedUsers,
    loadMore,
    prefetch,
} = useList<PlatformUser>(
    (page, limit) =>
        listPlatformUsers({
            q: search.value,
            filter: kind.value,
            gym: gym.value,
            sort: sort.value,
            page,
            limit,
            total: true,
        }),
    { perPage: 48 },
)

function reloadLoaded() {
    void refreshSummary()
    return reloadLoadedUsers()
}

usePlatformLive(['platform_users.changed'], reloadLoaded)
// Online status changes without an event.
useIntervalFn(() => {
    if (document.visibilityState === 'visible') void reloadLoaded()
}, 60_000)

await prefetch('platform-users')

const { start: reloadUsersSoon } = useTimeoutFn(() => void reloadUsers(), 300, {
    immediate: false,
})
watch(search, () => reloadUsersSoon())
watch([kind, gym, sort], () => reloadUsers())

watch([kind, gym, sort, selectedId], () =>
    navigateTo(
        {
            query: {
                ...route.query,
                show: kind.value ?? undefined,
                gym: gym.value ?? undefined,
                sort:
                    sort.value === DEFAULT_PLATFORM_USER_SORT
                        ? undefined
                        : sort.value,
                user: selectedId.value ?? undefined,
            },
        },
        { replace: true },
    ),
)

function reloadAll() {
    void refreshSummary()
    return Promise.all([refreshLookups(), reloadUsers()])
}

const rows = computed(() =>
    users.value.map((user) => {
        const userName = displayName(user, '?')
        return {
            ...user,
            chips: membershipChips(user, gyms.value, roles.value),
            identity: {
                user: user.id,
                displayName: userName,
                email: user.email ?? '',
                initials: nameInitials(userName),
                avatarUrl: avatarUrl(user) || null,
            },
        }
    }),
)
type UserRow = (typeof rows.value)[number]

function joined(user: PlatformUser) {
    return user.created
        ? formatDate(user.created, { locale: locale.value })
        : ''
}

const compact = ref(false)
onMounted(() => {
    try {
        compact.value = localStorage.getItem(PLATFORM_USERS_COMPACT_KEY) === '1'
    } catch {}
})
watch(compact, (on) => {
    try {
        localStorage.setItem(PLATFORM_USERS_COMPACT_KEY, on ? '1' : '0')
    } catch {}
})

function sortable(label: string, column: PlatformUserSortColumn) {
    return () =>
        sortHeader(
            label,
            sortOrderOf(sort.value, column),
            () => {
                sort.value = nextPlatformUserSort(sort.value, column)
            },
            `platform-users-sort-${column}`,
        )
}

const xlOnly = {
    class: { th: 'hidden xl:table-cell', td: 'hidden xl:table-cell' },
}
const widestOnly = {
    class: {
        th: 'hidden min-[1800px]:table-cell',
        td: 'hidden min-[1800px]:table-cell',
    },
}

const columns = computed<TableColumn<UserRow>[]>(() => [
    {
        id: 'user',
        header: sortable(t('platform.users.columns.user'), 'email'),
    },
    {
        id: 'status',
        header: sortable(t('platform.users.columns.status'), 'status'),
    },
    {
        id: 'gyms',
        header: sortable(t('platform.users.columns.gyms'), 'gyms'),
        meta: xlOnly,
    },
    { id: 'mfa', header: sortable(t('platform.users.columns.mfa'), 'mfa') },
    {
        id: 'last_seen',
        header: sortable(t('platform.users.lastActive'), 'last_seen'),
    },
    {
        id: 'created',
        header: sortable(t('platform.users.joined'), 'created'),
        meta: widestOnly,
    },
    { id: 'actions', header: '', meta: { class: { td: 'w-12' } } },
])

const tableMeta = {
    class: {
        tr: (row: { original: UserRow }) =>
            row.original.id === selectedId.value
                ? 'cursor-pointer bg-elevated'
                : 'cursor-pointer',
    },
}

const selectedUser = computed<PlatformUser | null>((previous) =>
    userKeptThroughReload(users.value, selectedId.value, previous),
)
const sheetOpen = ref(false)

function select(id: string) {
    selectedId.value = id
    if (!lgAndUp.value) sheetOpen.value = true
}

onMounted(() => {
    if (selectedUser.value && !lgAndUp.value) sheetOpen.value = true
})

watch(sheetOpen, (open) => {
    if (!open && !lgAndUp.value) selectedId.value = null
})

const suspendingId = ref<string | null>(null)
const suspendingUser = computed(
    () => users.value.find((user) => user.id === suspendingId.value) ?? null,
)
const suspendOpen = ref(false)

function rowMenu(user: PlatformUser) {
    return [
        {
            label: t('users.edit'),
            icon: 'i-lucide-pencil',
            onSelect: () => select(user.id),
        },
        {
            label: t('platform.users.suspend'),
            icon: 'i-lucide-ban',
            disabled: !!user.platform_admin,
            onSelect: () => openSuspend(user.id),
        },
        {
            label: t('users.delete'),
            icon: 'i-lucide-trash-2',
            color: 'error' as const,
            disabled: !!user.platform_admin,
            onSelect: () => openDelete(user.id),
        },
    ]
}

function openSuspend(id: string) {
    suspendingId.value = id
    suspendOpen.value = true
}

const deletingId = ref<string | null>(null)
const deletingUser = computed(
    () => users.value.find((user) => user.id === deletingId.value) ?? null,
)
const deleteOpen = ref(false)
const {
    password: adminPassword,
    confirm: reauthenticate,
    errorText: reauthError,
} = useReauth(deleteOpen)

function openDelete(id: string) {
    deletingId.value = id
    deleteOpen.value = true
}
const { pending: removing, run: runRemove } = useAsyncAction()

async function deleteUser() {
    const id = deletingId.value
    if (!id) return
    await runRemove(
        async () => {
            await reauthenticate()
            await deletePlatformUser(id)
            users.value = users.value.filter((user) => user.id !== id)
            if (selectedId.value === id) selectedId.value = null
            deleteOpen.value = false
            sheetOpen.value = false
            void refreshSummary()
        },
        {
            success: t('users.deleteSuccess'),
            error: reauthError((error) =>
                (error as { status?: number })?.status === 400
                    ? t('platform.users.lastAdmin')
                    : t('users.deleteError'),
            ),
        },
    )
}
</script>
