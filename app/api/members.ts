import type {
    InviteDetails,
    InviteRecord,
    RoleRecord,
} from '../../types/models'
import { useAuthState, type AuthResult } from './auth'
import { useApi } from './client'

export interface MemberQuery {
    q?: string
    role?: string
    sort?: 'name' | '-name' | 'created' | '-created'
    page?: number
    limit?: number
    total?: boolean
}

export interface MemberUser {
    id: string
    username: string
    firstname: string
    name: string
    avatar: string
    email?: string
}

export type Role = RoleRecord & { permissions: string[] }
export type ListedRole = Role & {
    members: number
    gym_slug?: string
    gym_name?: string
}

export interface Member {
    id: string
    gym: string
    user: MemberUser
    role: Role
    created: string
    updated: string
}

export interface MemberPage {
    items: Member[]
    page: number
    limit: number
    total?: number
}

export interface Membership {
    id: string
    user: string
    gym: string
    role: string
}

export interface InviteRequest {
    email: string
    role: string
    firstname?: string
    name?: string
}

export interface AcceptInviteRequest {
    password?: string
    passwordConfirm?: string
    firstname?: string
    name?: string
}

export interface AcceptInviteResponse {
    gym: string
    token?: string
    record?: AuthResult['record']
}

export type RoleInput = Partial<
    Pick<RoleRecord, 'name' | 'description' | 'color' | 'permissions'>
>

export function listMembers(gym: string, query: MemberQuery = {}) {
    return useApi()<MemberPage>(`/gyms/${gym}/members`, {
        query: {
            ...(query.q ? { q: query.q } : {}),
            ...(query.role ? { role: query.role } : {}),
            ...(query.sort ? { sort: query.sort } : {}),
            ...(query.page ? { page: query.page, limit: query.limit } : {}),
            ...(query.total ? { total: true } : {}),
        },
    })
}

export function inviteMember(gym: string, invite: InviteRequest) {
    return useApi()(`/gyms/${gym}/members`, { method: 'POST', body: invite })
}

export function createMembership(
    input: Pick<Membership, 'user' | 'gym' | 'role'>,
) {
    return useApi()<Membership>(`/gyms/${input.gym}/memberships`, {
        method: 'POST',
        body: { user: input.user, role: input.role },
    })
}

export function changeMembershipRole(id: string, role: string) {
    return useApi()<Membership>(`/memberships/${id}/role`, {
        method: 'POST',
        body: { role },
    })
}

export function deleteMembership(id: string) {
    return useApi()(`/memberships/${id}`, { method: 'DELETE' })
}

export function listRoles(
    gym: string | null,
    query: { q?: string; limit?: number } = {},
) {
    return useApi()<ListedRole[]>(
        gym === null ? '/platform/roles' : `/gyms/${gym}/roles`,
        {
            query: {
                ...(query.q ? { q: query.q } : {}),
                ...(query.limit ? { limit: query.limit } : {}),
            },
        },
    )
}

export async function findRole(gym: string, name: string) {
    const role = (await listRoles(gym, { q: name })).find(
        (candidate) => candidate.name === name,
    )
    if (!role) throw new Error(`Role ${name} not found.`)
    return role
}

export function createRole(gym: string, input: RoleInput) {
    return useApi()<Role>(`/gyms/${gym}/roles`, {
        method: 'POST',
        body: input,
    })
}

export function updateRole(id: string, patch: Omit<RoleInput, 'permissions'>) {
    return useApi()<Role>(`/roles/${id}`, { method: 'PATCH', body: patch })
}

export function setRolePermissions(id: string, permissions: string[]) {
    return useApi()<Role>(`/roles/${id}/permissions`, {
        method: 'PUT',
        body: { permissions },
    })
}

export function deleteRole(id: string, reassignTo?: string) {
    return useApi()(`/roles/${id}`, {
        method: 'DELETE',
        query: reassignTo ? { reassign_to: reassignTo } : {},
    })
}

export function listInvites(gym: string) {
    return useApi()<InviteRecord[]>(`/gyms/${gym}/invites`)
}

export function revokeInvite(id: string) {
    return useApi()(`/invites/${id}`, { method: 'DELETE' })
}

export function showInvite(token: string) {
    return useApi()<InviteDetails>(`/invites/${encodeURIComponent(token)}`)
}

export async function acceptInvite(
    token: string,
    body: AcceptInviteRequest = {},
) {
    const result = await useApi()<AcceptInviteResponse>(
        `/invites/${encodeURIComponent(token)}/accept`,
        { method: 'POST', body },
    )
    if (result.token && result.record)
        useAuthState().saveAuth({ token: result.token, record: result.record })
    return result
}
