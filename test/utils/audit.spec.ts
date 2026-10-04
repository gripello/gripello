import { describe, it, expect, vi, afterEach } from 'vitest'
import {
    AUDIT_ACTIONS,
    actionColor,
    actionIcon,
    compressIp,
    isRecordAction,
    auditTargetUrl,
    buildAuditFilter,
    isSuperuserEntry,
    matchesAuditActor,
    AUDIT_ACTOR_GUESTS,
    AUDIT_ACTOR_PLATFORM,
    pbDateString,
} from '~/utils/audit'

describe('buildAuditFilter', () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    it('returns an empty string when nothing is filtered', () => {
        expect(buildAuditFilter({})).toBe('')
        expect(buildAuditFilter({ search: '   ', period: 'all' })).toBe('')
    })

    it('filters by a single action', () => {
        expect(buildAuditFilter({ action: 'delete' })).toBe('action = "delete"')
    })

    it('scopes to one actor', () => {
        expect(buildAuditFilter({ actorId: 'usr123' })).toBe('actor = "usr123"')
    })

    it('filters by actor, guests or platform administrators', () => {
        expect(buildAuditFilter({ actor: 'usr123' })).toBe('actor = "usr123"')
        expect(buildAuditFilter({ actor: AUDIT_ACTOR_PLATFORM })).toBe(
            '(actor_label = "superuser" || actor_label ~ "superuser:%")',
        )
        expect(buildAuditFilter({ actor: AUDIT_ACTOR_GUESTS })).toBe(
            'actor = "" && actor_label != "superuser" && actor_label !~ "superuser:%"',
        )
    })

    it('scopes to one gym', () => {
        expect(buildAuditFilter({ gym: 'gym1', actor: 'usr1' })).toBe(
            'actor = "usr1" && gym = "gym1"',
        )
    })

    it('escapes backslashes and double quotes in the search term', () => {
        const filter = buildAuditFilter({ search: 'a"b\\c' })
        expect(filter).toContain('actor_label ~ "a\\"b\\\\c"')
        expect(filter.startsWith('(')).toBe(true)
    })

    it('turns a period into a created cutoff', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-09-21T12:00:00.000Z'))
        expect(buildAuditFilter({ period: '24h' })).toBe(
            'created >= "2026-09-20 12:00:00.000Z"',
        )
        expect(buildAuditFilter({ period: '7d' })).toBe(
            'created >= "2026-09-14 12:00:00.000Z"',
        )
    })

    it('emits no cutoff for the all-time period', () => {
        expect(buildAuditFilter({ period: 'all' })).toBe('')
    })

    it('joins several filters with &&', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-09-21T12:00:00.000Z'))
        expect(
            buildAuditFilter({
                action: 'update',
                collection: 'routes',
                period: '24h',
            }),
        ).toBe(
            'action = "update" && collection_name = "routes" && created >= "2026-09-20 12:00:00.000Z"',
        )
    })
})

describe('pbDateString', () => {
    it('formats as PocketBase stores dates', () => {
        expect(pbDateString(new Date('2026-06-23T06:28:16.309Z'))).toBe(
            '2026-06-23 06:28:16.309Z',
        )
    })
})

describe('actionColor', () => {
    it('gives the destructive and failed actions their own colours', () => {
        expect(actionColor('delete')).toBe('error')
        expect(actionColor('login_failed')).toBe('warning')
        expect(actionColor('create')).toBe('success')
    })

    it('degrades to a neutral colour for an unknown action', () => {
        expect(actionColor('something-else')).toBe('medium-emphasis')
    })

    it('returns a colour for every action in the list', () => {
        for (const action of AUDIT_ACTIONS) {
            expect(actionColor(action)).toBeTruthy()
        }
    })
})

describe('actionIcon', () => {
    it('returns an icon for every action in the list', () => {
        for (const action of AUDIT_ACTIONS) {
            expect(actionIcon(action)).toMatch(/^i-lucide-/)
        }
    })
})

