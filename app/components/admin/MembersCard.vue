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

        <LayoutLoadingState v-if="loading && !members.length" variant="cards" />

        <LayoutEmptyState
            v-else-if="!loading && !members.length"
            icon="i-lucide-user-x"
            :title="t('members.noMembers')"
            :hint="t('users.noUsersHint')"
        />

        <div v-else class="grid grid-cols-12 gap-4">
            <div
                v-for="member in members"
                :key="member.id"
                class="col-span-12 sm:col-span-6 lg:col-span-4"
            >
                <div
                    class="user-card flex h-full flex-col rounded-lg border bg-default"
                    :data-testid="`member-card-${member.user}`"
                >
                    <div class="flex items-center gap-3 px-4 pb-1 pt-3">
                        <img
                            v-if="member.avatarUrl"
                            :src="member.avatarUrl"
                            :alt="member.displayName"
                            class="size-[42px] shrink-0 rounded-full object-cover"
                        />
                        <span
                            v-else
                            class="inline-flex size-[42px] shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                            :style="{
                                backgroundColor: avatarColor(
                                    member.displayName,
                                ),
                            }"
                        >
                            {{ member.initials }}
                        </span>

                        <div class="min-w-0 flex-1">
                            <div
                                class="text-sm font-semibold card-title-tight truncate"
                                data-testid="member-card-name"
                            >
                                {{ member.displayName }}
                            </div>
                            <div
                                class="text-xs card-subtitle-muted text-muted truncate"
                            >
                                {{ member.email }}
                            </div>
                        </div>
                    </div>

                    <div class="mt-auto flex items-center gap-2 px-4 pb-3 pt-2">
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
                        <UTooltip :text="t('members.remove')">
                            <UButton
                                icon="i-lucide-user-minus"
                                color="error"
                                variant="ghost"
                                :disabled="!canManage(member)"
                                :aria-label="t('members.remove')"
                                data-testid="member-card-remove"
                                @click="confirmRemove(member)"
                            />
                        </UTooltip>
                    </div>
                </div>
            </div>
        </div>

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
            <template #actions>
                <UButton
                    color="neutral"
                    variant="ghost"
                    data-testid="member-invite-cancel"
                    @click="inviteDialog = false"
                >
                    {{ t('actions.cancel') }}
                </UButton>
                <div class="flex-1" />
                <UButton
                    color="primary"
                    icon="i-lucide-user-plus"
                    :loading="inviting"
                    data-testid="member-invite-submit"
                    @click="inviteForm?.submit()"
                >
                    {{ t('members.invite') }}
                </UButton>
            </template>
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
import type { Form } from '@nuxt/ui'
import { avatarColor } from '~/utils/avatar'
import { required, validEmail, validateRules } from '~/utils/validation'
import type { MembershipRecord } from '~/types/models'
import { canGrantRole, membershipIn } from '#shared/utils/memberships'
import { coalesce } from '~/utils/realtimeCache'

type Member = MembershipRecord & {
    displayName: string
    email: string
    initials: string
    avatarUrl: string | null
}

const { t } = useI18n()
const pb = usePocketbase()
const props = defineProps<{ gymId: string }>()
const gymId = computed(() => props.gymId)

const pageRoute = useRoute()
const search = ref(String(pageRoute.query.search ?? ''))
watch(
    () => pageRoute.query.search,
    (value) => (search.value = String(value ?? '')),
)
const selectedRole = ref<string | null>(null)
const currentUserId = computed(() => pb.authStore.record?.id ?? null)

const { data: roles, refresh: refreshRoles } = useRoles(gymId)
const { memberships: ownMemberships, isPlatformAdmin } = usePermissions()
const roleOptions = computed(() =>
    roles.value.map((role) => ({ label: role.name, value: role.id })),
)
const grantableRoleIds = computed(() => {
    const ownRole = membershipIn(ownMemberships.value, gymId.value)?.expand
        ?.role
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

function canManage(member: Member) {
    return (
        member.user !== currentUserId.value &&
        grantableRoleIds.value.has(member.role)
    )
}

function mapMember(membership: MembershipRecord): Member {
    const user = membership.expand?.user
    const fullName = [user?.firstname, user?.name].filter(Boolean).join(' ')
    const displayName = fullName || user?.username || user?.email || '?'
    return {
        ...membership,
        displayName,
        email: user?.email ?? '',
        initials:
            [user?.firstname, user?.name]
                .map((part) => part?.[0]?.toUpperCase() ?? '')
                .join('') || '?',
        avatarUrl: user
            ? usePbFileUrl(user, user.avatar, { thumb: '100x100' }) || null
            : null,
    }
}

function buildFilter() {
    const parts = [pb.filter('gym = {:gym}', { gym: gymId.value })]
    const term = search.value.trim()
    if (term) {
        parts.push(
            pb.filter(
                '(user.username ~ {:term} || user.email ~ {:term} || user.name ~ {:term} || user.firstname ~ {:term})',
                { term },
            ),
        )
    }
    if (selectedRole.value) {
        parts.push(pb.filter('role = {:role}', { role: selectedRole.value }))
    }
    return parts.join(' && ')
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
} = usePbList<MembershipRecord, Member>('memberships', {
    perPage: 48,
    requestKey: 'membersList',
    query: () => ({
        sort: '-created',
        filter: buildFilter(),
        expand: 'user,role',
    }),
    map: mapMember,
})

function clearFilters() {
    selectedRole.value = null
}

let searchDebounce: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
    clearTimeout(searchDebounce)
    searchDebounce = setTimeout(() => reloadMembers(), 300)
})
watch(selectedRole, () => reloadMembers())

const { pending: changingRole, run: runRoleChange } = useAsyncAction()

async function changeRole(member: Member, role: string) {
    if (changingRole.value || role === member.role) return
    await runRoleChange(
        async () => {
            await pb.collection('memberships').update(member.id, { role })
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
    return t('notifications.error.generic')
}

async function sendInvite() {
    await runInvite(
        async () => {
            const result = await pb.send<{ created?: boolean }>(
                `/api/gyms/${gymId.value}/members`,
                {
                    method: 'POST',
                    body: {
                        email: invite.email.trim(),
                        role: invite.role,
                        firstname: invite.firstname.trim(),
                        name: invite.name.trim(),
                    },
                    requestKey: null,
                },
            )
            inviteDialog.value = false
            notifySuccess(
                result.created
                    ? t('members.invitedByMail')
                    : t('members.invited'),
            )
            await reloadMembers()
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
            await pb.collection('memberships').delete(target.id)
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

const { subscribe } = usePbSubscription()

void prefetch(`admin-members-${props.gymId}`)

const reloadSoon = coalesce(() => Promise.all([refreshRoles(), reloadLoaded()]))

onMounted(() => {
    void subscribe('roles', reloadSoon)
    void subscribe('memberships', (e) => {
        if (e.record.gym === gymId.value) reloadSoon()
    })
})
</script>

<style scoped>
.user-card {
    transition:
        border-color 0.15s ease,
        box-shadow 0.15s ease;
}

.user-card:hover {
    border-color: color-mix(in oklab, var(--ui-primary) 30%, transparent);
}
</style>
