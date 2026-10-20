import { GRADE_SYSTEMS, gradeLabels } from '#shared/utils/grades'
import { normalizeCreators } from '#shared/utils/formatting'
import type { RouteQuery } from '~/api/routes'
import type { RouteRecord } from '~/types/models'

const BARE_NUMBER = /^\d{1,2}$/

const ALL_GRADES = [...new Set(GRADE_SYSTEMS.flatMap(gradeLabels))]

export interface RouteSearchQuery {
    q?: string
    grade?: string[]
}

function matchingGrades(tokens: string[]) {
    const wanted = tokens.map((token) => token.toLowerCase())
    return ALL_GRADES.filter((grade) => wanted.includes(grade.toLowerCase()))
}

const isGradeToken = (token: string) =>
    !BARE_NUMBER.test(token) && matchingGrades([token]).length > 0

export function routeSearchQuery(query: string): RouteSearchQuery {
    const tokens = query.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 1 && BARE_NUMBER.test(tokens[0]!)) {
        const level = tokens[0]!
        const levelGrades = matchingGrades([`${level}-`, level, `${level}+`])
        if (levelGrades.length) return { grade: levelGrades }
    }

    const grades = matchingGrades(tokens.filter(isGradeToken))
    const phrase = tokens.filter((token) => !isGradeToken(token)).join(' ')
    return {
        ...(phrase ? { q: phrase } : {}),
        ...(grades.length ? { grade: grades } : {}),
    }
}

export interface RouteFilterInput {
    difficulty: string
    location: string
    wall: string
    type: string
    search: string
}

export function routeFilterQuery(input: RouteFilterInput): RouteQuery {
    const search = routeSearchQuery(input.search)
    const query: RouteQuery = search.q ? { q: search.q } : {}
    if (input.difficulty) {
        const separator = input.difficulty.indexOf(':')
        const grade = input.difficulty.slice(separator + 1)
        query.grade_system = input.difficulty.slice(0, separator)
        query.grade =
            !search.grade || search.grade.includes(grade) ? [grade] : []
    } else if (search.grade) query.grade = search.grade
    if (input.location) query.location = input.location
    if (input.wall) query.wall = input.wall
    if (input.type) query.type = input.type
    return query
}

const MAX_SEARCH_WORDS = 8

type RouteMatchFields = Pick<
    RouteRecord,
    'id' | 'name' | 'grade' | 'type' | 'location' | 'wall'
> &
    Partial<
        Pick<RouteRecord, 'archived' | 'color' | 'grade_system' | 'creator'>
    >

// Mirrors the Go list filter (routes/handlers.go routeFilter), so a live change can tell whether a list shows the route.
export function routeMatchesQuery(route: RouteMatchFields, query: RouteQuery) {
    const archived = query.archived ?? false
    if (archived !== 'all' && !!route.archived !== archived) return false
    if (query.location && route.location !== query.location) return false
    if (
        query.wall === 'none'
            ? !!route.wall
            : query.wall === 'any'
              ? !route.wall
              : !!query.wall && route.wall !== query.wall
    )
        return false
    for (const key of ['type', 'color', 'grade_system'] as const)
        if (query[key] && route[key] !== query[key]) return false
    if (
        query.grade?.length &&
        !query.grade.some(
            (grade) => grade.toLowerCase() === route.grade?.toLowerCase(),
        )
    )
        return false
    if (query.ids && !query.ids.includes(route.id)) return false
    const name = route.name.toLowerCase()
    const creators = normalizeCreators(route.creator).join(',').toLowerCase()
    return (query.q ?? '')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, MAX_SEARCH_WORDS)
        .every((word) => name.includes(word) || creators.includes(word))
}
