import type {
    OpenRouteDefectRecord,
    TaskAssigneeRecord,
    TaskKind,
    TaskRecord,
    TaskStatus,
} from '../../types/models'
import { useApi } from './client'

export interface TaskQuery {
    status?: TaskStatus[]
    kind?: TaskKind | null
    assignee?: string | null
    route?: string | null
    location?: string | null
    wall?: string | null
    urgent?: boolean
    overdue?: boolean
    q?: string
    sort?: string
    page?: number
    limit?: number
}

export type TaskInput = {
    [
        K in
            | 'kind'
            | 'title'
            | 'category'
            | 'priority'
            | 'status'
            | 'route'
            | 'wall'
            | 'location'
            | 'description'
            | 'assignee'
            | 'due_date'
            | 'resolution_note'
            | 'route_type'
            | 'grade'
    ]?: TaskRecord[K] | null
}

export interface TaskPage {
    items: TaskRecord[]
    page: number
    limit: number
    total: number
}

function taskBody(input: TaskInput, photo?: File | null) {
    if (!photo) return input
    const body = new FormData()
    for (const [key, value] of Object.entries(input))
        if (value !== undefined) body.append(key, String(value ?? ''))
    body.append('photo', photo)
    return body
}

export function listTasks(gym: string, query: TaskQuery = {}) {
    return useApi()<TaskPage>(`/gyms/${gym}/tasks`, {
        query: Object.fromEntries(
            Object.entries(query).filter(
                ([, value]) =>
                    value !== undefined &&
                    value !== null &&
                    value !== '' &&
                    value !== false,
            ),
        ),
    })
}

export function getTask(id: string) {
    return useApi()<TaskRecord>(`/tasks/${id}`)
}

export function createTask(
    gym: string,
    input: TaskInput,
    photo?: File | null,
    options: { headers?: Record<string, string> } = {},
) {
    return useApi()<TaskRecord>(`/gyms/${gym}/tasks`, {
        method: 'POST',
        body: taskBody(input, photo),
        headers: options.headers,
    })
}

export function updateTask(id: string, patch: TaskInput, photo?: File | null) {
    return useApi()<TaskRecord>(`/tasks/${id}`, {
        method: 'PATCH',
        body: taskBody(patch, photo),
    })
}

export function assignTask(id: string, assignee: string | null) {
    return useApi()<TaskRecord>(`/tasks/${id}/assign`, {
        method: 'POST',
        body: { assignee },
    })
}

export function setTaskStatus(id: string, status: TaskStatus, note?: string) {
    return useApi()<TaskRecord>(`/tasks/${id}/status`, {
        method: 'POST',
        body: {
            status,
            ...(note !== undefined ? { resolution_note: note } : {}),
        },
    })
}

export function deleteTask(id: string) {
    return useApi()(`/tasks/${id}`, { method: 'DELETE' })
}

export async function listOpenDefects(
    gym: string,
    query: { route?: string } = {},
) {
    const { items } = await useApi()<{ items: OpenRouteDefectRecord[] }>(
        `/gyms/${gym}/defects/open`,
        { query: query.route ? { route: query.route } : {} },
    )
    return items
}

export async function listRouteDefects(routeId: string) {
    const { items } = await useApi()<{ items: OpenRouteDefectRecord[] }>(
        `/routes/${routeId}/defects`,
    )
    return items
}

export async function listTaskAssignees(gym: string) {
    const { items } = await useApi()<{ items: TaskAssigneeRecord[] }>(
        `/gyms/${gym}/tasks/assignees`,
    )
    return items
}
