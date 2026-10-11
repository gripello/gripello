import type {
    CompetitionCategoryRecord,
    CompetitionEntryRecord,
    CompetitionEntryStatus,
    CompetitionRecord,
    CompetitionRouteRecord,
    CompetitionScoreRecord,
    CompetitionStatus,
} from '../../types/models'
import type {
    CompetitionResults,
    ResultsInput,
} from '../../shared/utils/competitionResults'
import { useApi } from './client'

type Writable<T> = Omit<
    T,
    'id' | 'created' | 'updated' | 'collectionId' | 'collectionName' | 'expand'
>

export type CompetitionInput = Partial<Omit<Writable<CompetitionRecord>, 'gym'>>
export type CategoryInput = Partial<
    Omit<Writable<CompetitionCategoryRecord>, 'competition'>
>
export type CompetitionRouteInput = Partial<
    Omit<Writable<CompetitionRouteRecord>, 'competition'>
>
export type EntryInput = Partial<
    Omit<Writable<CompetitionEntryRecord>, 'competition'>
>
export type ScoreInput = Pick<CompetitionScoreRecord, 'entry' | 'comp_route'> &
    Partial<
        Omit<
            Writable<CompetitionScoreRecord>,
            'competition' | 'entry' | 'comp_route'
        >
    >

export type CompetitionInclude = 'location'

export interface CompetitionQuery {
    status?: CompetitionStatus[]
    include?: CompetitionInclude[]
    sort?: 'starts_at' | '-starts_at'
}

export interface CompetitionRouteQuery {
    voided?: boolean
}

export interface CompetitionEntryQuery {
    status?: CompetitionEntryStatus[]
    user?: string
}

export interface CompetitionScoreQuery {
    entry?: string
}

export type Standing = ResultsInput['entries'][number]

export interface CompetitionResultsInput extends ResultsInput {
    visibility: CompetitionResults['visibility']
    competition: CompetitionRecord
}

interface Items<T> {
    items: T[]
}

export function competitionDate(value: string) {
    if (!value) return value
    const date = new Date(value.replace(' ', 'T'))
    return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

function competitionBody<T extends CompetitionInput>(input: T): T {
    return {
        ...input,
        ...(input.starts_at !== undefined
            ? { starts_at: competitionDate(input.starts_at) }
            : {}),
        ...(input.ends_at !== undefined
            ? { ends_at: competitionDate(input.ends_at) }
            : {}),
    }
}

async function items<T>(path: string, query: Record<string, unknown> = {}) {
    return (await useApi()<Items<T>>(path, { query })).items
}

const remove = (path: string) =>
    useApi()<void>(path, { method: 'DELETE' }).then(() => true)

const send = <T>(
    path: string,
    method: 'POST' | 'PATCH' | 'PUT',
    body: object,
) => useApi()<T>(path, { method, body })

const list = (values?: string[]) => (values?.length ? values : undefined)

export function listCompetitions(gym: string, query: CompetitionQuery = {}) {
    return items<CompetitionRecord>(`/gyms/${gym}/competitions`, {
        status: list(query.status),
        include: list(query.include),
        sort: query.sort,
    })
}

export function getCompetition(
    id: string,
    { include }: { include?: CompetitionInclude[] } = {},
) {
    return useApi()<CompetitionRecord>(`/competitions/${id}`, {
        query: { include: list(include) },
    })
}

export function createCompetition(gym: string, input: CompetitionInput) {
    return send<CompetitionRecord>(
        `/gyms/${gym}/competitions`,
        'POST',
        competitionBody(input),
    )
}

export function updateCompetition(id: string, patch: CompetitionInput) {
    return send<CompetitionRecord>(
        `/competitions/${id}`,
        'PATCH',
        competitionBody(patch),
    )
}

export function publishCompetition(id: string) {
    return useApi()<CompetitionRecord>(`/competitions/${id}/publish`, {
        method: 'POST',
    })
}

export function deleteCompetition(id: string) {
    return remove(`/competitions/${id}`)
}

export function listCategories(competitionId: string) {
    return items<CompetitionCategoryRecord>(
        `/competitions/${competitionId}/categories`,
    )
}

export function createCategory(competitionId: string, input: CategoryInput) {
    return send<CompetitionCategoryRecord>(
        `/competitions/${competitionId}/categories`,
        'POST',
        input,
    )
}

export function updateCategory(id: string, patch: CategoryInput) {
    return send<CompetitionCategoryRecord>(
        `/competition-categories/${id}`,
        'PATCH',
        patch,
    )
}

export function deleteCategory(id: string) {
    return remove(`/competition-categories/${id}`)
}

export function listCompetitionRoutes(
    competitionId: string,
    query: CompetitionRouteQuery = {},
) {
    return items<CompetitionRouteRecord>(
        `/competitions/${competitionId}/routes`,
        { voided: query.voided },
    )
}

export function createCompetitionRoute(
    competitionId: string,
    input: CompetitionRouteInput,
) {
    return send<CompetitionRouteRecord>(
        `/competitions/${competitionId}/routes`,
        'POST',
        input,
    )
}

export function updateCompetitionRoute(
    id: string,
    patch: CompetitionRouteInput,
) {
    return send<CompetitionRouteRecord>(
        `/competition-routes/${id}`,
        'PATCH',
        patch,
    )
}

export function deleteCompetitionRoute(id: string) {
    return remove(`/competition-routes/${id}`)
}

export function listEntries(
    competitionId: string,
    query: CompetitionEntryQuery = {},
) {
    return items<CompetitionEntryRecord>(
        `/competitions/${competitionId}/entries`,
        { status: list(query.status), user: query.user },
    )
}

export function createEntry(competitionId: string, input: EntryInput) {
    return send<CompetitionEntryRecord>(
        `/competitions/${competitionId}/entries`,
        'POST',
        input,
    )
}

export function updateEntry(id: string, patch: EntryInput) {
    return send<CompetitionEntryRecord>(
        `/competition-entries/${id}`,
        'PATCH',
        patch,
    )
}

export function deleteEntry(id: string) {
    return remove(`/competition-entries/${id}`)
}

export function listScores(
    competitionId: string,
    query: CompetitionScoreQuery = {},
) {
    return items<CompetitionScoreRecord>(
        `/competitions/${competitionId}/scores`,
        { entry: query.entry },
    )
}

export async function putScores(competitionId: string, scores: ScoreInput[]) {
    return (
        await send<Items<CompetitionScoreRecord>>(
            `/competitions/${competitionId}/scores`,
            'PUT',
            { scores },
        )
    ).items
}

export function deleteScore(id: string) {
    return remove(`/competition-scores/${id}`)
}

export function getStandings(competitionId: string) {
    return useApi()<{
        items: Standing[]
        categories: CompetitionCategoryRecord[]
    }>(`/competitions/${competitionId}/standings`)
}

export function getResults(competitionId: string) {
    return useApi()<CompetitionResultsInput>(
        `/competitions/${competitionId}/results`,
    )
}
