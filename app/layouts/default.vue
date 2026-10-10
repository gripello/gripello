<template>
    <a href="#main-content" class="skip-link">{{ $t('nav.skipToContent') }}</a>
    <div class="app-frame">
        <LayoutSideBar
            :loggedIn="isLoggedIn"
            :footer-settings="gymSlug && gym ? gym : settings"
            :footer-gym-slug="gymSlug"
        />
        <div class="page-body">
            <LayoutNavBar :loggedIn="isLoggedIn" />
            <main id="main-content" class="app-main" tabindex="-1">
                <slot />
            </main>
        </div>
    </div>
    <LayoutBottomNav />
    <div v-if="hydrated" data-testid="page-hydrated" hidden />
</template>

<script setup lang="ts">
import { fileUrl } from '~/api/client'
import { refreshAuth } from '~/api/auth'
import type { ApiError } from '~/api/client'
import {
    subscribeRealtime,
    type GymEvent,
    type UserEvent,
} from '~/composables/useRealtime'
import type { SettingsRecord } from '~/types/models'
import { sessionNeedsRefresh } from '~/utils/session'

const hydrated = useHydrated()

const authStore = useAuthStore()
const isLoggedIn = ref(authStore.isValid)
const authRecord = useAuthRecord()
authRecord.value = authStore.record
const {
    refreshPermissions,
    ensureLoaded,
    memberships,
    verifiedUser,
    authRejected,
} = usePermissions()

const { data: settingsData } = await useSettingsRecord()
const { gym } = useGym()

const settings = ref<Partial<SettingsRecord>>(settingsData.value ?? {})
watch(settingsData, (val) => {
    if (val) settings.value = val
})

await callOnce('user-permissions', ensureLoaded)

const refreshSession = async () => {
    try {
        await refreshAuth()
        isLoggedIn.value = authStore.isValid
        authRecord.value = authStore.record
    } catch (error) {
        const status = (error as ApiError)?.status
        if (status !== 401 && status !== 403) return
        authStore.clear()
        isLoggedIn.value = false
        authRecord.value = null
    }
}

const route = useRoute()
const gymSlug = computed(() =>
    routeGymSlug(route.params) ? gym.value?.slug : '',
)

useHead(
    computed(() => ({
        titleTemplate: (title?: string) =>
            [gymSlug.value && gym.value?.name, title]
                .filter(Boolean)
                .join(' · ') || 'Gripello',
        link: [
            {
                rel: 'icon',
                href:
                    gymSlug.value && gym.value?.page_icon
                        ? fileUrl('gyms', gym.value, gym.value.page_icon)
                        : '/favicon.ico',
            },
        ],
    })),
)

let unsubAuthChange: (() => void) | null = null
const realtimeUserId = ref('')
const realtimeGyms = computed(() =>
    [
        ...new Set([
            gym.value?.id,
            ...(realtimeUserId.value
                ? memberships.value.map((membership) => membership.gym)
                : []),
        ]),
    ]
        .filter(Boolean)
        .join(','),
)

function onGymEvent(event: GymEvent) {
    if (event.kind === 'gym.updated') {
        if (event.record.id === gym.value?.id) gym.value = event.record
    } else if (event.kind === 'membership.changed') {
        if (event.users?.includes(realtimeUserId.value)) refreshPermissions()
    } else if (event.kind === 'role.changed') {
        if (memberships.value.some((m) => m.role === event.id))
            refreshPermissions()
    }
}

function onUserEvent(event: UserEvent) {
    if (event.kind === 'user.deleted') {
        authStore.clear()
    } else {
        authStore.save(authStore.token, event.record)
        isLoggedIn.value = true
    }
}

function subscribeRealtimeTopics() {
    watch(
        realtimeGyms,
        (gymIds, _, onCleanup) => {
            const stops = gymIds
                .split(',')
                .filter(Boolean)
                .map((gymId) => subscribeRealtime(`gym:${gymId}`, onGymEvent))
            onCleanup(() => stops.forEach((stop) => stop()))
        },
        { immediate: true },
    )
    watch(
        realtimeUserId,
        (userId, _, onCleanup) => {
            if (userId)
                onCleanup(subscribeRealtime(`user:${userId}`, onUserEvent))
        },
        { immediate: true },
    )
}

onMounted(async () => {
    try {
        const userId = authStore.isValid ? authStore.record?.id : ''
        if (userId && verifiedUser.value?.id === userId) {
            authStore.save(authStore.token, verifiedUser.value)
            authRecord.value = authStore.record
        }
        realtimeUserId.value = userId || ''
        unsubAuthChange = authStore.onChange((token, record) => {
            isLoggedIn.value = !!token
            authRecord.value = token ? record : null
            realtimeUserId.value = (token && record?.id) || ''
        })
        subscribeRealtimeTopics()

        if (
            userId &&
            (authRejected.value || sessionNeedsRefresh(authStore.token))
        )
            await refreshSession()
        await ensureLoaded()
    } catch (error) {
        console.error('Error during initialization:', error)
    }
})

onBeforeUnmount(() => {
    unsubAuthChange?.()
})
</script>

<style scoped>
.app-frame {
    display: flex;
    flex: 1 1 auto;
}

.page-body {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
}

.app-main {
    flex: 1 0 auto;
    padding: 0 env(safe-area-inset-right, 0px)
        calc(var(--app-bottom) + var(--app-bottom-inset, 0px))
        env(safe-area-inset-left, 0px);
}

.skip-link {
    position: absolute;
    top: -100%;
    left: 16px;
    z-index: 9999;
    padding: 8px 16px;
    background: var(--ui-primary);
    color: #fff;
    border-radius: 0 0 8px 8px;
    font-weight: 600;
    font-size: 0.875rem;
    text-decoration: none;
    transition: top 0.2s ease;
}

.skip-link:focus {
    top: 0;
}
</style>
