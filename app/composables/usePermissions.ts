import type { RecordModel } from 'pocketbase'
import type { MembershipRecord, UserRecord } from '~/types/models'
import {
    activeMemberships,
    membershipIn,
    permissionsIn,
} from '#shared/utils/memberships'
import { PLATFORM_ADMIN, PLATFORM_ADMIN_GRANTS } from '~/utils/navigation'

interface MembershipFetch {
    userId: string
    promise: Promise<void>
}

const membershipFetches = new WeakMap<object, MembershipFetch>()

export const MEMBERSHIPS_EXPAND =
    'memberships_via_user.gym,memberships_via_user.role.permissions'

export function usePermissions() {
    const pb = usePocketbase()
    const memberships = useState<MembershipRecord[]>(
        'user-memberships',
        () => [],
    )
    const loading = ref(false)
    const loaded = useState<boolean>('user-permissions-loaded', () => false)
    const loadedForUser = useState<string>('user-permissions-user', () => '')
    const platformAdmin = useState<boolean>('user-platform-admin', () => false)
    const verifiedUser = useState<(UserRecord & RecordModel) | null>(
        'user-verified-record',
        () => null,
    )
    const authRejected = useState<boolean>('user-auth-rejected', () => false)
    const loadFailed = useState<boolean>('user-permissions-failed', () => false)
    const currentGymId = useCurrentGymId()
    const nuxtApp = useNuxtApp()
    const { $i18n } = nuxtApp
    const { error: notifyError } = useNotification()

    function isAutoCancelled(err: any) {
        return !!err?.isAbort || err?.status === 0
    }

    function currentUserId(): string {
        return (pb.authStore.isValid && pb.authStore.record?.id) || ''
    }

    async function fetchMemberships(userId: string) {
        try {
            const user = await pb
                .collection('users')
                .getOne<UserRecord & RecordModel>(userId, {
                    expand: MEMBERSHIPS_EXPAND,
                    requestKey: 'userPermissions',
                })
            if (currentUserId() !== userId) return
            verifiedUser.value = { ...user, expand: undefined }
            authRejected.value = false
            loadFailed.value = false
            platformAdmin.value = !!user.platform_admin
            memberships.value =
                (user.expand?.memberships_via_user as MembershipRecord[]) ?? []
        } catch (err) {
            if (isAutoCancelled(err) || currentUserId() !== userId) return
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
        const membershipFetch: MembershipFetch = {
            userId,
            promise: fetchMemberships(userId).finally(() => {
                if (membershipFetches.get(nuxtApp) === membershipFetch)
                    membershipFetches.delete(nuxtApp)
            }),
        }
        membershipFetches.set(nuxtApp, membershipFetch)
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
            pb.cancelRequest('userPermissions')
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

    function can(featureName: string, gymId = currentGymId.value): boolean {
        if (!loaded.value) return false
        if (featureName === PLATFORM_ADMIN) return platformAdmin.value
        if (platformAdmin.value && PLATFORM_ADMIN_GRANTS.includes(featureName))
            return true
        return permissionsIn(memberships.value, gymId).includes(featureName)
    }

    function roleName(gymId = currentGymId.value): string {
        return membershipIn(memberships.value, gymId)?.expand?.role?.name ?? ''
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
