import { describe, expect, it } from 'vitest'
import { activeMemberships, canGrantRole } from '#shared/utils/memberships'

describe('activeMemberships', () => {
    it('keeps only memberships of active gyms', () => {
        const active = { expand: { gym: { active: true } } }
        expect(
            activeMemberships([
                active,
                { expand: { gym: { active: false } } },
                { expand: {} },
            ]),
        ).toEqual([active])
    })
})

describe('canGrantRole', () => {
    const admin = { name: 'admin', permissions: ['a', 'b', 'c'] }
    const setter = { name: 'routesetter', permissions: ['a', 'b'] }
    const narrow = { name: 'helper', permissions: ['a'] }

    it('lets platform admins grant every role', () => {
        expect(canGrantRole(admin, undefined, true)).toBe(true)
    })

    it('limits others to roles within their own permissions', () => {
        expect(canGrantRole(narrow, setter, false)).toBe(true)
        expect(canGrantRole(setter, narrow, false)).toBe(false)
        expect(canGrantRole(narrow, undefined, false)).toBe(false)
    })

    it('reserves the admin role for admins', () => {
        expect(canGrantRole(admin, admin, false)).toBe(true)
        expect(canGrantRole({ ...admin, permissions: [] }, setter, false)).toBe(
            false,
        )
    })
})
