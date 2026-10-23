import { GYM_COOKIE } from '#shared/utils/cookies'
import {
    meetsRequirement,
    type PermissionRequirement,
} from '#shared/utils/permissions'
import type { RouteLocationNormalized } from 'vue-router'
import type { GymRecord } from '~/types/models'
import { staffLandingPath } from '~/utils/nav'
import { routeGymSlug } from '~/composables/useGym'
import { useAuthState } from '~/api/auth'

async function targetGymId(to: RouteLocationNormalized) {
    const routeSlug = routeGymSlug(to.params)
    const cached = useNuxtData<GymRecord>('gym').data.value
    if (cached && (!routeSlug || cached.slug === routeSlug)) return cached.id
    const gym = await loadGym(
        routeSlug,
        useCookie<string | null>(GYM_COOKIE).value ?? '',
    )
    return gym?.id ?? ''
}

export default defineNuxtRouteMiddleware(async (to) => {
    const isValidSession = useAuthState().isSignedIn()

    if (to.meta.auth === false) {
        if (isValidSession) {
            const { memberships, ensureLoaded } = usePermissions()
            await ensureLoaded()
            return navigateTo(staffLandingPath(memberships.value))
        }
        return
    }

    if (to.path === '/') return

    if (!isValidSession) {
        return navigateTo({
            path: '/auth/login',
            query: { redirect: to.fullPath ?? to.path },
        })
    }

    if (
        to.meta.platformAdmin ||
        to.path === '/platform' ||
        to.path.startsWith('/platform/')
    ) {
        const { isPlatformAdmin, ensureLoaded } = usePermissions()
        await ensureLoaded()
        if (!isPlatformAdmin.value) return navigateTo('/')
    }

    const requiredPermission = to.meta.requiredPermission as
        PermissionRequirement | undefined
    if (requiredPermission) {
        const { can, ensureLoaded } = usePermissions()
        const [gymId] = await Promise.all([targetGymId(to), ensureLoaded()])
        if (
            !meetsRequirement(requiredPermission, (permission) =>
                can(permission, gymId),
            )
        ) {
            return navigateTo('/')
        }
    }
})
