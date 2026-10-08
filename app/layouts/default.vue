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
import type { ClientResponseError, UnsubscribeFunc } from 'pocketbase'
import type { GymRecord, SettingsRecord } from '~/types/models'
import { sessionNeedsRefresh } from '~/utils/session'

const hydrated = useHydrated()

const pb = usePocketbase()
const isLoggedIn = ref(pb.authStore.isValid)
const authRecord = useAuthRecord()
authRecord.value = pb.authStore.record
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

await callOnce('user-permissions', refreshPermissions)

const refreshSession = async () => {
    try {
        await pb.collection('users').authRefresh()
        isLoggedIn.value = pb.authStore.isValid
        authRecord.value = pb.authStore.record
    } catch (error) {
        const status = (error as ClientResponseError)?.status
        if (status !== 401 && status !== 403) return
        pb.authStore.clear()
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
                        ? usePbFileUrl(gym.value, gym.value.page_icon)
                        : '/favicon.ico',
            },
        ],
    })),
)

let unsubAuthChange: (() => void) | null = null
let unsubUser: UnsubscribeFunc | null = null
let unsubGym: UnsubscribeFunc | null = null
let unsubMemberships: UnsubscribeFunc | null = null
let unsubRoles: UnsubscribeFunc | null = null
let unmounted = false

function releaseIfUnmounted(unsub: UnsubscribeFunc): UnsubscribeFunc | null {
    if (!unmounted) return unsub
    unsub().catch(() => {})
    return null
}

function unsubscribeFromMemberships() {
    unsubMemberships?.()?.catch?.(() => {})
    unsubMemberships = null
    unsubRoles?.()?.catch?.(() => {})
    unsubRoles = null
}

async function subscribeToMemberships() {
    unsubscribeFromMemberships()
    if (!pb.authStore.isValid) return
    const [membershipsSubscription, rolesSubscription] = (
        await Promise.allSettled([
            pb.collection('memberships').subscribe('*', (e) => {
                if (e.record.user === pb.authStore.record?.id)
                    refreshPermissions()
            }),
            pb.collection('roles').subscribe('*', (e) => {
                if (memberships.value.some((m) => m.role === e.record.id))
                    refreshPermissions()
            }),
        ])
    ).map((result) => (result.status === 'fulfilled' ? result.value : null))
    if (!pb.authStore.isValid) {
        void membershipsSubscription?.().catch(() => {})
        void rolesSubscription?.().catch(() => {})
        return
    }
    if (membershipsSubscription)
        unsubMemberships = releaseIfUnmounted(membershipsSubscription)
    if (rolesSubscription) unsubRoles = releaseIfUnmounted(rolesSubscription)
}

async function subscribeToGym(gymId: string | undefined) {
    unsubGym?.()?.catch?.(() => {})
    unsubGym = null
    if (!gymId) return
    const unsub = await pb.collection('gyms').subscribe(gymId, (e) => {
        if (e.action === 'update') gym.value = e.record as GymRecord
    })
    if (gym.value?.id !== gymId) {
        unsub().catch(() => {})
        return
    }
    unsubGym = releaseIfUnmounted(unsub)
}

async function subscribeToUser(userId: string) {
    unsubUser?.()?.catch?.(() => {})
    unsubUser = null
    const unsubscribe = await pb.collection('users').subscribe(userId, (e) => {
        if (e.action === 'delete') {
            pb.authStore.clear()
        } else {
            pb.authStore.save(pb.authStore.token, e.record)
            isLoggedIn.value = true
        }
    })
    if (pb.authStore.record?.id !== userId) {
        void unsubscribe().catch(() => {})
        return
    }
    unsubUser = releaseIfUnmounted(unsubscribe)
}

watch(
    () => gym.value?.id,
    (gymId) => void subscribeToGym(gymId),
)

onMounted(async () => {
    try {
        const userId = pb.authStore.isValid ? pb.authStore.record?.id : ''
        if (userId && verifiedUser.value?.id === userId) {
            pb.authStore.save(pb.authStore.token, verifiedUser.value)
            authRecord.value = pb.authStore.record
        }
        let subscribedUserId = userId
        unsubAuthChange = pb.authStore.onChange((token, record) => {
            isLoggedIn.value = !!token
            authRecord.value = token ? record : null
            const nextUserId = (token && record?.id) || ''
            if (nextUserId === subscribedUserId) return
            subscribedUserId = nextUserId
            if (nextUserId) {
                subscribeToUser(nextUserId)
                subscribeToMemberships()
            } else {
                unsubUser?.()?.catch?.(() => {})
                unsubUser = null
                unsubscribeFromMemberships()
            }
        })

        await Promise.all([
            userId && subscribeToUser(userId),
            subscribeToMemberships(),
            subscribeToGym(gym.value?.id),
            (async () => {
                if (
                    userId &&
                    (authRejected.value ||
                        sessionNeedsRefresh(pb.authStore.token))
                )
                    await refreshSession()
                await ensureLoaded()
            })(),
        ])
    } catch (error) {
        console.error('Error during initialization:', error)
    }
})

onBeforeUnmount(() => {
    unmounted = true
    unsubAuthChange?.()
    unsubUser?.()?.catch?.(() => {})
    unsubscribeFromMemberships()
    unsubGym?.()?.catch?.(() => {})
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
