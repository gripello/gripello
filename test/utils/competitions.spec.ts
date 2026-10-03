import { describe, expect, it } from 'vitest'
import {
    acceptsRegistrations,
    birthYearRange,
    categoriesFor,
    competitionPhase,
    lifecycleActions,
    needsGuardianConsent,
    setupChecklist,
    copiedCompetition,
    defaultCategories,
    fromDateTimeInput,
    nextRouteNumber,
    scoringSettingsOf,
    toDateTimeInput,
    competitionRules,
    defaultDisplayName,
    formatCompetitionWindow,
    suggestedEnd,
    competitionShareUrl,
} from '~/utils/competitions'
import type { CompetitionRecord } from '~/types/models'

const competition: CompetitionRecord = {
    id: 'c1',
    name: 'Autumn Jam',
    description: 'Fun',
    location: 'loc',
    status: 'published',
    discipline: 'boulder',
    starts_at: '2026-10-10 10:00:00.000Z',
    ends_at: '2026-10-10 14:00:00.000Z',
    scoring_format: 'dynamic',
    scoring: { bestOf: 10 },
    live_ranking: true,
    freeze_minutes: 15,
}

describe('competitions', () => {
    it('fills scoring defaults and keeps the stored format', () => {
        expect(scoringSettingsOf(competition)).toEqual({
            format: 'dynamic',
            topPool: 1000,
            attemptFactors: [1, 0.9, 0.8],
            bestOf: 10,
        })
    })

    it('numbers new routes after the highest one', () => {
        expect(nextRouteNumber([])).toBe(1)
        expect(nextRouteNumber([{ number: 3 }, { number: 7 }])).toBe(8)
    })

    it('describes birth year ranges', () => {
        expect(
            birthYearRange({ min_birth_year: 2010, max_birth_year: 2013 }),
        ).toBe('2010–2013')
        expect(birthYearRange({ min_birth_year: 1986 })).toBe('1986+')
        expect(birthYearRange({ max_birth_year: 1976 })).toBe('≤ 1976')
        expect(birthYearRange({})).toBe('')
    })

    it('round-trips datetime-local input values', () => {
        const input = toDateTimeInput(competition.starts_at)
        expect(input).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
        expect(fromDateTimeInput(input)).toBe('2026-10-10 10:00:00.000Z')
        expect(toDateTimeInput('')).toBe('')
        expect(fromDateTimeInput('')).toBe('')
    })

    it('copies a competition as a new draft', () => {
        const copy = copiedCompetition(competition, 'Autumn Jam (copy)')
        expect(copy).toMatchObject({
            name: 'Autumn Jam (copy)',
            status: 'draft',
            scoring: { bestOf: 10 },
        })
        expect(copy).not.toHaveProperty('id')
    })

    it('suggests female and male categories', () => {
        expect(defaultCategories((key) => key).map((c) => c.gender)).toEqual([
            'female',
            'male',
        ])
    })

    it('derives the phase from status and time window', () => {
        const at = (iso: string) => new Date(iso)
        const open = { ...competition, status: 'open' as const }
        expect(
            competitionPhase(
                { ...open, status: 'draft' },
                at('2026-10-10T12:00:00Z'),
            ),
        ).toBe('draft')
        expect(competitionPhase(open, at('2026-10-09T12:00:00Z'))).toBe(
            'registration',
        )
        expect(competitionPhase(open, at('2026-10-10T12:00:00Z'))).toBe(
            'running',
        )
        expect(competitionPhase(open, at('2026-10-10T15:00:00Z'))).toBe('ended')
        expect(
            competitionPhase(
                { ...open, status: 'closed' },
                at('2026-10-10T12:00:00Z'),
            ),
        ).toBe('ended')
        expect(competitionPhase(competition, at('2026-10-10T12:00:00Z'))).toBe(
            'published',
        )
    })

    it('accepts registrations only while open and before the end', () => {
        const open = { ...competition, status: 'open' as const }
        expect(
            acceptsRegistrations(open, new Date('2026-10-10T13:59:00Z')),
        ).toBe(true)
        expect(
            acceptsRegistrations(open, new Date('2026-10-10T14:01:00Z')),
        ).toBe(false)
        expect(
            acceptsRegistrations(competition, new Date('2026-10-01T00:00:00Z')),
        ).toBe(false)
    })

    it('lists the setup steps the format needs', () => {
        expect(
            setupChecklist({
                competition: { scoring_format: 'dynamic' },
                categoryCount: 2,
                routes: [],
            }),
        ).toEqual([
            { step: 'details', done: true },
            { step: 'categories', done: true },
            { step: 'routes', done: false },
        ])
        const fixed = setupChecklist({
            competition: { scoring_format: 'route_points' },
            categoryCount: 1,
            routes: [{ points: 100 }, { points: 0, voided: true }],
        })
        expect(fixed.find((item) => item.step === 'points')?.done).toBe(true)
        const lead = setupChecklist({
            competition: { scoring_format: 'lead_height' },
            categoryCount: 1,
            routes: [{ hold_count: 40 }, { hold_count: 0 }],
        })
        expect(lead.find((item) => item.step === 'holds')?.done).toBe(false)
    })

    it('offers the next lifecycle step and a way back', () => {
        expect(lifecycleActions('draft')).toEqual({
            primary: 'open',
            secondary: [],
        })
        expect(lifecycleActions('open').primary).toBe('close')
        expect(lifecycleActions('closed')).toEqual({
            primary: 'publish',
            secondary: ['reopen'],
        })
        expect(lifecycleActions('published').primary).toBeNull()
    })

    it('only offers categories that fit the birth year', () => {
        const categories = [
            { name: 'Youth', min_birth_year: 2010, max_birth_year: 2013 },
            { name: 'Open' },
        ]
        expect(categoriesFor(categories, 2012).map((c) => c.name)).toEqual([
            'Youth',
            'Open',
        ])
        expect(categoriesFor(categories, 1990).map((c) => c.name)).toEqual([
            'Open',
        ])
        expect(categoriesFor(categories, null)).toHaveLength(2)
    })

    it('asks for guardian consent under 16', () => {
        const now = new Date('2026-10-03T12:00:00Z')
        expect(needsGuardianConsent(2011, now)).toBe(true)
        expect(needsGuardianConsent(2010, now)).toBe(false)
        expect(needsGuardianConsent(null, now)).toBe(false)
    })
})

