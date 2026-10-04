<template>
    <section>
        <USkeleton v-if="loading" class="h-96 w-full rounded-lg" />

        <LayoutEmptyState
            v-else-if="!roles.length"
            icon="i-lucide-shield-off"
            :title="t('permissions.noRoles')"
        />

        <div
            v-else
            class="grid items-start gap-4 md:grid-cols-[18rem_minmax(0,1fr)]"
        >
            <ul
                class="divide-y divide-default overflow-hidden rounded-lg border border-default bg-default md:sticky md:top-20"
                :class="{ 'hidden md:block': routeRoleId }"
                data-testid="role-list"
            >
                <li v-for="role in roles" :key="role.id">
                    <button
                        type="button"
                        class="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-start transition-colors hover:bg-elevated/50"
                        :class="{
                            'md:bg-elevated': role.id === selectedRole?.id,
                        }"
                        :aria-current="
                            role.id === selectedRole?.id ? 'true' : undefined
                        "
                        :data-testid="`role-permissions-row-${role.name}`"
                        @click="selectRole(role)"
                    >
                        <AdminRoleBadge
                            :color="role.color"
                            :data-testid="`role-color-${role.name}`"
                        />
                        <span
                            class="min-w-0 flex-1 truncate font-medium text-highlighted"
                        >
                            {{ role.name }}
                        </span>
                        <UBadge
                            color="neutral"
                            variant="soft"
                            size="sm"
                            :data-testid="`role-granted-${role.name}`"
                        >
                            {{ grantedCount(role) }}/{{ allPermissions.length }}
                        </UBadge>
                        <UBadge
                            color="neutral"
                            variant="outline"
                            size="sm"
                            icon="i-lucide-users-round"
                            :label="String(memberCount(role))"
                            :aria-label="memberCountLabel(role)"
                            :title="memberCountLabel(role)"
                            :data-testid="`role-members-${role.name}`"
                        />
                        <UIcon
                            name="i-lucide-chevron-right"
                            class="size-4 shrink-0 text-dimmed md:hidden"
                        />
                    </button>
                </li>
            </ul>

            <div
                v-if="selectedRole"
                class="min-w-0"
                :class="{ 'hidden md:block': !routeRoleId }"
                data-testid="role-detail"
            >
                <UButton
                    icon="i-lucide-arrow-left"
                    color="neutral"
                    variant="link"
                    class="mb-2 px-0 md:hidden"
                    :label="t('permissions.backToRoles')"
                    data-testid="role-detail-back"
                    @click="selectRole(null)"
                />

                <div class="mb-4 flex items-start gap-3">
                    <AdminRoleBadge :color="selectedRole.color" size="lg" />
                    <div class="min-w-0 flex-1">
                        <h2
                            class="truncate text-lg font-semibold text-highlighted"
                        >
                            {{ selectedRole.name }}
                        </h2>
                        <p
                            v-if="selectedRole.description"
                            class="text-sm text-muted"
                        >
                            {{ selectedRole.description }}
                        </p>
                        <p
                            class="flex items-center gap-1 text-sm text-muted"
                            data-testid="role-detail-members"
                        >
                            <UIcon
                                name="i-lucide-users-round"
                                class="size-4 shrink-0"
                            />
                            {{ memberCountLabel(selectedRole) }}
                        </p>
                    </div>
                    <div class="flex shrink-0">
                        <UTooltip :text="t('permissions.editRole')">
                            <UButton
                                icon="i-lucide-pencil"
                                color="neutral"
                                variant="ghost"
                                class="icon-btn"
                                :aria-label="t('permissions.editRole')"
                                :data-testid="`role-edit-${selectedRole.name}`"
                                @click="startEdit(selectedRole)"
                            />
                        </UTooltip>
                        <UTooltip :text="t('permissions.duplicateRole')">
                            <UButton
                                icon="i-lucide-copy"
                                color="neutral"
                                variant="ghost"
                                class="icon-btn"
                                :aria-label="t('permissions.duplicateRole')"
                                :data-testid="`role-duplicate-${selectedRole.name}`"
                                @click="startDuplicate(selectedRole)"
                            />
                        </UTooltip>
                        <UTooltip
                            v-if="!isProtectedRole(selectedRole)"
                            :text="t('permissions.deleteRole')"
                        >
                            <UButton
                                icon="i-lucide-trash-2"
                                color="error"
                                variant="ghost"
                                class="icon-btn"
                                :aria-label="t('permissions.deleteRole')"
                                :data-testid="`role-delete-${selectedRole.name}`"
                                @click="confirmDelete(selectedRole)"
                            />
                        </UTooltip>
                    </div>
                </div>

                <div class="flex flex-col gap-4">
                    <section
                        v-for="group in permissionGroups"
                        :key="group.key"
                        class="rounded-lg border border-default bg-default"
                        :data-testid="`role-group-${group.key}`"
                    >
                        <div
                            class="flex items-center gap-2 border-b border-default px-4 py-3"
                        >
                            <UIcon
                                :name="group.icon"
                                class="size-4 shrink-0 text-muted"
                            />
                            <h3
                                class="min-w-0 flex-1 truncate font-semibold text-highlighted"
                            >
                                {{ t(`permissions.groups.${group.key}`) }}
                            </h3>
                            <UCheckbox
                                :model-value="
                                    groupState(selectedRole, group.permissions)
                                "
                                :disabled="
                                    isProtectedRole(selectedRole) || saving
                                "
                                :aria-label="
                                    t(`permissions.groups.${group.key}`)
                                "
                                :data-testid="`role-group-toggle-${selectedRole.name}-${group.key}`"
                                @update:model-value="
                                    toggleGroup(selectedRole, group.permissions)
                                "
                            />
                        </div>
                        <div class="grid gap-x-6 px-4 py-1 lg:grid-cols-2">
                            <USwitch
                                v-for="perm in group.permissions"
                                :key="perm.id"
                                :model-value="
                                    hasPermission(selectedRole, perm.id)
                                "
                                :disabled="
                                    isProtectedRole(selectedRole) || saving
                                "
                                :label="t('permissions.features.' + perm.name)"
                                class="py-2.5"
                                :data-testid="`role-permissions-${selectedRole.name}-${perm.name}`"
                                @update:model-value="
                                    togglePermission(selectedRole, perm)
                                "
                            />
                        </div>
                    </section>
                </div>
            </div>
        </div>

        <AdminRoleFormDialog
            :role="editingRole"
            @saved="onRoleSaved"
            @close="editingRole = null"
        />

        <ConfirmDialog
            v-model="lockoutDialog"
            :title="t('permissions.lockoutTitle')"
            :message="t('permissions.lockoutConfirm')"
            :confirm-text="t('permissions.lockoutConfirmAction')"
            @confirm="confirmLockout"
        />

        <LayoutDialogShell
            v-model="deleteDialog"
            :title="t('permissions.deleteRole')"
            sheet-on-mobile
            data-testid="role-delete-dialog"
        >
            <p class="text-sm mb-4">
                {{
                    deletingRole
                        ? t('permissions.deleteRoleConfirm', {
                              name: deletingRole.name,
                          })
                        : ''
                }}
            </p>

            <template v-if="holderCount > 0">
                <UAlert
                    color="warning"
                    variant="soft"
                    icon="i-lucide-triangle-alert"
                    class="mb-4"
                    :description="
                        t(
                            'permissions.deleteRoleReassign',
                            { n: holderCount },
                            holderCount,
                        )
                    "
                    data-testid="role-delete-holders"
                />

                <UFormField :label="t('permissions.reassignTo')">
                    <USelect
                        v-model="reassignTo"
                        :items="reassignOptions"
                        icon="i-lucide-user-round-cog"
                        class="w-full"
                        data-testid="role-delete-reassign"
                    />
                </UFormField>
            </template>

            <template #actions>
                <UButton
                    color="neutral"
                    variant="ghost"
                    data-testid="role-delete-cancel"
                    @click="deleteDialog = false"
                >
                    {{ t('actions.cancel') }}
                </UButton>
                <div class="flex-1" />
                <UButton
                    color="error"
                    :loading="deleting || countingHolders"
                    :disabled="
                        countingHolders || (holderCount > 0 && !reassignTo)
                    "
                    icon="i-lucide-trash-2"
                    data-testid="role-delete-confirm"
                    @click="deleteRole"
                >
                    {{ t('actions.delete') }}
                </UButton>
            </template>
        </LayoutDialogShell>
    </section>
