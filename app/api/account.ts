import type { ApiRecord } from '~/composables/authStore'
import type { SessionRecord, UserRecord } from '../../types/models'
import type { components as MembersApi } from '../../types/api/members'
import type { operations as AccountApi } from '../../types/api/account'
import { useAuthState, type AuthResult } from './auth'
import { apiUrl, toFormData, useApi } from './client'

export { listContributions } from './ratings'

export type MeInclude = 'memberships'
export type Me = UserRecord & ApiRecord

export interface Factor {
    id: string
    kind: 'totp' | 'passkey'
    name: string
    created: string
    last_used: string
}

export interface FactorAdded {
    factor: Factor
    recoveryCodes?: string[]
}

export interface PasswordChange {
    oldPassword: string
    password: string
    passwordConfirm: string
}

export type ProfileInput = Record<string, unknown>

export type OwnMembership = MembersApi['schemas']['OwnMembership']

export function listOwnMemberships() {
    return useApi()<OwnMembership[]>('/me/memberships')
}

export async function getMe(query: { include?: MeInclude[] } = {}) {
    const [me, memberships] = await Promise.all([
        useApi()<Me>('/me'),
        query.include?.includes('memberships')
            ? listOwnMemberships()
            : undefined,
    ])
    return memberships ? { ...me, memberships } : me
}

function saveMe(updated: Me) {
    useAuthState().saveUser(updated)
    return updated
}

export async function updateMe(patch: ProfileInput | FormData) {
    const multipart =
        patch instanceof FormData ||
        Object.values(patch).some((value) => value instanceof Blob)
    return saveMe(
        await useApi()<Me>('/me', {
            method: 'PATCH',
            body: multipart ? toFormData(patch) : patch,
        }),
    )
}

export async function followWall(wall: string) {
    return saveMe(
        await useApi()<Me>(`/me/followed-walls/${wall}`, { method: 'POST' }),
    )
}

export async function unfollowWall(wall: string) {
    return saveMe(
        await useApi()<Me>(`/me/followed-walls/${wall}`, { method: 'DELETE' }),
    )
}

export function reauthenticate(password: string) {
    return useApi()('/me/reauthenticate', {
        method: 'POST',
        body: { password },
    })
}

export async function changePassword(change: PasswordChange) {
    const result = await useApi()<AuthResult>('/me/password', {
        method: 'POST',
        body: change,
    })
    useAuthState().saveAuth(result)
    return result.record as Me
}

export async function deleteAvatar() {
    return saveMe(await useApi()<Me>('/me/avatar', { method: 'DELETE' }))
}

export async function deleteBanner() {
    return saveMe(await useApi()<Me>('/me/banner', { method: 'DELETE' }))
}

export function deleteMe(password: string) {
    return useApi()('/me', { method: 'DELETE', body: { password } })
}

export function requestDataExport() {
    return useApi()('/me/export', { method: 'POST' })
}

export function dataExportUrl(token: string) {
    return apiUrl(`/account/export/${encodeURIComponent(token)}`)
}

export function dataExportAvailable(token: string) {
    return useApi()(`/account/export/${encodeURIComponent(token)}`, {
        method: 'HEAD',
    }).then(
        () => true,
        (error: unknown) => {
            if ((error as { status?: number } | null)?.status === 404)
                return false
            throw error
        },
    )
}

export type OwnDataExport =
    AccountApi['getOwnDataExport']['responses']['200']['content']['application/json']

export function getOwnDataExport() {
    return useApi()<OwnDataExport>('/me/export')
}

export function ownDataExportUrl() {
    return apiUrl('/me/export/file')
}

export function listMFAFactors() {
    return useApi()<{ factors: Factor[]; recoveryCodesLeft: number }>('/me/mfa')
}

export function renameMFAFactor(id: string, name: string) {
    return useApi()<Factor>(`/me/mfa/${id}`, {
        method: 'PATCH',
        body: { name },
    })
}

export function deleteMFAFactor(id: string, password: string) {
    return useApi()(`/me/mfa/${id}`, {
        method: 'DELETE',
        body: { password },
    })
}

export function totpSetup(password: string) {
    return useApi()<{ secret: string; uri: string }>('/me/totp/setup', {
        method: 'POST',
        body: { password },
    })
}

export function totpEnable(input: {
    password: string
    secret: string
    code: string
}) {
    return useApi()<FactorAdded>('/me/totp', { method: 'POST', body: input })
}

export function regenerateRecoveryCodes(password: string) {
    return useApi()<{ recoveryCodes: string[] }>('/me/recovery-codes', {
        method: 'POST',
        body: { password },
    })
}

export function passkeyRegistrationOptions(password: string) {
    return useApi()<{ ceremony: string; options: unknown }>(
        '/me/passkeys/options',
        { method: 'POST', body: { password } },
    )
}

export function passkeyRegister(input: {
    ceremony: string
    credential: unknown
    name?: string
}) {
    return useApi()<FactorAdded>('/me/passkeys', {
        method: 'POST',
        body: input,
    })
}

export async function listSessions() {
    const { items } = await useApi()<{ items: SessionRecord[] }>('/me/sessions')
    return items
}

export function revokeSession(id: string) {
    return useApi()(`/me/sessions/${id}`, { method: 'DELETE' })
}

export async function signOutOtherSessions() {
    useAuthState().saveAuth(
        await useApi()<AuthResult>('/me/sessions/sign-out-others', {
            method: 'POST',
        }),
    )
}

export interface LinkedAccount {
    id: string
    provider: string
    email: string
    created: string
}

export function listLinkedAccounts() {
    return useApi()<{ items: LinkedAccount[]; hasPassword: boolean }>(
        '/me/identities',
    )
}

export function unlinkAccount(id: string) {
    return useApi()(`/me/identities/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    })
}
