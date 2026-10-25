import type { GymRecord, RoleRecord } from '~/types/models'
import {
    blockChoices,
    isPermanentlySuspended,
    isSuspended,
    lastSeenLabel,
    lastSeenTone,
    mergeActivity,
    nextPlatformUserSort,
    platformUserFilterFrom,
    platformUserSortFrom,
    sortOrderOf,
    suspensionEnd,
    userAlert,
    joinableGyms,
    membershipChips,
    rolesOfGym,
    userKeptThroughReload,
    userSecurityState,
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
    memberships: [
        { id: 'm1', gym: 'g1', role: 'r1' },
        { id: 'm2', gym: 'g2', role: 'r2' },
    ],
} as PlatformUser

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
        expect(
            membershipChips({ ...user, memberships: [] }, gyms, roles),
        ).toEqual([])
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
            isSuspended({ suspended_until: '2026-10-07T00:00:00.000Z' }, now),
        ).toBe(true)
        expect(
            isSuspended({ suspended_until: '2026-10-01T00:00:00.000Z' }, now),
        ).toBe(false)
        expect(isSuspended({ suspended_until: '' }, now)).toBe(false)
        expect(isSuspended({}, now)).toBe(false)
    })
})

describe('isPermanentlySuspended', () => {
    it('recognises the lifetime end date', () => {
        expect(
            isPermanentlySuspended({
                suspended_until: '9999-12-31T00:00:00.000Z',
            }),
        ).toBe(true)
        expect(
            isPermanentlySuspended({
                suspended_until: '2027-01-01T00:00:00.000Z',
            }),
        ).toBe(false)
    })
})

