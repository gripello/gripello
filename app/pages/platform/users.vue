<template>
    <div class="w-full p-4">
        <LayoutPageHeader :title="t('platform.users.title')" />

        <FilterBar
            v-model="search"
            :search-label="t('platform.users.search')"
            :active-filter-count="kind ? 1 : 0"
            @clear="kind = null"
        >
            <template #filters>
                <div class="contents">
                    <FilterSelect
                        v-model="kind"
                        :label="t('platform.users.show')"
                        :items="kindItems"
                        value-key="value"
                        :placeholder="t('filter.all')"
                        clear
                        data-testid="platform-users-filter"
                        @clear="kind = null"
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

        <LayoutListGroup v-else data-testid="platform-user-list">
            <li
                v-for="user in rows"
                :key="user.id"
                class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
                :data-testid="`platform-user-${user.id}`"
            >
                <AdminMemberIdentity
                    :member="user.identity"
                    class="min-w-0 flex-1 md:max-w-1/2 md:min-w-72 md:flex-none"
                />
                <div
                    class="order-last flex min-w-0 basis-full flex-wrap items-center gap-1.5 md:order-none md:flex-1 md:basis-auto"
                >
                    <UBadge
                        size="sm"
                        :color="user.verified ? 'success' : 'warning'"
                        variant="soft"
                        :icon="
                            user.verified
                                ? 'i-lucide-badge-check'
                                : 'i-lucide-mail-warning'
                        "
                        data-testid="platform-user-verified-badge"
                    >
                        {{
                            user.verified
                                ? t('platform.users.verified')
                                : t('platform.users.unverified')
                        }}
                    </UBadge>
                    <UBadge
                        size="sm"
                        v-if="user.platform_admin"
                        color="primary"
                        variant="soft"
                        icon="i-lucide-shield-check"
                        data-testid="platform-user-admin-badge"
                    >
                        {{ t('platform.users.platformAdmin') }}
                    </UBadge>
                    <UBadge
                        size="sm"
                        v-if="isSuspended(user)"
                        color="error"
                        variant="soft"
                        icon="i-lucide-ban"
                        data-testid="platform-user-suspended-badge"
                    >
                        {{
                            isPermanentlySuspended(user)
                                ? t('platform.users.suspendedPermanently')
                                : t('platform.users.suspendedUntil', {
                                      date: formatDate(user.suspended_until!, {
                                          locale,
                                      }),
                                  })
                        }}
                    </UBadge>
                    <UBadge
                        v-for="chip in user.chips"
                        :key="chip.id"
                        size="sm"
                        color="neutral"
                        variant="outline"
                        class="max-w-full"
                        :data-testid="`platform-user-chip-${chip.gym}`"
                    >
                        <span
                            class="size-2 shrink-0 rounded-full"
                            :class="{ 'bg-muted': !chip.roleColor }"
                            :style="{
                                backgroundColor: chip.roleColor || undefined,
                            }"
                        />
                        <span class="truncate">
                            {{ chip.gymTitle }} · {{ chip.roleName }}
                        </span>
                    </UBadge>
                </div>
                <div class="flex shrink-0 justify-end gap-1">
                    <UButton
                        icon="i-lucide-pencil"
                        color="neutral"
                        variant="ghost"
                        class="icon-btn"
                        :aria-label="t('users.edit')"
                        data-testid="platform-user-edit"
                        @click="openEdit(user.id)"
                    />
                    <UButton
                        icon="i-lucide-ban"
                        color="neutral"
                        variant="ghost"
                        class="icon-btn"
                        :aria-label="t('platform.users.suspend')"
                        :disabled="!!user.platform_admin"
                        data-testid="platform-user-suspend"
                        @click="openSuspend(user.id)"
                    />
                    <UButton
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="ghost"
                        class="icon-btn"
                        :aria-label="t('users.delete')"
                        :disabled="!!user.platform_admin"
                        data-testid="platform-user-delete"
                        @click="openDelete(user.id)"
                    />
                </div>
            </li>
        </LayoutListGroup>

        <div v-if="hasMore" class="mt-4 text-center">
            <UButton
                color="neutral"
                variant="soft"
                :loading="loadingMore"
                data-testid="platform-users-load-more"
                @click="loadMore"
            >
                {{ t('actions.load_more') }}
            </UButton>
        </div>

        <PlatformUserDialog
            v-model="editOpen"
            :user="editingUser"
            :gyms="gyms"
            :roles="roles"
            @changed="reloadLoaded"
            @delete="openDelete"
        />

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
                    name: deletingUser ? userDisplayName(deletingUser) : '',
                })
            "
            :loading="removing"
            @confirm="deleteUser"
        />
    </div>
</template>

