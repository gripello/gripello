import { normalizeCreators } from '#shared/utils/formatting'

export const SETTER_SUGGESTION_ROUTES = 500

export function setterNames(routes: { creator?: unknown }[]) {
    return [
        ...new Set(routes.flatMap((route) => normalizeCreators(route.creator))),
    ].filter(Boolean)
}

export function changedFields<T extends Record<string, unknown>>(
    next: T,
    baseline: T,
): Partial<T> {
    return Object.fromEntries(
        Object.entries(next).filter(
            ([field, value]) =>
                JSON.stringify(value) !== JSON.stringify(baseline[field]),
        ),
    ) as Partial<T>
}
