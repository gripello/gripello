import type { RouteLocationNormalized } from 'vue-router'
import type { GymRecord } from '~/types/models'
import { usePocketbase } from '#imports'
import { staffLandingPath } from '~/utils/nav'

async function targetGymId(to: RouteLocationNormalized) {
    const routeSlug = typeof to.params.gym === 'string' ? to.params.gym : ''
    const cached = useNuxtData<GymRecord>('gym').data.value
    if (cached && (!routeSlug || cached.slug === routeSlug)) return cached.id
    const gym = await loadGym(
        usePocketbase(),
        routeSlug,
        useCookie<string | null>('gym').value ?? '',
    )
    return gym?.id ?? ''
}

export default defineNuxtRouteMiddleware(async (to) => {
    const pb = usePocketbase()
    const isValidSession = pb.authStore.isValid

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

    if (to.meta.platformAdmin) {
        const { isPlatformAdmin, ensureLoaded } = usePermissions()
        await ensureLoaded()
        if (!isPlatformAdmin.value) return navigateTo('/')
    }

    const requiredPermission = to.meta.requiredPermission as string | undefined
    if (requiredPermission) {
        const { can, ensureLoaded } = usePermissions()
        const [gymId] = await Promise.all([targetGymId(to), ensureLoaded()])
        if (!can(requiredPermission, gymId)) {
            return navigateTo('/')
        }
    }
})