<script setup lang="ts">
import type { GymRecord, RoleRecord } from '~/types/models'
import { nameInitials } from '~/utils/avatar'
import { formatDate } from '#shared/utils/formatting'
import {
    PLATFORM_USER_FIELDS,
    isPermanentlySuspended,
    isSuspended,
    membershipChips,
    platformUserFilter,
    userDisplayName,
    type PlatformUser,
    type PlatformUserFilter,
} from '~/utils/platformUsers'

definePageMeta({ middleware: ['auth'], platformAdmin: true })

const { t, locale } = useI18n()
const pb = usePocketbase()

useHead({ title: () => t('platform.users.title') })

const {
    data: lookups,
    error: lookupError,
    refresh: refreshLookups,
} = await useAsyncData(
    'platform-user-lookups',
    async () => {
        const [gyms, roles] = await Promise.all([
            pb.collection('gyms').getFullList<GymRecord>({
                fields: 'id,slug,name,unit_name,active',
                sort: 'name',
                requestKey: null,
            }),
            pb.collection('roles').getFullList<RoleRecord>({
                fields: 'id,gym,name,color',
                sort: 'name',
                requestKey: null,
            }),
        ])
        return { gyms, roles }
    },
    { default: () => ({ gyms: [], roles: [] }) },
)
const gyms = computed(() => lookups.value.gyms)
const roles = computed(() => lookups.value.roles)

const search = ref('')
const emailMatchIds = ref<string[]>([])
const kind = ref<PlatformUserFilter | null>(
    (['platform_admins', 'unverified', 'suspended'] as const).find(
        (value) => value === useRoute().query.show,
    ) ?? null,
)
const kindItems = computed(() => [
    { label: t('platform.overview.admins'), value: 'platform_admins' },
    { label: t('platform.users.unverified'), value: 'unverified' },
    { label: t('platform.overview.suspended'), value: 'suspended' },
])

const {
    items: users,
    loading,
    loadingMore,
    hasMore,
    error,
    refresh: reloadUsers,
    reloadLoaded,
    loadMore,
    prefetch,
} = usePbList<PlatformUser>('users', {
    perPage: 48,
    requestKey: 'platformUsers',
    query: () => ({
        sort: 'email',
        filter: platformUserFilter(
            (raw, params) => pb.filter(raw, params),
            search.value,
            kind.value,
            emailMatchIds.value,
        ),
        expand: 'memberships_via_user',
        fields: PLATFORM_USER_FIELDS,
    }),
})

await prefetch('platform-users')

const rows = computed(() =>
    users.value.map((user) => {
        const displayName = userDisplayName(user) || '?'
        return {
            ...user,
            chips: membershipChips(user, gyms.value, roles.value),
            identity: {
                user: user.id,
                displayName,
                email: user.email ?? '',
                initials: nameInitials(displayName),
                avatarUrl:
                    usePbFileUrl(user, user.avatar, { thumb: '100x100' }) ||
                    null,
            },
        }
    }),
)

let searchDebounce: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
    clearTimeout(searchDebounce)
    searchDebounce = setTimeout(async () => {
        const term = search.value.trim()
        emailMatchIds.value = term
            ? (
                  await pb.send<{ ids: string[] }>(
                      '/api/platform/users/email-matches',
                      { query: { q: term }, requestKey: null },
                  )
              ).ids
            : []
        await reloadUsers()
    }, 300)
})
watch(kind, () => reloadUsers())

function reloadAll() {
    return Promise.all([refreshLookups(), reloadUsers()])
}

const editingId = ref<string | null>(null)
const editingUser = computed<PlatformUser | null>(
    (previous) =>
        users.value.find((user) => user.id === editingId.value) ??
        (previous?.id === editingId.value ? previous : null),
)
const editOpen = ref(false)

function openEdit(id: string) {
    editingId.value = id
    editOpen.value = true
}

const suspendingId = ref<string | null>(null)
const suspendingUser = computed(
    () => users.value.find((user) => user.id === suspendingId.value) ?? null,
)
const suspendOpen = ref(false)

function openSuspend(id: string) {
    suspendingId.value = id
    suspendOpen.value = true
}

const deletingId = ref<string | null>(null)
const deletingUser = computed(
    () => users.value.find((user) => user.id === deletingId.value) ?? null,
)
const deleteOpen = ref(false)

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
            await pb.collection('users').delete(id)
            users.value = users.value.filter((user) => user.id !== id)
            deleteOpen.value = false
            editOpen.value = false
        },
        {
            success: t('users.deleteSuccess'),
            error: (error) =>
                (error as { status?: number })?.status === 400
                    ? t('platform.users.lastAdmin')
                    : t('users.deleteError'),
        },
    )
}
</script>
