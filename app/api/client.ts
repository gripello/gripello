import type { FetchContext } from 'ofetch'
import { API_VERSION_HEADER, checkApiVersion } from '#shared/utils/apiVersion'

export interface ApiErrorBody {
    status?: number
    message?: string
    data?: Record<string, { code: string; message: string }>
    [key: string]: unknown
}

export class ApiError extends Error {
    readonly url: string
    readonly status: number
    readonly response: ApiErrorBody
    readonly isAbort: boolean
    readonly originalError: unknown

    constructor(context: FetchContext) {
        const body = context.response?._data
        const response: ApiErrorBody =
            body && typeof body === 'object' ? body : {}
        const isAbort =
            (context.error as Error | undefined)?.name === 'AbortError'
        super(
            response.message ??
                (context.error as Error | undefined)?.message ??
                'Something went wrong.',
        )
        this.name = 'ApiError'
        this.url = String(context.request)
        this.status = context.response?.status ?? 0
        this.response = response
        this.isAbort = isAbort
        this.originalError = context.error
    }

    get data() {
        return this.response
    }
}

const API_PREFIX = '/api'

let manifestUpdateRequested = false

export function apiBaseURL() {
    if (!import.meta.server) return API_PREFIX
    return `${useRuntimeConfig().apiBase}${API_PREFIX}`
}

export function useApi() {
    const store = useAuthStore()
    const appVersion = String(useRuntimeConfig().public.appVersion ?? '')
    return $fetch.create({
        baseURL: apiBaseURL(),
        credentials: 'include',
        retry: 0,
        onRequest({ options }) {
            const headers = new Headers(options.headers)
            if (store.token && !headers.has('Authorization'))
                headers.set('Authorization', `Bearer ${store.token}`)
            if (appVersion && !headers.has(API_VERSION_HEADER))
                headers.set(API_VERSION_HEADER, appVersion)
            options.headers = headers
        },
        onResponse({ response }) {
            if (import.meta.server || manifestUpdateRequested) return
            const serverVersion = response.headers.get(API_VERSION_HEADER)
            if (checkApiVersion(appVersion, serverVersion) === 'ok') return
            manifestUpdateRequested = true
            void useNuxtApp().hooks.callHook('app:manifest:update')
        },
        onRequestError(context) {
            throw new ApiError(context)
        },
        onResponseError(context) {
            const error = new ApiError(context)
            const sentToken = new Headers(context.options.headers).has(
                'Authorization',
            )
            if (
                error.status === 401 &&
                sentToken &&
                store.token &&
                !error.response.mfaId
            )
                store.clear()
            throw error
        },
    })
}

export function apiUrl(path: string) {
    return `${API_PREFIX}${path}`
}

export function fileUrl(
    table: string,
    record: { id?: string } | null | undefined,
    name: string | null | undefined,
    query: { thumb?: string; token?: string } = {},
) {
    if (!record?.id || !name) return ''
    if (name.startsWith('/') || name.startsWith('http')) return name
    const search = new URLSearchParams(
        Object.entries(query).filter(([, value]) => value) as string[][],
    ).toString()
    return apiUrl(
        `/files/${table}/${record.id}/${encodeURIComponent(name)}${search ? `?${search}` : ''}`,
    )
}

export async function fileToken(table: string, id: string) {
    const { token } = await useApi()<{ token: string }>('/files/token', {
        method: 'POST',
        body: { table, id },
    })
    return token
}

export function toFormData(input: Record<string, unknown> | FormData) {
    const form = new FormData()
    const payload: Record<string, unknown> = {}
    const entries =
        input instanceof FormData ? [...input.entries()] : Object.entries(input)
    for (const [key, value] of entries) {
        if (value instanceof Blob) form.append(key, value)
        else payload[key] = value
    }
    form.append('@jsonPayload', JSON.stringify(payload))
    return form
}

export interface PbReadOptions {
    fields?: string
    requestKey?: string | null
    rated?: boolean
}

export interface RouteList<T> {
    items: T[]
    page: number
    limit: number
    total?: number
}

export interface PageQuery {
    page?: number
    limit?: number
    total?: boolean
}
