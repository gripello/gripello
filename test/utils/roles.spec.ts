import { describe, it, expect } from 'vitest'
import {
    PROTECTED_ROLE_NAME,
    isProtectedRole,
    reassignTargets,
    defaultReassignTarget,
    groupPermissions,
    memberCountsByRole,
    revokesOwnAccess,
} from '~/utils/roles'
import type { RoleRecord } from '~/types/models'

function role(
    id: string,
    name: string,
    color?: string,
    permissions: string[] = [],
): RoleRecord {
    return { id, name, color, permissions } as RoleRecord
}

const ADMIN = role('r_admin', 'admin', '#7C4DFF', ['p1', 'p2', 'p3'])
const SETTER = role('r_setter', 'routesetter', '#26A69A', ['p1', 'p2'])
const USER = role('r_user', 'helper', '#78909C', ['p1'])
const ALL = [ADMIN, SETTER, USER]

describe('isProtectedRole', () => {
    it('protects only the admin role', () => {
        expect(PROTECTED_ROLE_NAME).toBe('admin')
        expect(isProtectedRole(ADMIN)).toBe(true)
        expect(isProtectedRole(SETTER)).toBe(false)
        expect(isProtectedRole(USER)).toBe(false)
    })

    it('does not protect a lookalike name', () => {
        expect(isProtectedRole(role('x', 'Admin'))).toBe(false)
        expect(isProtectedRole(role('x', 'admins'))).toBe(false)
    })
})

describe('reassignTargets', () => {
    it('offers every role but the one being deleted', () => {
        expect(reassignTargets(ALL, SETTER.id)).toEqual([ADMIN, USER])
    })

    it('is empty when the deleted role is the only one', () => {
        expect(reassignTargets([SETTER], SETTER.id)).toEqual([])
    })
})

describe('defaultReassignTarget', () => {
    it('preselects the role with the fewest permissions', () => {
        expect(defaultReassignTarget(ALL, SETTER.id)).toBe(USER.id)
        expect(defaultReassignTarget(ALL, USER.id)).toBe(SETTER.id)
    })

    it('falls back to admin only when nothing else is left', () => {
        expect(defaultReassignTarget([ADMIN, SETTER], SETTER.id)).toBe(ADMIN.id)
    })

    it('returns null when nothing is left to move people to', () => {
        expect(defaultReassignTarget([SETTER], SETTER.id)).toBeNull()
    })

    it('never preselects the role being deleted', () => {
        expect(defaultReassignTarget(ALL, USER.id)).not.toBe(USER.id)
    })
})

describe('groupPermissions', () => {
    const permission = (name: string) => ({ id: name, name })

    it('sorts permissions into their groups in a fixed order', () => {
        const groups = groupPermissions(
            ['manage_users', 'judge_competitions', 'manage_routes'].map(
                permission,
            ),
        )
        expect(
            groups.map(({ key, permissions }) => [
                key,
                permissions.map(({ name }) => name),
            ]),
        ).toEqual([
            ['routes', ['manage_routes']],
            ['competitions', ['judge_competitions']],
            ['admin', ['manage_users']],
        ])
    })

    it('keeps unknown permissions in an extra group', () => {
        const groups = groupPermissions([permission('brand_new')])
        expect(groups).toEqual([
            {
                key: 'other',
                icon: 'i-lucide-ellipsis',
                permissions: [permission('brand_new')],
            },
        ])
    })
})

describe('memberCountsByRole', () => {
    it('counts memberships per role and skips empty roles', () => {
        expect(
            memberCountsByRole([
                { role: 'a' },
                { role: 'b' },
                { role: 'a' },
                { role: '' },
                { role: null },
            ]),
        ).toEqual({ a: 2, b: 1 })
    })
})

describe('revokesOwnAccess', () => {
    const permissions = [
        { id: 'p_users', name: 'manage_users' },
        { id: 'p_settings', name: 'manage_settings' },
        { id: 'p_routes', name: 'manage_routes' },
    ]
    const own = {
        id: 'r_own',
        permissions: ['p_users', 'p_settings', 'p_routes'],
    }
    const base = {
        role: own,
        permissions,
        ownRoleId: 'r_own',
        platformAdmin: false,
    }

    it('flags removing manage_users or manage_settings from the own role', () => {
        expect(
            revokesOwnAccess({
                ...base,
                nextPermissions: ['p_settings', 'p_routes'],
            }),
        ).toBe(true)
        expect(
            revokesOwnAccess({
                ...base,
                nextPermissions: ['p_users', 'p_routes'],
            }),
        ).toBe(true)
        expect(revokesOwnAccess({ ...base, nextPermissions: [] })).toBe(true)
    })

    it('ignores harmless changes', () => {
        expect(
            revokesOwnAccess({
                ...base,
                nextPermissions: ['p_users', 'p_settings'],
            }),
        ).toBe(false)
        expect(
            revokesOwnAccess({
                ...base,
                role: { id: 'r_own', permissions: ['p_routes'] },
                nextPermissions: [],
            }),
        ).toBe(false)
    })

    it('ignores other roles and platform admins', () => {
        expect(
            revokesOwnAccess({
                ...base,
                ownRoleId: 'r_other',
                nextPermissions: [],
            }),
        ).toBe(false)
        expect(
            revokesOwnAccess({
                ...base,
                ownRoleId: undefined,
                nextPermissions: [],
            }),
        ).toBe(false)
        expect(
            revokesOwnAccess({
                ...base,
                platformAdmin: true,
                nextPermissions: [],
            }),
        ).toBe(false)
    })
})