</template>

<script setup lang="ts">
import { isAbortError } from '~/utils/errors'
import {
    groupPermissions,
    isProtectedRole,
    reassignTargets,
    defaultReassignTarget,
    memberCountsByRole,
    revokesOwnAccess,
} from '~/utils/roles'
import { membershipIn } from '#shared/utils/memberships'
import type { PermissionRecord, RoleRecord } from '~/types/models'
import { coalesce } from '~/utils/realtimeCache'
import { withSelectedRole } from '~/utils/adminUsersTab'

const { t } = useI18n()
const pb = usePocketbase()
const gymId = useCurrentGymId()
const { memberships: ownMemberships, isPlatformAdmin } = usePermissions()

const REASSIGN_BATCH_SIZE = 200

const loading = ref(true)
const { pending: saving, run: runSave } = useAsyncAction()
const roles = ref<RoleRecord[]>([])
const allPermissions = ref<PermissionRecord[]>([])
const memberCounts = ref<Record<string, number>>({})
const { notify, error: notifyError } = useNotification()

const editingRole = ref<Partial<RoleRecord> | null>(null)

const deleteDialog = ref(false)
const deletingRole = ref<RoleRecord | null>(null)
const holderCount = ref(0)
const countingHolders = ref(false)
const reassignTo = ref<string>()
const { pending: deleting, run: runDelete } = useAsyncAction()

