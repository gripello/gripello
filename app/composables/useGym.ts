import type PocketBase from 'pocketbase'
import type { GymRecord } from '~/types/models'
import { gymLink } from '~/utils/navigation'
import { GYM_COOKIE } from '~/utils/clientStorage'
import { isValidGymSlug } from '#shared/utils/gymSlug'

export const GYM_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export async function findGym(
    pb: PocketBase,
    slug: string,
): Promise<GymRecord | null> {
    if (!slug) return null
    const findBy = (filter: string, slug: string) =>
        pb
            .collection('gyms')
            .getFirstListItem<GymRecord>(
                pb.filter(`${filter} && active = true`, { slug }),
                { requestKey: null },
            )
            .catch(() => null)
    const current = await findBy('slug = {:slug}', slug)
    if (current || !isValidGymSlug(slug)) return current
    return findBy('previous_slugs ~ {:slug}', JSON.stringify(slug))
}

export async function loadGym(
    pb: PocketBase,
    routeSlug: string,
    cookieSlug: string,
): Promise<GymRecord | null> {
    if (!routeSlug) return findGym(pb, cookieSlug)
    const found = await findGym(pb, routeSlug)
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

export function gymFilter(pb: PocketBase, gymId: string, filter = '') {
    const scope = pb.filter('gym = {:gym}', { gym: gymId })
    return filter ? `${scope} && ${filter}` : scope
}

export function useGymPath() {
    const route = useRoute()
    return (to: string) => gymLink(to, routeGymSlug(route.params))
}

export function useCurrentGymId() {
    return useGym().id
}
