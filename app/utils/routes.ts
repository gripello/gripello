import { normalizeCreators } from '#shared/utils/formatting'

export const ROUTE_TYPES = ['Route', 'Boulder'] as const

export const SETTER_SUGGESTION_ROUTES = 500

export function setterNames(routes: { creator?: unknown }[]) {
    return [
        ...new Set(routes.flatMap((route) => normalizeCreators(route.creator))),
    ].filter(Boolean)
}
