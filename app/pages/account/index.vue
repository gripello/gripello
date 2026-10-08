<template>
    <div class="mx-auto w-full px-4" data-testid="me-page">
        <h1 class="sr-only">{{ $t('me.title') }}</h1>

        <AuthGuestCta v-if="!user" redirect="/account" test-id-prefix="me" />

        <template v-else>
            <NuxtLink
                to="/account/settings"
                class="native-group mt-6 block overflow-hidden"
                data-testid="me-profile"
            >
                <ClimberBanner
                    :banner="climberFileUrl(user.id, user.banner, '1600x400')"
                    :avatar="avatar"
                    :name="displayName"
                    :id="user.id"
                    class="aspect-[4/1] max-h-60 w-full"
                />
                <span class="relative flex items-end gap-3 px-4 pb-4">
                    <ClimberAvatar
                        :id="user.id"
                        :src="avatar"
                        :name="displayName"
                        size="lg"
                        class="-mt-8 ring-4 ring-(--ui-bg)"
                    />
                    <span class="native-row__text pb-1">
                        <span
                            class="block truncate text-lg font-semibold"
                            data-testid="me-name"
                            >{{ displayName }}</span
                        >
                        <span class="native-row__subtitle">{{
                            $t('me.profileHint')
                        }}</span>
                    </span>
                    <UIcon
                        name="i-lucide-chevron-right"
                        class="native-row__chevron mb-2"
                    />
                </span>
            </NuxtLink>

            <NuxtLink
                v-if="staffHub"
                :to="staffHub"
                class="native-group native-row mt-4 border-primary/40 bg-primary/10"
                style="--native-tint: var(--ui-primary)"
                data-testid="me-staff-tools"
            >
                <span class="native-row__icon">
                    <UIcon name="i-lucide-wrench" />
                </span>
                <span class="native-row__text">
                    <span class="block font-semibold">{{
                        $t('nav.staffTools')
                    }}</span>
                    <span class="native-row__subtitle">{{
                        gym ? gymTitle(gym) : ''
                    }}</span>
                </span>
                <UIcon
                    name="i-lucide-chevron-right"
                    class="native-row__chevron"
                />
            </NuxtLink>

            <div class="native-group mt-4">
                <NuxtLink
                    :to="`/climber?id=${user.id}`"
                    class="native-row"
                    style="--native-tint: var(--ui-primary)"
                    data-testid="me-public-profile"
                >
                    <span class="native-row__icon">
                        <UIcon name="i-lucide-id-card" />
                    </span>
                    <span class="native-row__text">{{
                        $t('friends.myProfile')
                    }}</span>
                    <UIcon
                        name="i-lucide-chevron-right"
                        class="native-row__chevron"
                    />
                </NuxtLink>
                <NuxtLink
                    to="/friends"
                    class="native-row"
                    style="--native-tint: var(--ui-primary)"
                    data-testid="me-friends"
                >
                    <span class="native-row__icon">
                        <UIcon name="i-lucide-users" />
                    </span>
                    <span class="native-row__text">{{
                        $t('routes.friends')
                    }}</span>
                    <UIcon
                        name="i-lucide-chevron-right"
                        class="native-row__chevron"
                    />
                </NuxtLink>
                <NuxtLink
                    to="/account/activity"
                    class="native-row"
                    style="--native-tint: var(--ui-primary)"
                >
                    <span class="native-row__icon">
                        <UIcon name="i-lucide-clipboard-clock" />
                    </span>
                    <span class="native-row__text">{{
                        $t('routes.activity')
                    }}</span>
                    <UIcon
                        name="i-lucide-chevron-right"
                        class="native-row__chevron"
                    />
                </NuxtLink>
            </div>
        </template>

        <template v-if="user">
            <section data-testid="me-gyms">
                <p class="native-heading">{{ $t('account.myGyms') }}</p>
                <div class="native-group">
                    <p
                        v-if="!memberships.length"
                        class="native-row text-muted"
                        data-testid="me-gyms-empty"
                    >
                        {{ $t('account.noGyms') }}
                    </p>
                    <div
                        v-for="membership in memberships"
                        :key="membership.id"
                        class="native-row pe-2"
                        style="--native-tint: var(--ui-primary)"
                    >
                        <NuxtLink
                            :to="`/${membership.expand?.gym?.slug}`"
                            class="flex min-w-0 flex-1 items-center gap-3.5"
                            :data-testid="`me-gym-${membership.expand?.gym?.slug}`"
                        >
                            <span class="native-row__icon">
                                <UIcon name="i-lucide-building-2" />
                            </span>
                            <span class="native-row__text truncate">{{
                                membership.expand?.gym?.name
                            }}</span>
                            <UBadge
                                color="neutral"
                                variant="soft"
                                data-testid="me-gym-role"
                            >
                                {{ membership.expand?.role?.name }}
                            </UBadge>
                        </NuxtLink>
                        <UButton
                            class="icon-btn"
                            icon="i-lucide-log-out"
                            color="error"
                            variant="ghost"
                            :aria-label="
                                t('account.leaveGym', {
                                    gym: membership.expand?.gym?.name,
                                })
                            "
                            :data-testid="`me-gym-leave-${membership.expand?.gym?.slug}`"
                            @click="leaving = membership"
                        />
                    </div>
                </div>
            </section>
            <ConfirmDialog
                v-model="leaveDialog"
                :title="
                    t('account.leaveGym', {
                        gym: leaving?.expand?.gym?.name,
                    })
                "
                :message="t('account.leaveGymConfirm')"
                :confirm-text="t('account.leave')"
                :loading="leavePending"
                @confirm="leaveGym"
            />
        </template>

        <LayoutInfoList v-if="!lgAndUp" :settings="settings" :gym="gym" />
        <div v-if="user" class="native-group mt-6 mb-4">
            <button
                type="button"
                class="native-row justify-center font-semibold text-error"
                :disabled="loggingOut"
                data-testid="me-logout"
                @click="logout"
            >
                <UIcon
                    :name="
                        loggingOut
                            ? 'i-lucide-loader-circle'
                            : 'i-lucide-log-out'
                    "
                    class="size-5"
                    :class="{ 'animate-spin': loggingOut }"
                />
                {{ $t('account.logout') }}
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { signOut } from '~/utils/session'
import type { MembershipRecord, SettingsRecord } from '~/types/models'
import { gymTitle } from '~/utils/gymNames'
import { staffSections } from '~/utils/navigation'

