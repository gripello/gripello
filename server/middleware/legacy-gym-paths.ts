import { GYM_COOKIE } from '#shared/utils/cookies'
import { isValidGymSlug } from '#shared/utils/gymSlug'
import {
    isLegacyGymPath,
    legacyGymRedirect,
} from '#shared/utils/legacyGymPaths'
import { soleActiveGymSlug } from '../utils/legacyGymPaths'

export default defineEventHandler(async (event) => {
    const url = getRequestURL(event)
    if (!isLegacyGymPath(url.pathname)) return
    const cookieSlug = getCookie(event, GYM_COOKIE) ?? ''
    const slug = isValidGymSlug(cookieSlug)
        ? cookieSlug
        : await soleActiveGymSlug()
    const target = legacyGymRedirect(url.pathname, url.search, slug)
    if (target) return sendRedirect(event, target, 302)
})
