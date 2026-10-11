import type { GymRecord } from '~/types/models'
import { gymLink } from '~/utils/navigation'
import { GYM_COOKIE } from '~/utils/clientStorage'
import { getGym } from '~/api/gyms'

export const GYM_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export async function loadGym(
    routeSlug: string,
    cookieSlug: string,
): Promise<GymRecord | null> {
    if (!routeSlug) return getGym(cookieSlug)
    const found = await getGym(routeSlug)
    if (found) return found
    throw createError({ statusCode: 404, statusMessage: 'Gym not found' })
}

export function routeParam(params: Record<string, unknown>, name: string) {
    const value = params[name]
    return typeof value === 'string' ? value : ''
}

export function routeGymSlug(params: Record<string, unknown>) {
    return routeParam(params, 'gym')
}

export function useGymCookie() {
    return useCookie<string | null>(GYM_COOKIE, {
        maxAge: GYM_COOKIE_MAX_AGE,
        sameSite: 'lax',
    })
}

export function useGym() {
    const gym = useNuxtData<GymRecord | null>('gym').data
    const id = computed(() => gym.value?.id ?? '')
    const slug = computed(() => gym.value?.slug ?? '')
    return { gym, id, slug }
}

export function useGymPath() {
    const route = useRoute()
    return (to: string) => gymLink(to, routeGymSlug(route.params))
}

export function useCurrentGymId() {
    return useGym().id
}