describe('formatCompetitionWindow', () => {
    it('uses plain spaces so server and client render the same text', () => {
        const text = formatCompetitionWindow(
            {
                starts_at: '2026-10-03 13:53:00.000Z',
                ends_at: '2026-10-03 14:50:00.000Z',
            },
            'en',
        )
        expect(text).not.toMatch(/[\u202f\u2009\u00a0]/)
        expect(text).toContain('Oct 3, 2026')
    })
})

describe('suggestedEnd', () => {
    it('fills a missing or earlier end three hours after the start', () => {
        expect(suggestedEnd('2026-10-03T10:00', '')).toBe('2026-10-03T13:00')
        expect(suggestedEnd('2026-10-03T10:00', '2026-10-03T09:00')).toBe(
            '2026-10-03T13:00',
        )
        expect(suggestedEnd('2026-10-03T10:00', '2026-10-03T18:00')).toBe(
            '2026-10-03T18:00',
        )
        expect(suggestedEnd('', '')).toBe('')
    })
})

describe('competitionRules', () => {
    const base = {
        discipline: 'boulder' as const,
        scoring_format: 'dynamic' as const,
        scoring: null,
        live_ranking: true,
        freeze_minutes: 15,
    }
    const keys = (competition: Parameters<typeof competitionRules>[0]) =>
        competitionRules(competition).flatMap(({ lines }) =>
            lines.map((line) => line.key),
        )

    it('explains a self-scored dynamic boulder comp with a freeze', () => {
        const rules = competitionRules(base)
        expect(rules.map(({ section }) => section)).toEqual([
            'flow',
            'scoring',
            'ranking',
            'fairPlay',
        ])
        expect(keys(base)).toEqual([
            'signUp',
            'selfScore',
            'live',
            'freeze',
            'boulder.dynamicTop',
            'perCategory',
            'tieBreakPoints',
            'honest',
            'corrections',
            'boulder.removed',
        ])
        expect(rules[1]!.lines[0]!.params).toEqual({ pool: 1000 })
    })

    it('adds only the settings that are switched on', () => {
        const ruleKeys = keys({
            ...base,
            scoring: { zonePool: 500, flashBonus: 10, bestOf: 5 },
            live_ranking: false,
        })
        expect(ruleKeys).toContain('dynamicZone')
        expect(ruleKeys).toContain('flashBonus')
        expect(ruleKeys).toContain('boulder.bestOf')
        expect(ruleKeys).toContain('noLive')
        expect(keys({ ...base, requires_payment: true })).toContain('entryFee')
        expect(keys(base)).not.toContain('entryFee')
        expect(ruleKeys).not.toContain('freeze')
    })

    it('covers rope styles and judged lead height', () => {
        const routePoints = competitionRules({
            ...base,
            discipline: 'rope',
            scoring_format: 'route_points',
        })
        expect(routePoints[1]!.lines.map((line) => line.key)).toEqual([
            'rope.fixedPoints',
            'attemptFactors',
            'toprope',
        ])
        expect(routePoints[1]!.lines[1]!.params).toEqual({
            first: 100,
            second: 90,
            rest: 80,
        })
        const lead = keys({
            ...base,
            discipline: 'rope',
            scoring_format: 'lead_height',
        })
        expect(lead).toContain('judged')
        expect(lead).toContain('tieBreakLead')
        expect(lead).not.toContain('selfScore')
        expect(lead).not.toContain('toprope')
        expect(lead).not.toContain('honest')
    })
})

describe('defaultDisplayName', () => {
    it('uses first and last name, falling back to the username', () => {
        expect(
            defaultDisplayName({
                firstname: 'Jane',
                name: 'Doe',
                username: 'jdoe',
            }),
        ).toBe('Jane Doe')
        expect(
            defaultDisplayName({ firstname: ' Jane ', username: 'jdoe' }),
        ).toBe('Jane')
        expect(defaultDisplayName({ username: 'jdoe' })).toBe('jdoe')
        expect(defaultDisplayName(null)).toBe('')
    })
})

describe('competitionShareUrl', () => {
    it('links into the gym', () => {
        expect(competitionShareUrl('https://gripello.app', 'gym-a', 'c1')).toBe(
            'https://gripello.app/gym-a/competitions/c1',
        )
    })
})