const { t } = useI18n()
const pb = usePocketbase()
const router = useRouter()
const {
    can,
    gymMemberships: memberships,
    refreshPermissions,
} = usePermissions()
const { lgAndUp } = useDisplay()
const { data: settings } = useNuxtData<SettingsRecord>('settings')

useSeoMeta({ title: () => t('page.title.me') })

const user = useAuthRecord()
const loggingOut = ref(false)

const displayName = computed(
    () =>
        [user.value?.firstname, user.value?.name].filter(Boolean).join(' ') ||
        user.value?.username ||
        user.value?.email ||
        t('account.unknownUser'),
)
const avatar = computed(() =>
    usePbFileUrl(user.value, user.value?.avatar, { thumb: '100x100' }),
)

const { gym, slug } = useGym()
const staffHub = computed(() =>
    slug.value && staffSections(can, slug.value).length
        ? `/${slug.value}/manage`
        : null,
)

const leaving = ref<MembershipRecord | null>(null)
const leaveDialog = computed({
    get: () => !!leaving.value,
    set: (open) => {
        if (!open) leaving.value = null
    },
})
const { pending: leavePending, run: runLeave } = useAsyncAction()

async function leaveGym() {
    const membership = leaving.value
    if (!membership) return
    await runLeave(
        async () => {
            await pb.collection('memberships').delete(membership.id)
            leaving.value = null
            await refreshPermissions()
        },
        {
            success: t('account.leftGym'),
            error: (error) =>
                (error as { status?: number })?.status === 400
                    ? t('account.lastAdmin')
                    : t('notifications.error.generic'),
        },
    )
}

async function logout() {
    loggingOut.value = true
    try {
        signOut(pb)
        await router.push('/auth/login')
    } finally {
        loggingOut.value = false
    }
}
</script>