describe('compressIp', () => {
    it('collapses the longest run of zero groups', () => {
        expect(compressIp('0000:0000:0000:0000:0000:0000:0000:0001')).toBe(
            '::1',
        )
        expect(compressIp('2001:0db8:0000:0000:0000:ff00:0042:8329')).toBe(
            '2001:db8::ff00:42:8329',
        )
    })

    it('leaves IPv4 and already-short values alone', () => {
        expect(compressIp('192.168.1.10')).toBe('192.168.1.10')
        expect(compressIp('::1')).toBe('::1')
        expect(compressIp('')).toBe('')
        expect(compressIp(null)).toBe('')
    })

    it('does not collapse a lone zero group', () => {
        expect(compressIp('2001:0db8:0001:0000:0002:0003:0004:0005')).toBe(
            '2001:db8:1:0:2:3:4:5',
        )
    })
})

describe('isRecordAction', () => {
    it('separates record actions from auth events', () => {
        expect(isRecordAction('create')).toBe(true)
        expect(isRecordAction('delete')).toBe(true)
        expect(isRecordAction('login')).toBe(false)
        expect(isRecordAction('password_reset')).toBe(false)
    })
})

describe('AUDIT_ACTIONS', () => {
    it('has no duplicates', () => {
        expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length)
    })

    it('matches the values the PocketBase select accepts', () => {
        expect([...AUDIT_ACTIONS].sort()).toEqual(
            [
                'create',
                'update',
                'delete',
                'login',
                'login_failed',
                'password_reset_request',
                'password_reset',
                'email_change_request',
                'email_change',
            ].sort(),
        )
    })
})

describe('auditTargetUrl', () => {
    it('links a route entry to its page', () => {
        expect(auditTargetUrl('routes', 'rt1')).toBe('/route?id=rt1')
    })

    it('opens staff pages inside the gym of the entry', () => {
        expect(auditTargetUrl('tasks', 't1', 'north')).toBe(
            '/north/manage/tasks',
        )
        expect(auditTargetUrl('users', 'u1', 'north')).toBe(
            '/north/admin/users',
        )
        expect(auditTargetUrl('ratings', 'x1')).toBe('/manage/comments')
        expect(auditTargetUrl('routes', 'rt1', 'north')).toBe('/route?id=rt1')
    })

    it('returns null when there is nowhere to go', () => {
        expect(auditTargetUrl('roles', 'r1')).toBeNull()
        expect(auditTargetUrl('routes', null)).toBeNull()
        expect(auditTargetUrl(null, 'rt1')).toBeNull()
    })
})

describe('isSuperuserEntry', () => {
    it('recognises a superuser entry by its label', () => {
        expect(isSuperuserEntry({ actor_label: 'superuser:a@b.test' })).toBe(
            true,
        )
        expect(isSuperuserEntry({ actor_label: 'a@b.test' })).toBe(false)
        expect(isSuperuserEntry({ actor_label: null })).toBe(false)
    })
})

describe('matchesAuditActor', () => {
    const user = { actor: 'usr1', actor_label: 'a@b.test' }
    const guest = { actor: '', actor_label: '1.2.3.4' }
    const platform = { actor: '', actor_label: 'superuser:root@b.test' }

    it('matches live rows the same way as the filter', () => {
        expect(matchesAuditActor(user, null)).toBe(true)
        expect(matchesAuditActor(user, 'usr1')).toBe(true)
        expect(matchesAuditActor(guest, 'usr1')).toBe(false)
        expect(matchesAuditActor(guest, AUDIT_ACTOR_GUESTS)).toBe(true)
        expect(matchesAuditActor(platform, AUDIT_ACTOR_GUESTS)).toBe(false)
        expect(matchesAuditActor(platform, AUDIT_ACTOR_PLATFORM)).toBe(true)
    })
})
