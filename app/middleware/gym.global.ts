import { getGym } from '~/api/gyms'
import { isValidGymSlug } from '#shared/utils/gymSlug'
import { legacyGymRedirect } from '#shared/utils/legacyGymPaths'

export default defineNuxtRouteMiddleware(async (to) => {
    const { gym } = useGym()
    const cookie = useGymCookie()
    const legacyTarget = legacyGymRedirect(
        to.path,
        to.fullPath.slice(to.path.length),
        isValidGymSlug(cookie.value ?? '')
            ? cookie.value!
            : gym.value?.slug || '',
    )
    if (legacyTarget) return navigateTo(legacyTarget, { redirectCode: 302 })

    const routeSlug = routeGymSlug(to.params)

    if (routeSlug && gym.value?.slug !== routeSlug) {
        if (import.meta.client && gym.value) {
            window.location.assign(to.fullPath)
            return abortNavigation()
        }
        const found = await getGym(routeSlug)
        if (!found)
            return abortNavigation(
                createError({
                    statusCode: 404,
                    statusMessage: 'Gym not found',
                    data: { reason: 'gym' },
                }),
            )
        gym.value = found
        if (found.slug !== routeSlug)
            return navigateTo(withGymSlug(to.fullPath, found.slug), {
                redirectCode: 301,
            })
    } else if (!routeSlug && !gym.value && cookie.value) {
        gym.value = await getGym(cookie.value)
        const currentSlug = gym.value?.slug ?? null
        if (cookie.value !== currentSlug) cookie.value = currentSlug
    }

    if (!routeSlug) return
    if (cookie.value !== routeSlug) cookie.value = routeSlug
    if (import.meta.client) rememberRecentGym(routeSlug)
})
