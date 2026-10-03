import PocketBase from 'pocketbase'
import { getHeader, createError, type H3Event } from 'h3'
import { permissionsIn } from '#shared/utils/memberships'
import type { MembershipRecord } from '../../types/models'

export function createPocketBase() {
    const url = import.meta.dev
        ? 'http://localhost:8090'
        : 'http://127.0.0.1:8080'
    return new PocketBase(url)
}

export function getAuthenticatedPb(event: H3Event) {
    const header = getHeader(event, 'authorization') || ''
    const token = header.replace(/^Bearer\s+/i, '').trim()

    if (!token) {
        throw createError({
            statusCode: 401,
            statusMessage: 'Authentication required.',
        })
    }

    const pb = createPocketBase()
    pb.authStore.save(token, null)

    if (!pb.authStore.isValid) {
        throw createError({
            statusCode: 401,
            statusMessage: 'Invalid or expired session.',
        })
    }

    return pb
}

export async function requirePermission(
    event: H3Event,
    permission: string,
    gymId: string,
) {
    const pb = getAuthenticatedPb(event)

    const auth = await pb
        .collection('users')
        .authRefresh({
            expand: 'memberships_via_user.role.permissions',
            requestKey: null,
        })
        .catch((error: { status?: number }) => {
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
        })

    const memberships = (auth.record.expand?.memberships_via_user ??
        []) as MembershipRecord[]
    if (!permissionsIn(memberships, gymId).includes(permission)) {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden.' })
    }

    return pb
}
