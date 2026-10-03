import {
    isLegacyGymPath,
    legacyGymRedirect,
} from '#shared/utils/legacyGymPaths'
import { soleActiveGymSlug } from '../utils/legacyGymPaths'

export default defineEventHandler(async (event) => {
    const url = getRequestURL(event)
    if (!isLegacyGymPath(url.pathname)) return
    const slug = getCookie(event, 'gym') || (await soleActiveGymSlug())
    const target = legacyGymRedirect(url.pathname, url.search, slug)
    if (target) return sendRedirect(event, target, 302)
})