const reassignOptions = computed(() =>
    deletingRole.value
        ? reassignTargets(roles.value, deletingRole.value.id).map((role) => ({
              label: role.name,
              value: role.id,
          }))
        : [],
)

function grantedCount(role: RoleRecord) {
    return (role.permissions ?? []).length
}

function memberCount(role: RoleRecord) {
    return memberCounts.value[role.id] ?? 0
}

function memberCountLabel(role: RoleRecord) {
    const n = memberCount(role)
    return t('permissions.memberCount', { n }, n)
}

function hasPermission(role: RoleRecord, permId: string) {
    const perms = role.permissions ?? []
    return perms.includes(permId)
}

const route = useRoute()
const router = useRouter()
const routeRoleId = computed(() =>
    typeof route.query.role === 'string' ? route.query.role : null,
)
const selectedRole = computed(
    () =>
        roles.value.find((role) => role.id === routeRoleId.value) ??
        roles.value[0],
)

function selectRole(role: Pick<RoleRecord, 'id'> | null) {
    return router.push({
        query: withSelectedRole(route.query, role?.id ?? null),
        hash: route.hash,
    })
}

const permissionGroups = computed(() => groupPermissions(allPermissions.value))

function groupState(role: RoleRecord, group: PermissionRecord[]) {
    const granted = group.filter((perm) => hasPermission(role, perm.id)).length
    if (granted === 0) return false
    return granted === group.length ? true : 'indeterminate'
}

function toggleGroup(role: RoleRecord, group: PermissionRecord[]) {
    const ids = group.map((perm) => perm.id)
    const current = role.permissions ?? []
    const grantAll = groupState(role, group) !== true
    return savePermissions(
        role,
        grantAll
            ? [...new Set([...current, ...ids])]
            : current.filter((id) => !ids.includes(id)),
    )
}

function togglePermission(role: RoleRecord, perm: PermissionRecord) {
    const current = role.permissions ?? []
    return savePermissions(
        role,
        current.includes(perm.id)
            ? current.filter((id) => id !== perm.id)
            : [...current, perm.id],
    )
}

const lockoutDialog = ref(false)
const pendingChange = shallowRef<{ role: RoleRecord; perms: string[] }>()

function savePermissions(role: RoleRecord, perms: string[]) {
    const risky = revokesOwnAccess({
        role,
        nextPermissions: perms,
        permissions: allPermissions.value,
        ownRoleId: membershipIn(ownMemberships.value, gymId.value)?.role,
        platformAdmin: isPlatformAdmin.value,
    })
    if (!risky) return persistPermissions(role, perms)
    pendingChange.value = { role, perms }
    lockoutDialog.value = true
}

function confirmLockout() {
    lockoutDialog.value = false
    const change = pendingChange.value
    pendingChange.value = undefined
    if (change) return persistPermissions(change.role, change.perms)
}

async function persistPermissions(role: RoleRecord, currentPerms: string[]) {
    const previousPerms = role.permissions ?? []
    role.permissions = currentPerms
    const saved = await runSave(
        async () => {
            await pb.collection('roles').update(role.id, {
                permissions: currentPerms,
            })
            return true
        },
        {
            success: t('permissions.updated'),
            error: t('permissions.updateError'),
        },
    )
    if (!saved) role.permissions = previousPerms
}

function startCreate() {
    editingRole.value = { name: '', description: '', color: '' }
}

