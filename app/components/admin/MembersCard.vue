<template>
    <div data-testid="members-card">
        <FilterBar
            v-model="search"
            :search-label="t('members.search')"
            :active-filter-count="selectedRole ? 1 : 0"
            @clear="clearFilters"
        >
            <template #filters>
                <div class="contents">
                    <FilterSelect
                        :label="t('members.role')"
                        v-model="selectedRole"
                        :items="roleOptions"
                        value-key="value"
                        :placeholder="t('filter.all')"
                        clear
                        data-testid="users-filter-role"
                        @clear="selectedRole = null"
                    />
                </div>
            </template>
        </FilterBar>

        <AdminPendingInvites ref="pendingInvites" :gym-id="gymId" />

        <LayoutLoadingState v-if="loading && !members.length" />

        <LayoutEmptyState
            v-else-if="!loading && !members.length"
            icon="i-lucide-user-x"
            :title="t('members.noMembers')"
            :hint="t('users.noUsersHint')"
        />

        <UTable
            v-else-if="mdAndUp"
            :data="members"
            :columns="columns"
            class="rounded-lg bg-default ring ring-default"
            data-testid="members-table"
        >
            <template #member-cell="{ row }">
                <AdminMemberIdentity :member="row.original" />
            </template>
            <template #role-cell="{ row }">
                <USelect
                    :model-value="row.original.role"
                    :items="assignableRoleOptions"
                    value-key="value"
                    :aria-label="t('members.role')"
                    class="w-44"
                    :disabled="!canManage(row.original)"
                    data-testid="member-card-role"
                    @update:model-value="
                        (role) => changeRole(row.original, String(role))
                    "
                />
            </template>
            <template #actions-cell="{ row }">
                <div class="flex justify-end">
                    <UDropdownMenu
                        :items="memberMenu(row.original)"
                        :disabled="!canManage(row.original)"
                    >
                        <UButton
                            icon="i-lucide-ellipsis-vertical"
                            color="neutral"
                            variant="ghost"
                            class="icon-btn"
                            :disabled="!canManage(row.original)"
                            :aria-label="t('members.rowActions')"
                            data-testid="member-card-menu"
                        />
                    </UDropdownMenu>
                </div>
            </template>
        </UTable>

        <LayoutListGroup v-else data-testid="members-list">
            <li
                v-for="member in members"
                :key="member.id"
                class="flex flex-col gap-2 px-4 py-3"
            >
                <AdminMemberIdentity :member="member" />
                <div class="flex items-center gap-2">
                    <USelect
                        :model-value="member.role"
                        :items="assignableRoleOptions"
                        value-key="value"
                        :aria-label="t('members.role')"
                        class="min-w-0 flex-1"
                        :disabled="!canManage(member)"
                        data-testid="member-card-role"
                        @update:model-value="
                            (role) => changeRole(member, String(role))
                        "
                    />
                    <UDropdownMenu
                        :items="memberMenu(member)"
                        :disabled="!canManage(member)"
                    >
                        <UButton
                            icon="i-lucide-ellipsis-vertical"
                            color="neutral"
                            variant="ghost"
                            class="icon-btn"
                            :disabled="!canManage(member)"
                            :aria-label="t('members.rowActions')"
                            data-testid="member-card-menu"
                        />
                    </UDropdownMenu>
                </div>
            </li>
        </LayoutListGroup>

        <div v-if="!loading && members.length" class="text-center mt-4">
            <UButton
                v-if="hasMore"
                color="neutral"
                variant="soft"
                :loading="loadingMore"
                data-testid="users-load-more"
                @click="loadMore"
            >
                {{ t('actions.load_more') }}
            </UButton>
        </div>

        <LayoutDialogShell
            v-model="inviteDialog"
            :title="t('members.invite')"
            sheet-on-mobile
            closable
            data-testid="member-invite-dialog"
            :submit-label="t('members.invite')"
            submit-icon="i-lucide-user-plus"
            :submit-loading="inviting"
            submit-test-id="member-invite-submit"
            cancel-test-id="member-invite-cancel"
            @submit="inviteForm?.submit()"
        >
            <UForm
                ref="inviteForm"
                :state="invite"
                :validate="validateInvite"
                @submit="sendInvite"
            >
                <UFormField
                    :label="t('members.email')"
                    name="email"
                    class="mb-4"
                >
                    <UInput
                        v-model="invite.email"
                        type="email"
                        autocomplete="off"
                        class="w-full"
                        data-testid="member-invite-email"
                    />
                </UFormField>
                <div class="mb-4 grid grid-cols-2 gap-3">
                    <UFormField
                        :label="t('account.firstname')"
                        name="firstname"
                    >
                        <UInput
                            v-model="invite.firstname"
                            class="w-full"
                            data-testid="member-invite-firstname"
                        />
                    </UFormField>
                    <UFormField :label="t('account.lastname')" name="name">
                        <UInput
                            v-model="invite.name"
                            class="w-full"
                            data-testid="member-invite-lastname"
                        />
                    </UFormField>
                </div>
                <UFormField :label="t('members.role')" name="role">
                    <USelect
                        v-model="invite.role"
                        :items="
                            assignableRoleOptions.filter(
                                (option) => !option.disabled,
                            )
                        "
                        value-key="value"
                        class="w-full"
                        data-testid="member-invite-role"
                    />
                </UFormField>
            </UForm>
        </LayoutDialogShell>

        <ConfirmDialog
            v-model="removeDialog"
            :title="t('members.remove')"
            :message="t('members.removeConfirm')"
            :loading="removing"
            @confirm="removeMember"
        />
    </div>
