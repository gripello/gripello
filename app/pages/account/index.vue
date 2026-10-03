<template>
    <div class="page--narrow mx-auto w-full px-4" data-testid="me-page">
        <h1 class="sr-only">{{ $t('me.title') }}</h1>

        <AuthGuestCta v-if="!user" redirect="/account" test-id-prefix="me" />

        <template v-else>
            <NuxtLink
                to="/account/settings"
                class="native-group native-row mt-6 py-3"
                data-testid="me-profile"
            >
                <UAvatar
                    :src="avatar || undefined"
                    :alt="displayName"
                    :text="initials"
                    class="size-14 text-xl font-bold"
                    :class="avatar ? undefined : 'bg-primary'"
                    :ui="{ fallback: 'text-inverted' }"
                />
                <span class="native-row__text">
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
                    class="native-row__chevron"
                />
            </NuxtLink>

            <div class="native-group mt-4">
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
                    <NuxtLink
                        v-for="membership in memberships"
                        :key="membership.id"
                        :to="`/${membership.expand?.gym?.slug}`"
                        class="native-row"
                        style="--native-tint: var(--ui-primary)"
                        :data-testid="`me-gym-${membership.expand?.gym?.slug}`"
                    >
                        <span class="native-row__icon">
                            <UIcon name="i-lucide-building-2" />
                        </span>
                        <span class="native-row__text">{{
                            membership.expand?.gym?.name
                        }}</span>
                        <UBadge
                            color="neutral"
                            variant="soft"
                            data-testid="me-gym-role"
                        >
                            {{ membership.expand?.role?.name }}
                        </UBadge>
                        <UIcon
                            name="i-lucide-chevron-right"
                            class="native-row__chevron"
                        />
                    </NuxtLink>
                </div>
            </section>
        </template>

        <section class="lg:hidden" data-testid="me-pages">
            <p class="native-heading">{{ $t('me.pages') }}</p>
            <div class="native-group">
                <NuxtLink
                    v-for="link in pages"
                    :key="link.to"
                    :to="link.to"
                    class="native-row"
                    style="--native-tint: var(--ui-primary)"
                    :data-testid="`me-page-${navTestId(link.path ?? link.to)}`"
                >
                    <span class="native-row__icon">
                        <UIcon :name="link.icon" />
                    </span>
                    <span class="native-row__text">{{ $t(link.label) }}</span>
                    <UIcon
                        name="i-lucide-chevron-right"
                        class="native-row__chevron"
                    />
                </NuxtLink>
            </div>
        </section>

        <template v-if="user">
            <section
                v-for="section in sections"
                :key="section.key"
                class="lg:hidden"
                :data-testid="`me-section-${section.key}`"
            >
                <p class="native-heading">{{ $t(section.label) }}</p>
                <div class="native-group">
                    <NuxtLink
                        v-for="link in section.links"
                        :key="link.to"
                        :to="link.to"
                        class="native-row"
                        :style="{ '--native-tint': SECTION_TINTS[section.key] }"
                        :data-testid="`me-staff-${navTestId(link.path ?? link.to)}`"
                    >
                        <span class="native-row__icon">
                            <UIcon :name="link.icon" />
                        </span>
                        <span class="native-row__text">{{
                            $t(link.label)
                        }}</span>
                        <UIcon
                            name="i-lucide-chevron-right"
                            class="native-row__chevron"
                        />
                    </NuxtLink>
                </div>
            </section>
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
import type { SettingsRecord } from '~/types/models'
import { pageLinks, staffSections } from '~/utils/navigation'

const { t } = useI18n()
const pb = usePocketbase()
const router = useRouter()
const { can, gymMemberships: memberships } = usePermissions()
const { lgAndUp } = useDisplay()
const { data: settings } = useNuxtData<SettingsRecord>('settings')

useSeoMeta({ title: () => t('page.title.me') })

const user = ref(pb.authStore.record)
const loggingOut = ref(false)

const displayName = computed(
    () =>
        [user.value?.firstname, user.value?.name].filter(Boolean).join(' ') ||
        user.value?.username ||
        user.value?.email ||
        t('account.unknownUser'),
)
const initials = computed(() =>
    displayName.value
        .split(' ')
        .slice(0, 2)
        .map((part: string) => part[0]?.toUpperCase() ?? '')
        .join(''),
)
const avatar = computed(() =>
    usePbFileUrl(user.value, user.value?.avatar, { thumb: '100x100' }),
)

const SECTION_TINTS: Record<string, string> = {
    manage: 'var(--ui-info)',
    moderation: 'var(--ui-warning)',
    admin: '#64748b',
    platform: 'var(--ui-primary)',
}

const { gym, slug: gymSlug } = useGym()
const sections = computed(() => staffSections(can, gymSlug.value))
const pages = computed(() => pageLinks(!!user.value, gymSlug.value))

async function logout() {
    loggingOut.value = true
    try {
        pb.authStore.clear()
        await router.push('/auth/login')
    } finally {
        loggingOut.value = false
    }
}
</script>
