import { createError, getHeader, type H3Event } from 'h3'
import { API_VERSION_HEADER } from '#shared/utils/apiVersion'

export type Api = typeof $fetch

function bearer(event: H3Event) {
    const token = (getHeader(event, 'authorization') || '')
        .replace(/^Bearer\s+/i, '')
        .trim()
    return token ? `Bearer ${token}` : ''
}

export function apiFetch(event?: H3Event): Api {
    const authorization = event ? bearer(event) : ''
    const config = useRuntimeConfig()
    const appVersion = String(config.public.appVersion ?? '')
    return $fetch.create({
        baseURL: `${config.apiBase}/api`,
        retry: 0,
        headers: {
            ...(authorization ? { Authorization: authorization } : {}),
            ...(appVersion ? { [API_VERSION_HEADER]: appVersion } : {}),
        },
    })
}

export async function fetchAll<T>(
    api: Api,
    path: string,
    query: Record<string, string | undefined>,
    limit: number,
) {
    const items: T[] = []
    for (let page = 1; ; page++) {
        const result = await api<{ items: T[] }>(path, {
            query: { ...query, page, limit },
        })
        items.push(...result.items)
        if (result.items.length < limit) return items
    }
}

interface OwnMembership {
    gym: { id: string }
    role: { permissions: string[] }
}

export async function requirePermission(
    event: H3Event,
    permission: string,
    gymId: string,
) {
    if (!bearer(event)) {
        throw createError({
            statusCode: 401,
            statusMessage: 'Authentication required.',
        })
    }
    const api = apiFetch(event)
    const memberships = await api<OwnMembership[]>('/me/memberships').catch(
        (error: { status?: number }) => {
            const isAuthError = error?.status === 401 || error?.status === 403
            throw createError(
                isAuthError
                    ? {
                          statusCode: 401,
                          statusMessage: 'Invalid or expired session.',
                      }
                    : {
                          statusCode: 503,
                          statusMessage: 'Service unavailable.',
                      },
            )
        },
    )
    const membership = memberships.find(({ gym }) => gym.id === gymId)
    if (!gymId || !membership?.role.permissions.includes(permission)) {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden.' })
    }
    return api
}

export async function fetchFile(
    api: Api,
    table: string,
    record: { id: string },
    name: string,
) {
    try {
        const data = await api<ArrayBuffer>(
            `/files/${table}/${record.id}/${encodeURIComponent(name)}`,
            { responseType: 'arrayBuffer' },
        )
        return Buffer.from(data)
    } catch (error) {
        console.error('Failed to fetch file:', error)
        return null
    }
}