</template>

<script setup lang="ts">
import { gymTopic } from '#shared/utils/topics'
import { displayName, avatarUrl } from '~/utils/avatar'
import { useTimeoutFn } from '@vueuse/core'
import type { GymEvent } from '~/composables/useRealtime'
import type { Form, TableColumn } from '@nuxt/ui'
import { required, validEmail, validateRules } from '~/utils/validation'
import { blockedFieldError } from '~/utils/fieldErrors'
import { canGrantRole, membershipIn } from '#shared/utils/memberships'
import { roleLabel } from '~/utils/roles'
import {
    changeMembershipRole,
    deleteMembership,
    inviteMember,
    listMembers,
    type Member as ApiMember,
} from '~/api/members'

type Member = {
    id: string
    user: string
    role: string
    displayName: string
    email: string
    username: string
    initials: string
    avatarUrl: string | null
}

const { t } = useI18n()
const authStore = useAuthStore()
const props = defineProps<{ gymId: string }>()
const gymId = computed(() => props.gymId)

const pageRoute = useRoute()
const search = ref(String(pageRoute.query.search ?? ''))
watch(
    () => pageRoute.query.search,
    (value) => (search.value = String(value ?? '')),
)
const selectedRole = ref<string | null>(null)
const { mdAndUp } = useDisplay()
const columns = computed<TableColumn<Member>[]>(() => [
    {
        id: 'member',
        header: t('members.title'),
        meta: { class: { th: 'w-full', td: 'w-full max-w-0' } },
    },
    {
        id: 'role',
        header: t('members.role'),
        meta: { class: { th: 'w-px', td: 'w-px' } },
    },
    { id: 'actions', meta: { class: { th: 'w-px', td: 'w-px' } } },
])
const currentUserId = computed(() => authStore.record?.id ?? null)

const { data: roles, refresh: refreshRoles } = useRoles(gymId)
const { memberships: ownMemberships, isPlatformAdmin } = usePermissions()
const roleOptions = computed(() =>
    roles.value.map((role) => ({
        label: roleLabel(role.name, t),
        value: role.id,
    })),
)
const grantableRoleIds = computed(() => {
    const ownRole = membershipIn(ownMemberships.value, gymId.value)?.role
    return new Set(
        roles.value
            .filter((role) =>
                canGrantRole(role, ownRole, isPlatformAdmin.value),
            )
            .map((role) => role.id),
    )
})
const assignableRoleOptions = computed(() =>
    roleOptions.value.map((option) => ({
        ...option,
        disabled: !grantableRoleIds.value.has(option.value),
    })),
)

function memberMenu(member: Member) {
    return [
        {
            label: t('members.remove'),
            icon: 'i-lucide-user-minus',
            color: 'error' as const,
            'data-testid': 'member-card-remove',
            onSelect: () => confirmRemove(member),
        },
    ]
}

