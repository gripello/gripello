<template>
    <section class="role-section">
        <LayoutSectionHeader
            :title="t('permissions.title')"
            :subtitle="t('permissions.subtitle')"
        >
            <template #actions>
                <UButton
                    color="primary"
                    icon="i-lucide-shield-plus"
                    data-testid="role-create-open"
                    @click="startCreate"
                >
                    {{ t('permissions.addRole') }}
                </UButton>
            </template>
        </LayoutSectionHeader>

        <div v-if="loading" class="grid grid-cols-12 gap-4">
            <USkeleton
                v-for="i in 3"
                :key="i"
                class="col-span-12 h-48 rounded-lg md:col-span-6 lg:col-span-4"
            />
        </div>

        <LayoutEmptyState
            v-else-if="!roles.length"
            icon="i-lucide-shield-off"
            :title="t('permissions.noRoles')"
        />

        <div
            v-else
            class="grid grid-cols-12 gap-4"
            data-testid="role-permissions-table"
        >
            <div
                v-for="role in roles"
                :key="role.id"
                class="col-span-12 md:col-span-6 lg:col-span-4"
            >
                <div
                    class="role-card flex h-full flex-col rounded-lg border bg-default"
                    :data-testid="`role-permissions-row-${role.name}`"
                >
                    <div class="flex items-center gap-3 px-4 pb-1 pt-3">
                        <span
                            class="inline-flex size-[42px] shrink-0 items-center justify-center rounded-full"
                            :class="{ 'bg-elevated': !role.color }"
                            :style="{
                                backgroundColor: role.color || undefined,
                                color: readableTextOn(role.color),
                            }"
                            :data-testid="`role-color-${role.name}`"
                        >
                            <UIcon
                                name="i-lucide-shield-user"
                                class="size-[20px]"
                            />
                        </span>

                        <div class="min-w-0 flex-1">
                            <div class="text-sm font-semibold card-title-tight">
                                {{ role.name }}
                            </div>
                            <div
                                class="text-xs card-subtitle-muted text-muted whitespace-normal"
                            >
                                {{
                                    role.description ||
                                    t('permissions.noDescription')
                                }}
                            </div>
                        </div>

                        <UBadge
                            color="neutral"
                            variant="soft"
                            :data-testid="`role-granted-${role.name}`"
                        >
                            {{ grantedCount(role) }}/{{ allPermissions.length }}
                        </UBadge>
                    </div>

                    <USeparator class="mt-3" />

                    <div class="flex grow flex-col gap-4 px-4 py-3">
                        <div
                            v-for="group in permissionGroups"
                            :key="group.key"
                            class="flex flex-col gap-2"
                            :data-testid="`role-group-${role.name}-${group.key}`"
                        >
                            <UCheckbox
                                :model-value="
                                    groupState(role, group.permissions)
                                "
                                :disabled="isProtectedRole(role) || saving"
                                :ui="{
                                    label: 'flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase',
                                }"
                                :data-testid="`role-group-toggle-${role.name}-${group.key}`"
                                @update:model-value="
                                    toggleGroup(role, group.permissions)
                                "
                            >
                                <template #label>
                                    <UIcon
                                        :name="group.icon"
                                        class="size-3.5"
                                    />
                                    {{ t(`permissions.groups.${group.key}`) }}
                                </template>
                            </UCheckbox>
                            <div class="grid grid-cols-12 gap-2 ps-6">
                                <UCheckbox
                                    v-for="perm in group.permissions"
                                    :key="perm.id"
                                    :model-value="hasPermission(role, perm.id)"
                                    :label="
                                        t('permissions.features.' + perm.name)
                                    "
                                    :disabled="isProtectedRole(role) || saving"
                                    class="col-span-12 sm:col-span-6"
                                    :data-testid="`role-permissions-${role.name}-${perm.name}`"
                                    @update:model-value="
                                        togglePermission(role, perm)
                                    "
                                />
                            </div>
                        </div>
                    </div>

                    <div class="flex justify-end gap-1 px-2 pb-2">
                        <UTooltip :text="t('permissions.editRole')">
                            <UButton
                                icon="i-lucide-pencil"
                                color="neutral"
                                variant="ghost"
                                :aria-label="t('permissions.editRole')"
                                :data-testid="`role-edit-${role.name}`"
                                @click="startEdit(role)"
                            />
                        </UTooltip>
                        <UTooltip
                            v-if="!isProtectedRole(role)"
                            :text="t('permissions.deleteRole')"
                        >
                            <UButton
                                icon="i-lucide-trash-2"
                                color="error"
                                variant="ghost"
                                :aria-label="t('permissions.deleteRole')"
                                :data-testid="`role-delete-${role.name}`"
                                @click="confirmDelete(role)"
                            />
                        </UTooltip>
                    </div>
                </div>
            </div>
        </div>

        <AdminRoleFormDialog
            :role="editingRole"
            @saved="onRoleSaved"
            @close="editingRole = null"
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
} from '~/utils/roles'
import { readableTextOn } from '~/utils/color'
import type { PermissionRecord, RoleRecord } from '~/types/models'
import { coalesce } from '~/utils/realtimeCache'

const { t } = useI18n()
const pb = usePocketbase()
const gymId = useCurrentGymId()

const REASSIGN_BATCH_SIZE = 200

const loading = ref(true)
const { pending: saving, run: runSave } = useAsyncAction()
const roles = ref<RoleRecord[]>([])
const allPermissions = ref<PermissionRecord[]>([])
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

function hasPermission(role: RoleRecord, permId: string) {
    const perms = role.permissions ?? []
    return perms.includes(permId)
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

async function savePermissions(role: RoleRecord, currentPerms: string[]) {
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

// ── Create / edit ──────────────────────────────────────────────────────────

function startCreate() {
    editingRole.value = { name: '', description: '', color: '' }
}

function startEdit(role: RoleRecord) {
    editingRole.value = { ...role }
}

async function onRoleSaved(kind: 'created' | 'updated') {
    editingRole.value = null
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

// ── Delete ─────────────────────────────────────────────────────────────────

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

// ── Data ───────────────────────────────────────────────────────────────────

async function fetchData({ silent = false } = {}) {
    if (!silent) loading.value = true
    try {
        const [rolesData, permsData] = await Promise.all([
            pb.collection('roles').getFullList<RoleRecord>({
                filter: pb.filter('gym = {:gym}', { gym: gymId.value }),
                sort: 'name',
                requestKey: 'rolePermEditor_roles',
            }),
            pb.collection('permissions').getFullList<PermissionRecord>({
                sort: 'name',
                requestKey: 'rolePermEditor_perms',
            }),
        ])
        roles.value = rolesData
        allPermissions.value = permsData
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
        return { roles: roles.value, permissions: allPermissions.value }
    },
    { watch: [gymId] },
)

if (initial.value) {
    roles.value = initial.value.roles
    allPermissions.value = initial.value.permissions
    loading.value = false
}

const fetchDataSoon = coalesce(() => fetchData({ silent: true }))
const { subscribe } = usePbSubscription(fetchDataSoon)
onMounted(() => {
    void subscribe('roles', fetchDataSoon)
    void subscribe('permissions', fetchDataSoon)
})
</script>