describe('suspensionEnd', () => {
    const now = new Date('2026-10-06T12:00:00.000Z')

    it('turns presets into an end date', () => {
        expect(suspensionEnd('week', '', now)).toBe('2026-10-13T12:00:00.000Z')
        expect(suspensionEnd('month', '', now)).toBe('2026-11-05T12:00:00.000Z')
        expect(suspensionEnd('until', '2026-12-24', now)).toBe(
            new Date('2026-12-24T23:59:59.999').toISOString(),
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

describe('userSecurityState', () => {
    const climber = {
        id: 'u1',
        mfa_enabled: true,
        session_count: 2,
        locked_until: '2026-10-10T12:00:00Z',
    } as PlatformUser

    it('lets admins act on climbers and reports their state', () => {
        expect(userSecurityState(climber, 'admin')).toEqual({
            isSelf: false,
            canAct: true,
            mfa: true,
            sessions: 2,
            locked: true,
        })
    })

    it('keeps admins away from themselves and other admins', () => {
        expect(userSecurityState(climber, 'u1')).toMatchObject({
            isSelf: true,
            canAct: false,
        })
        expect(
            userSecurityState({ ...climber, platform_admin: true }, 'admin')
                .canAct,
        ).toBe(false)
    })

    it('treats missing fields as nothing to do', () => {
        expect(
            userSecurityState({ id: 'u2' } as PlatformUser, 'admin'),
        ).toMatchObject({ mfa: false, sessions: 0, locked: false })
    })
})

describe('blockChoices', () => {
    const base = {
        email: 'x@spam.test',
        domain: 'spam.test',
        freemail: false,
        domain_accounts: 2,
        domain_suspended: 1,
        email_blocked: false,
        domain_blocked: false,
    }

    it('offers the address and a custom domain', () => {
        expect(blockChoices(base)).toEqual({ email: true, domain: true })
    })

    it('never offers a public provider', () => {
        expect(blockChoices({ ...base, freemail: true })).toEqual({
            email: true,
            domain: false,
        })
    })

    it('skips what is already blocked', () => {
        expect(blockChoices({ ...base, email_blocked: true })).toEqual({
            email: false,
            domain: true,
        })
        expect(blockChoices({ ...base, domain_blocked: true })).toEqual({
            email: false,
            domain: false,
        })
        expect(blockChoices(null)).toEqual({ email: false, domain: false })
    })
})

describe('users page query and sorting', () => {
    it('reads only known filters and sorts from the URL', () => {
        expect(platformUserFilterFrom('staff_no_mfa')).toBe('staff_no_mfa')
        expect(platformUserFilterFrom('nope')).toBeNull()
        expect(platformUserFilterFrom(['locked'])).toBeNull()
        expect(platformUserSortFrom('created')).toBe('created')
        expect(platformUserSortFrom(undefined)).toBe('-last_seen')
        expect(platformUserSortFrom('name')).toBe('-last_seen')
    })

    it('cycles a column ascending, descending, then back to the default', () => {
        expect(nextPlatformUserSort('-last_seen', 'email')).toBe('email')
        expect(nextPlatformUserSort('email', 'email')).toBe('-email')
        expect(nextPlatformUserSort('-email', 'email')).toBe('-last_seen')
        expect(nextPlatformUserSort('-last_seen', 'last_seen')).toBe(
            'last_seen',
        )
        expect(sortOrderOf('-created', 'created')).toBe('desc')
        expect(sortOrderOf('-created', 'email')).toBeNull()
        expect(nextPlatformUserSort('email', 'status')).toBe('status')
        expect(nextPlatformUserSort('-gyms', 'gyms')).toBe('-last_seen')
        expect(platformUserSortFrom('-mfa')).toBe('-mfa')
    })
})

describe('lastSeenTone', () => {
    const now = Date.parse('2026-10-24T12:00:00Z')
    const ago = (minutes: number) =>
        new Date(now - minutes * 60_000).toISOString()

    it('buckets the last session activity', () => {
        expect(lastSeenTone(null, now)).toBe('never')
        expect(lastSeenTone(ago(1), now)).toBe('online')
        expect(lastSeenTone(ago(3), now)).toBe('active')
        expect(lastSeenTone(ago(60 * 24 * 3), now)).toBe('active')
        expect(lastSeenTone(ago(60 * 24 * 30), now)).toBe('idle')
        expect(lastSeenTone(ago(60 * 24 * 120), now)).toBe('dormant')
    })

    it('labels online and never-seen users instead of a time', () => {
        const t = (key: string) => key
        expect(lastSeenLabel(null, t, 'en', now)).toBe('platform.users.never')
        expect(lastSeenLabel(new Date().toISOString(), t, 'en')).toBe(
            'platform.users.onlineNow',
        )
        expect(lastSeenLabel(ago(60 * 24 * 3), t, 'en', now)).toBe(
            'time.daysAgo',
        )
    })
})

describe('userAlert', () => {
    const now = new Date('2026-10-24T12:00:00Z')
    const base = { id: 'u', verified: true, mfa_enabled: true } as PlatformUser

    it('ranks suspension over lockout over verification over 2FA', () => {
        const all = {
            ...base,
            verified: false,
            mfa_enabled: false,
            memberships: [{ id: 'm', gym: 'g', role: 'r' }],
            suspended_until: '2026-11-01T00:00:00.000Z',
            locked_until: '2026-10-24T13:00:00.000Z',
        }
        expect(userAlert(all, now)).toBe('suspended')
        expect(userAlert({ ...all, suspended_until: null }, now)).toBe('locked')
        expect(
            userAlert(
                { ...all, suspended_until: null, locked_until: null },
                now,
            ),
        ).toBe('unverified')
        expect(
            userAlert(
                {
                    ...all,
                    suspended_until: null,
                    locked_until: null,
                    verified: true,
                },
                now,
            ),
        ).toBe('staffNoMfa')
    })

    it('stays quiet for climbers without 2FA and for expired states', () => {
        expect(userAlert({ ...base, mfa_enabled: false }, now)).toBeNull()
        expect(
            userAlert(
                {
                    ...base,
                    suspended_until: '2026-10-01T00:00:00.000Z',
                    locked_until: '2026-10-24T11:00:00.000Z',
                },
                now,
            ),
        ).toBeNull()
    })
})

describe('mergeActivity', () => {
    it('drops duplicates and puts the newest first', () => {
        const entry = (id: string, created: string) =>
            ({ id, created }) as never
        const merged = mergeActivity(
            [
                entry('a', '2026-10-01T00:00:00.000Z'),
                entry('b', '2026-10-03T00:00:00.000Z'),
            ],
            [
                entry('b', '2026-10-03T00:00:00.000Z'),
                entry('c', '2026-10-02T00:00:00.000Z'),
            ],
        )
        expect(merged.map((item: { id: string }) => item.id)).toEqual([
            'b',
            'c',
            'a',
        ])
    })
})