function canManage(member: Member) {
    return (
        member.user !== currentUserId.value &&
        grantableRoleIds.value.has(member.role)
    )
}

function mapMember({ id, user, role }: ApiMember): Member {
    return {
        id,
        user: user.id,
        role: role.id,
        displayName: displayName(user, '?'),
        email: user.email ?? '',
        username: user.username ?? '',
        initials:
            [user.firstname, user.name]
                .map((part) => part?.[0]?.toUpperCase() ?? '')
                .join('') || '?',
        avatarUrl: avatarUrl(user) || null,
    }
}

const {
    items: members,
    loading,
    loadingMore,
    hasMore,
    refresh: reloadMembers,
    reloadLoaded,
    loadMore,
    prefetch,
} = useList<ApiMember, Member>(
    (page, limit) =>
        listMembers(gymId.value, {
            q: search.value.trim(),
            role: selectedRole.value ?? undefined,
            sort: '-created',
            page,
            limit,
            total: true,
        }),
    { perPage: 48, map: mapMember },
)

function clearFilters() {
    selectedRole.value = null
}

const { start: reloadMembersSoon } = useTimeoutFn(() => reloadMembers(), 300, {
    immediate: false,
})
watch(search, () => reloadMembersSoon())
watch(selectedRole, () => reloadMembers())

const { pending: changingRole, run: runRoleChange } = useAsyncAction()

async function changeRole(member: Member, role: string) {
    if (changingRole.value || role === member.role) return
    await runRoleChange(
        async () => {
            await changeMembershipRole(member.id, role)
            await reloadLoaded()
        },
        {
            success: t('notifications.success.edit'),
            error: t('notifications.error.generic'),
        },
    )
}

const inviteDialog = ref(false)
const invite = reactive({ email: '', role: '', firstname: '', name: '' })
const inviteForm = ref<Form<typeof invite> | null>(null)
const pendingInvites = useTemplateRef<{ refresh: () => Promise<void> }>(
    'pendingInvites',
)
const { pending: inviting, run: runInvite } = useAsyncAction()
const { success: notifySuccess } = useNotification()

function validateInvite(state: typeof invite) {
    return validateRules(state, {
        email: [required(t), validEmail(t)],
        role: [required(t)],
    })
}

function openInvite() {
    invite.email = ''
    invite.firstname = ''
    invite.name = ''
    const grantable = roles.value.filter((role) =>
        grantableRoleIds.value.has(role.id),
    )
    invite.role =
        grantable.find((role) => role.name !== 'admin')?.id ??
        grantable[0]?.id ??
        ''
    inviteDialog.value = true
}

function inviteErrorMessage(error: unknown) {
    const status = (error as { status?: number })?.status
    if (status === 409) return t('members.alreadyMember')
    const blocked = blockedFieldError(error, ['email', 'name'])
    return t(blocked?.key ?? 'notifications.error.generic')
}

async function sendInvite() {
    await runInvite(
        async () => {
            await inviteMember(gymId.value, {
                email: invite.email.trim(),
                role: invite.role,
                firstname: invite.firstname.trim(),
                name: invite.name.trim(),
            })
            inviteDialog.value = false
            notifySuccess(t('members.invited'))
            await pendingInvites.value?.refresh()
        },
        { error: inviteErrorMessage },
    )
}

const removeDialog = ref(false)
const removingMember = ref<Member | null>(null)
const { pending: removing, run: runRemove } = useAsyncAction()

function confirmRemove(member: Member) {
    removingMember.value = member
    removeDialog.value = true
}

async function removeMember() {
    const target = removingMember.value
    if (!target) return
    await runRemove(
        async () => {
            await deleteMembership(target.id)
            members.value = members.value.filter(
                (member) => member.id !== target.id,
            )
            removeDialog.value = false
            removingMember.value = null
        },
        {
            success: t('members.removed'),
            error: t('notifications.error.generic'),
        },
    )
}

defineExpose({ openInvite })

void prefetch(`admin-members-${props.gymId}`)

useLiveRefresh(
    () => gymTopic(gymId.value),
    () => Promise.all([refreshRoles(), reloadLoaded()]),
    {
        when: (event: GymEvent) =>
            event.kind === 'membership.changed' ||
            event.kind === 'role.changed',
    },
)
</script>
