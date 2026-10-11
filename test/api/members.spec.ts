import { beforeEach, describe, expect, it } from 'vitest'
import {
    acceptInvite,
    changeMembershipRole,
    createMembership,
    createRole,
    deleteMembership,
    deleteRole,
    findRole,
    inviteMember,
    listInvites,
    listMembers,
    listRoles,
    revokeInvite,
    setRolePermissions,
    showInvite,
    updateRole,
} from '~/api/members'
import { useAuthState } from '~/api/auth'
import { mockApi } from './apiMock'

const token = `x.${btoa(JSON.stringify({ exp: 4102444800 }))}.y`

let api: ReturnType<typeof mockApi>

beforeEach(() => {
    api = mockApi()
})

describe('listMembers', () => {
    it('lists every member of a gym', async () => {
        api.respond({ items: [{ id: 'm1' }], page: 1, limit: 0 })
        const list = await listMembers('g1')
        expect(api.request().url).toBe('/api/gyms/g1/members')
        expect(list.items).toEqual([{ id: 'm1' }])
    })

    it('pages a search by name and role with the total', async () => {
        api.respond({ items: [], page: 2, limit: 48, total: 7 })
        const list = await listMembers('g1', {
            q: 'ann',
            role: 'r1',
            sort: '-created',
            page: 2,
            limit: 48,
            total: true,
        })
        expect(api.request().url).toBe(
            '/api/gyms/g1/members?q=ann&role=r1&sort=-created&page=2&limit=48&total=true',
        )
        expect(list.total).toBe(7)
    })
})

describe('memberships', () => {
    it('adds an existing user to a gym', async () => {
        api.respond({ id: 'm1' })
        await createMembership({ user: 'u1', gym: 'g1', role: 'r1' })
        expect(api.request()).toMatchObject({
            url: '/api/gyms/g1/memberships',
            method: 'POST',
            body: { user: 'u1', role: 'r1' },
        })
    })

    it('changes the role and deletes', async () => {
        await changeMembershipRole('m1', 'r2')
        expect(api.request()).toMatchObject({
            url: '/api/memberships/m1/role',
            method: 'POST',
            body: { role: 'r2' },
        })
        api.fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
        await deleteMembership('m1')
        expect(api.request()).toMatchObject({
            url: '/api/memberships/m1',
            method: 'DELETE',
        })
    })

    it('invites by e-mail', async () => {
        await inviteMember('g1', { email: 'a@b.c', role: 'r1' })
        expect(api.request()).toMatchObject({
            url: '/api/gyms/g1/members',
            method: 'POST',
            body: { email: 'a@b.c', role: 'r1' },
        })
    })
})

describe('roles', () => {
    it('lists the roles of a gym with a search and limit', async () => {
        api.respond([{ id: 'r1', members: 2 }])
        expect(await listRoles('g1', { q: 'set', limit: 5 })).toEqual([
            { id: 'r1', members: 2 },
        ])
        expect(api.request().url).toBe('/api/gyms/g1/roles?q=set&limit=5')
    })

    it('lists every gym role for platform admins', async () => {
        api.respond([])
        await listRoles(null)
        expect(api.request().url).toBe('/api/platform/roles')
    })

    it('finds a role by its exact name', async () => {
        api.respond([
            { id: 'r0', name: 'admins' },
            { id: 'r1', name: 'admin' },
        ])
        expect((await findRole('g1', 'admin')).id).toBe('r1')
        api.respond([])
        await expect(findRole('g1', 'admin')).rejects.toThrow()
    })

    it('creates, updates and sets permissions', async () => {
        await createRole('g1', {
            name: 'Helper',
            permissions: ['manage_tasks'],
        })
        expect(api.request()).toMatchObject({
            url: '/api/gyms/g1/roles',
            method: 'POST',
            body: { name: 'Helper', permissions: ['manage_tasks'] },
        })
        await updateRole('r1', { name: 'Crew' })
        expect(api.request()).toMatchObject({
            url: '/api/roles/r1',
            method: 'PATCH',
            body: { name: 'Crew' },
        })
        await setRolePermissions('r1', ['manage_routes'])
        expect(api.request()).toMatchObject({
            url: '/api/roles/r1/permissions',
            method: 'PUT',
            body: { permissions: ['manage_routes'] },
        })
    })

    it('deletes a role, moving its holders when asked', async () => {
        await deleteRole('r1')
        expect(api.request()).toMatchObject({
            url: '/api/roles/r1',
            method: 'DELETE',
        })
        await deleteRole('r1', 'r2')
        expect(api.request().url).toBe('/api/roles/r1?reassign_to=r2')
    })
})

describe('invites', () => {
    it('lists and revokes invites', async () => {
        api.respond([{ id: 'i1', role_name: 'admin' }])
        expect(await listInvites('g1')).toEqual([
            { id: 'i1', role_name: 'admin' },
        ])
        expect(api.request().url).toBe('/api/gyms/g1/invites')
        await revokeInvite('i1')
        expect(api.request()).toMatchObject({
            url: '/api/invites/i1',
            method: 'DELETE',
        })
    })

    it('shows an invite by token', async () => {
        api.respond({ email: 'a@b.c' })
        expect(await showInvite('t/1')).toEqual({ email: 'a@b.c' })
        expect(api.request().url).toBe('/api/invites/t%2F1')
    })

    it('accepts and signs in a newly created account', async () => {
        api.respond({ gym: 'gym', token, record: { id: 'u1' } })
        const result = await acceptInvite('tok', { password: 'secret123' })
        expect(api.request()).toMatchObject({
            url: '/api/invites/tok/accept',
            method: 'POST',
            body: { password: 'secret123' },
        })
        expect(result.gym).toBe('gym')
        expect(useAuthState().currentUserId()).toBe('u1')
    })

    it('keeps the session when joining with an existing account', async () => {
        useAuthState().saveAuth({ token, record: { id: 'u2' } as never })
        api.respond({ gym: 'gym' })
        await acceptInvite('tok')
        expect(useAuthState().currentUserId()).toBe('u2')
    })
})
