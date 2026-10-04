import type { GymRecord, RoleRecord } from '~/types/models'
import {
    joinableGyms,
    membershipChips,
    platformUserFilter,
    rolesOfGym,
    userDisplayName,
    type PlatformUser,
} from '~/utils/platformUsers'

const filter = (raw: string, params?: Record<string, unknown>) =>
    raw.replace(/\{:(\w+)\}/g, (_, key) => JSON.stringify(params?.[key]))

const gyms = [
    { id: 'g1', slug: 'zeta', name: 'Zeta' },
    { id: 'g2', slug: 'alpha', name: 'Alpha Hall', unit_name: 'Alpha' },
    { id: 'g3', slug: 'beta', name: 'Beta' },
] as GymRecord[]

const roles = [
    { id: 'r1', gym: 'g1', name: 'admin', color: '#ff0000' },
    { id: 'r2', gym: 'g2', name: 'routesetter', color: '' },
    { id: 'r3', gym: 'g2', name: 'admin' },
] as RoleRecord[]

const user = {
    id: 'u1',
    username: 'ada',
    email: 'ada@example.com',
    expand: {
        memberships_via_user: [
            { id: 'm1', user: 'u1', gym: 'g1', role: 'r1' },
            { id: 'm2', user: 'u1', gym: 'g2', role: 'r2' },
        ],
    },
} as PlatformUser

describe('platformUserFilter', () => {
    it('combines the search term with the chosen filter', () => {
        expect(platformUserFilter(filter, '  ', null)).toBe('')
        expect(platformUserFilter(filter, '', 'platform_admins')).toBe(
            'platform_admin = true',
        )
        const combined = platformUserFilter(filter, ' ada ', 'unverified')
        expect(combined).toContain('email ~ "ada"')
        expect(combined).toContain('name ~ "ada"')
        expect(combined.endsWith(' && verified = false')).toBe(true)
    })

    it('also matches users found by their hidden email', () => {
        const withIds = platformUserFilter(filter, 'ada@', null, ['u1', 'u2'])
        expect(withIds).toContain('id = "u1"')
        expect(withIds).toContain('id = "u2"')
        expect(withIds.startsWith('(') && withIds.endsWith(')')).toBe(true)
    })
})

describe('userDisplayName', () => {
    it('prefers the full name, then username, then email', () => {
        expect(
            userDisplayName({ ...user, firstname: 'Ada', name: 'Lovelace' }),
        ).toBe('Ada Lovelace')
        expect(userDisplayName(user)).toBe('ada')
        expect(userDisplayName({ ...user, username: '' })).toBe(
            'ada@example.com',
        )
    })
})

describe('membershipChips', () => {
    it('labels memberships with gym title and role, sorted by gym', () => {
        expect(membershipChips(user, gyms, roles)).toEqual([
            {
                id: 'm2',
                gym: 'g2',
                gymTitle: 'Alpha',
                role: 'r2',
                roleName: 'routesetter',
                roleColor: null,
            },
            {
                id: 'm1',
                gym: 'g1',
                gymTitle: 'Zeta',
                role: 'r1',
                roleName: 'admin',
                roleColor: '#ff0000',
            },
        ])
        expect(membershipChips({ ...user, expand: {} }, gyms, roles)).toEqual(
            [],
        )
    })

    it('offers only gyms the user has not joined and their roles', () => {
        const chips = membershipChips(user, gyms, roles)
        expect(joinableGyms(chips, gyms).map((gym) => gym.id)).toEqual(['g3'])
        expect(rolesOfGym(roles, 'g2').map((role) => role.id)).toEqual([
            'r2',
            'r3',
        ])
    })
})
