<template>
    <section class="flex flex-col gap-3">
        <LayoutListGroup
            v-if="chips.length"
            data-testid="platform-user-memberships"
        >
            <li
                v-for="chip in chips"
                :key="chip.id"
                class="flex flex-wrap items-center gap-2 px-4 py-3"
                :data-testid="`platform-user-membership-${chip.gym}`"
            >
                <span
                    class="size-2 shrink-0 rounded-full"
                    :class="{ 'bg-muted': !chip.roleColor }"
                    :style="{ backgroundColor: chip.roleColor || undefined }"
                />
                <span
                    class="min-w-0 basis-0 flex-1 truncate text-sm font-medium"
                >
                    {{ chip.gymTitle }}
                </span>
                <USelect
                    :model-value="chip.role"
                    :items="roleItems(chip.gym)"
                    value-key="value"
                    :aria-label="t('members.role')"
                    class="w-36 min-w-0"
                    :disabled="busy"
                    data-testid="platform-user-membership-role"
                    @update:model-value="
                        (role) => changeRole(chip, String(role))
                    "
                />
                <UButton
                    icon="i-lucide-user-minus"
                    color="error"
                    variant="ghost"
                    class="icon-btn"
                    :aria-label="t('members.remove')"
                    :disabled="busy"
                    data-testid="platform-user-membership-remove"
                    @click="removeMembership(chip)"
                />
            </li>
        </LayoutListGroup>
        <p v-else class="text-sm text-muted">
            {{ t('platform.users.noMemberships') }}
        </p>
        <div v-if="joinable.length" class="flex flex-wrap items-center gap-2">
            <USelect
                v-model="newMembership.gym"
                :items="joinable"
                value-key="value"
                :placeholder="t('platform.users.gym')"
                :aria-label="t('platform.users.gym')"
                class="min-w-0 basis-full sm:basis-0 sm:flex-1"
                data-testid="platform-user-add-gym"
            />
            <USelect
                v-model="newMembership.role"
                :items="roleItems(newMembership.gym)"
                value-key="value"
                :placeholder="t('members.role')"
                :aria-label="t('members.role')"
                :disabled="!newMembership.gym"
                class="min-w-0 flex-1 sm:w-36 sm:flex-none"
                data-testid="platform-user-add-role"
            />
            <UButton
                icon="i-lucide-plus"
                color="primary"
                variant="soft"
                :loading="busy"
                :disabled="!newMembership.gym || !newMembership.role"
                data-testid="platform-user-add-membership"
                @click="grantMembership"
            >
                {{ t('platform.users.addMembership') }}
            </UButton>
        </div>
    </section>
</template>

<script setup lang="ts">
import {
    addMembership,
    changeMembershipRole,
    deleteMembership,
} from '~/api/members'
import type { GymRecord, RoleRecord } from '~/types/models'
import { gymTitle } from '~/utils/gymNames'
import {
    joinableGyms,
    membershipChips,
    rolesOfGym,
    type MembershipChip,
    type PlatformUser,
} from '~/utils/platformUsers'

const props = defineProps<{
    user: PlatformUser
    gyms: GymRecord[]
    roles: RoleRecord[]
}>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()

const newMembership = reactive({ gym: '', role: '' })

watch(
    () => props.user.id,
    () => Object.assign(newMembership, { gym: '', role: '' }),
)

watch(
    () => newMembership.gym,
    (gym) => {
        const gymRoles = rolesOfGym(props.roles, gym)
        newMembership.role =
            gymRoles.find((role) => role.name !== 'admin')?.id ??
            gymRoles[0]?.id ??
            ''
    },
)

const chips = computed(() =>
    membershipChips(props.user, props.gyms, props.roles),
)
const joinable = computed(() =>
    joinableGyms(chips.value, props.gyms).map((gym) => ({
        label: gymTitle(gym),
        value: gym.id,
    })),
)

function roleItems(gymId: string) {
    return rolesOfGym(props.roles, gymId).map((role) => ({
        label: role.name,
        value: role.id,
    }))
}

const { pending: busy, run } = useAsyncAction()

function membershipError(error: unknown) {
    return (error as { status?: number })?.status === 400
        ? t('platform.users.lastAdmin')
        : t('notifications.error.generic')
}

async function update(
    action: () => Promise<unknown>,
    error: string | ((error: unknown) => string) = membershipError,
) {
    const done = await run(
        async () => {
            await action()
            return true
        },
        { success: t('notifications.success.edit'), error },
    )
    if (done) emit('changed')
    return done
}

function changeRole(chip: MembershipChip, role: string) {
    if (role === chip.role) return
    return update(() => changeMembershipRole(chip.id, role))
}

function removeMembership(chip: MembershipChip) {
    return update(() => deleteMembership(chip.id))
}

async function grantMembership() {
    const done = await update(
        () =>
            addMembership({
                user: props.user.id,
                gym: newMembership.gym,
                role: newMembership.role,
            }),
        t('notifications.error.generic'),
    )
    if (done) Object.assign(newMembership, { gym: '', role: '' })
}
</script>