function startDuplicate(role: RoleRecord) {
    editingRole.value = {
        name: t('permissions.copyName', { name: role.name }),
        description: role.description ?? '',
        color: role.color ?? '',
        permissions: [...(role.permissions ?? [])],
    }
}

function startEdit(role: RoleRecord) {
    editingRole.value = { ...role }
}

async function onRoleSaved(kind: 'created' | 'updated', roleId: string) {
    editingRole.value = null
    if (kind === 'created') void selectRole({ id: roleId })
    notify(
        t(
            kind === 'created'
                ? 'permissions.roleCreated'
                : 'permissions.roleUpdated',
        ),
        'success',
    )
    await refreshRoles()
}

async function refreshRoles() {
    await Promise.all([fetchData({ silent: true }), refreshNuxtData('roles')])
}

async function confirmDelete(role: RoleRecord) {
    deletingRole.value = role
    holderCount.value = 0
    countingHolders.value = true
    reassignTo.value = defaultReassignTarget(roles.value, role.id) ?? undefined
    deleteDialog.value = true

    try {
        const held = await pb.collection('memberships').getList(1, 1, {
            filter: pb.filter('role = {:id}', { id: role.id }),
            fields: 'id',
            requestKey: 'roleHolderCount',
        })
        holderCount.value = held.totalItems
    } catch (err) {
        if (isAbortError(err)) return
        console.error('Failed to count role holders:', err)
        notifyError(t('permissions.loadError'))
        deleteDialog.value = false
    } finally {
        countingHolders.value = false
    }
}

async function deleteRole() {
    const role = deletingRole.value
    if (!role) return

    await runDelete(
        async () => {
            if (holderCount.value > 0) {
                const holders = await pb.collection('memberships').getFullList({
                    filter: pb.filter('role = {:id}', { id: role.id }),
                    fields: 'id',
                    requestKey: 'roleHolders',
                })
                for (let i = 0; i < holders.length; i += REASSIGN_BATCH_SIZE) {
                    const batch = pb.createBatch()
                    for (const u of holders.slice(i, i + REASSIGN_BATCH_SIZE)) {
                        batch.collection('memberships').update(u.id, {
                            role: reassignTo.value,
                        })
                    }
                    await batch.send()
                }
            }

            await pb.collection('roles').delete(role.id)
            if (routeRoleId.value === role.id) await selectRole(null)
            deleteDialog.value = false
            deletingRole.value = null
            await refreshRoles()
        },
        {
            success: t('permissions.roleDeleted'),
            error: t('permissions.roleDeleteError'),
        },
    )
}

async function fetchData({ silent = false } = {}) {
    if (!silent) loading.value = true
    try {
        const [rolesData, permsData, membershipsData] = await Promise.all([
            pb.collection('roles').getFullList<RoleRecord>({
                filter: pb.filter('gym = {:gym}', { gym: gymId.value }),
                sort: 'name',
                requestKey: 'rolePermEditor_roles',
            }),
            pb.collection('permissions').getFullList<PermissionRecord>({
                sort: 'name',
                requestKey: 'rolePermEditor_perms',
            }),
            pb.collection('memberships').getFullList<{ role: string }>({
                filter: gymFilter(pb, gymId.value),
                fields: 'role',
                requestKey: 'rolePermEditor_members',
            }),
        ])
        roles.value = rolesData
        allPermissions.value = permsData
        memberCounts.value = memberCountsByRole(membershipsData)
    } catch (err) {
        if (isAbortError(err)) return
        console.error('Failed to fetch roles/permissions:', err)
        notifyError(t('permissions.loadError'))
    } finally {
        loading.value = false
    }
}

const { data: initial } = useAsyncData(
    'role-permissions',
    async () => {
        await fetchData()
        return {
            roles: roles.value,
            permissions: allPermissions.value,
            memberCounts: memberCounts.value,
        }
    },
    { watch: [gymId] },
)

if (initial.value) {
    roles.value = initial.value.roles
    allPermissions.value = initial.value.permissions
    memberCounts.value = initial.value.memberCounts
    loading.value = false
}

defineExpose({ startCreate })

const fetchDataSoon = coalesce(() => fetchData({ silent: true }))
const { subscribe } = usePbSubscription(fetchDataSoon)
onMounted(() => {
    void subscribe('roles', fetchDataSoon)
    void subscribe('permissions', fetchDataSoon)
    void subscribe('memberships', fetchDataSoon)
})
</script>
