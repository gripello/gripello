import type { GymRecord, RoleRecord } from '~/types/models'
import {
    isPermanentlySuspended,
    isSuspended,
    suspensionEnd,
    joinableGyms,
    membershipChips,
    rolesOfGym,
    userDisplayName,
    userKeptThroughReload,
    type PlatformUser,
} from '~/utils/platformUsers'

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

describe('isSuspended', () => {
    const now = new Date('2026-10-06T12:00:00Z')

    it('only counts suspensions that have not ended', () => {
        expect(
            isSuspended({ suspended_until: '2026-10-07 00:00:00.000Z' }, now),
        ).toBe(true)
        expect(
            isSuspended({ suspended_until: '2026-10-01 00:00:00.000Z' }, now),
        ).toBe(false)
        expect(isSuspended({ suspended_until: '' }, now)).toBe(false)
        expect(isSuspended({}, now)).toBe(false)
    })
})

describe('isPermanentlySuspended', () => {
    it('recognises the lifetime end date', () => {
        expect(
            isPermanentlySuspended({
                suspended_until: '9999-12-31 00:00:00.000Z',
            }),
        ).toBe(true)
        expect(
            isPermanentlySuspended({
                suspended_until: '2027-01-01 00:00:00.000Z',
            }),
        ).toBe(false)
    })
})

describe('suspensionEnd', () => {
    const now = new Date('2026-10-06T12:00:00.000Z')

    it('turns presets into an end date', () => {
        expect(suspensionEnd('week', '', now)).toBe('2026-10-13 12:00:00.000Z')
        expect(suspensionEnd('month', '', now)).toBe('2026-11-05 12:00:00.000Z')
        expect(suspensionEnd('until', '2026-12-24', now)).toBe(
            new Date('2026-12-24T23:59:59.999').toISOString().replace('T', ' '),
        )
    })

    it('leaves permanent suspensions without a date', () => {
        expect(suspensionEnd('permanent', '', now)).toBeNull()
    })
})

describe('userKeptThroughReload', () => {
    const paula = { id: 'u1', username: 'paula' } as PlatformUser
    const fresh = { id: 'u1', username: 'paula2' } as PlatformUser

    it('prefers the reloaded record', () => {
        expect(userKeptThroughReload([fresh], 'u1', paula)).toBe(fresh)
    })

    it('keeps the previous record while the list is empty', () => {
        expect(userKeptThroughReload([], 'u1', paula)).toBe(paula)
    })

    it('drops a previous record of another user', () => {
        expect(userKeptThroughReload([], 'u2', paula)).toBeNull()
    })
})
