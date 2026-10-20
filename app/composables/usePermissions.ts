import { isAbortOrNetworkError } from '~/utils/errors'
import {
    activeMemberships,
    membershipIn,
    permissionsIn,
} from '#shared/utils/memberships'
import { PLATFORM_ADMIN, type PermissionCheck } from '#shared/utils/permissions'
import { PLATFORM_ADMIN_GRANTS } from '~/utils/navigation'
import { getMe, type Me, type OwnMembership } from '~/api/account'
import { useAuthState } from '~/api/auth'

interface MembershipFetch {
    userId: string
    promise: Promise<void>
}

const membershipFetches = new WeakMap<object, MembershipFetch>()

export function usePermissions() {
    const auth = useAuthState()
    const memberships = useState<OwnMembership[]>('user-memberships', () => [])
    const loading = ref(false)
    const loaded = useState<boolean>('user-permissions-loaded', () => false)
    const loadedForUser = useState<string>('user-permissions-user', () => '')
    const platformAdmin = useState<boolean>('user-platform-admin', () => false)
    const verifiedUser = useState<Me | null>('user-verified-record', () => null)
    const authRejected = useState<boolean>('user-auth-rejected', () => false)
    const loadFailed = useState<boolean>('user-permissions-failed', () => false)
    const currentGymId = useCurrentGymId()
    const nuxtApp = useNuxtApp()
    const { $i18n } = nuxtApp
    const { error: notifyError } = useNotification()

    function currentUserId(): string {
        return (auth.isSignedIn() && auth.currentUserId()) || ''
    }

    async function fetchMemberships(userId: string, isLatest: () => boolean) {
        try {
            const user = await getMe({ include: ['memberships'] })
            if (!isLatest() || currentUserId() !== userId) return
            const { memberships: own = [], ...record } = user as Me & {
                memberships?: OwnMembership[]
            }
            verifiedUser.value = record
            authRejected.value = false
            loadFailed.value = false
            platformAdmin.value = !!user.platform_admin
            memberships.value = own
        } catch (err) {
            if (
                isAbortOrNetworkError(err) ||
                !isLatest() ||
                currentUserId() !== userId
            )
                return
            authRejected.value = [401, 403, 404].includes(
                (err as { status?: number })?.status ?? 0,
            )
            console.error('Failed to fetch permissions:', err)
            memberships.value = []
            platformAdmin.value = false
            if (!loadFailed.value && !authRejected.value)
                notifyError($i18n.t('permissions.loadError'))
            loadFailed.value = true
            loadedForUser.value = ''
            loaded.value = true
            return
        }
        loadedForUser.value = userId
        loaded.value = true
    }

    function startFetch(userId: string) {
        const membershipFetch = { userId } as MembershipFetch
        const isLatest = () =>
            membershipFetches.get(nuxtApp) === membershipFetch
        membershipFetches.set(nuxtApp, membershipFetch)
        membershipFetch.promise = fetchMemberships(userId, isLatest).finally(
            () => {
                if (isLatest()) membershipFetches.delete(nuxtApp)
            },
        )
    }

    async function awaitLatestFetch() {
        loading.value = true
        let pending: MembershipFetch | undefined
        while ((pending = membershipFetches.get(nuxtApp))) await pending.promise
        loading.value = false
    }

    async function refreshPermissions() {
        const userId = currentUserId()
        if (!userId) {
            membershipFetches.delete(nuxtApp)
            memberships.value = []
            platformAdmin.value = false
            loadedForUser.value = ''
            loaded.value = true
            return
        }
        startFetch(userId)
        await awaitLatestFetch()
    }

    async function ensureLoaded() {
        const userId = currentUserId()
        const pending = membershipFetches.get(nuxtApp)
        if (pending?.userId === userId) return awaitLatestFetch()
        if (!pending && loaded.value && loadedForUser.value === userId) return
        await refreshPermissions()
    }

    const gymMemberships = computed(() => activeMemberships(memberships.value))

    const isPlatformAdmin = computed(() => loaded.value && platformAdmin.value)

    function can(
        featureName: PermissionCheck,
        gymId = currentGymId.value,
    ): boolean {
        if (!loaded.value) return false
        if (featureName === PLATFORM_ADMIN) return platformAdmin.value
        if (
            platformAdmin.value &&
            PLATFORM_ADMIN_GRANTS.some((grant) => grant === featureName)
        )
            return true
        return permissionsIn(memberships.value, gymId).includes(featureName)
    }

    function roleName(gymId = currentGymId.value): string {
        return membershipIn(memberships.value, gymId)?.role.name ?? ''
    }

    return {
        memberships,
        gymMemberships,
        roleName,
        isPlatformAdmin,
        loading,
        loaded,
        can,
        ensureLoaded,
        verifiedUser,
        authRejected,
        refreshPermissions,
    }
}
