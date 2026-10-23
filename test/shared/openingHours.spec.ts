import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fixtures from '../../backend/testdata/openingHours.json'
import {
    formatIntervals,
    hasOpeningHours,
    isValidOpeningHours,
    nextOpeningInterval,
    openStatus,
    weekTimeline,
    toSchemaOrgHours,
    type GymOpeningHours,
} from '#shared/utils/openingHours'

const hours: GymOpeningHours = {
    mon: [['07:00', '23:00']],
    fri: [
        ['10:00', '14:00'],
        ['16:00', '01:30'],
    ],
    holiday: [['09:00', '22:00']],
}
// 2026-10-05 is a Monday.
const at = (day: number, time: string) =>
    new Date(`2026-10-${String(day).padStart(2, '0')}T${time}:00`)

describe('openingHours', () => {
    it.each(fixtures.valid)('accepts %j', (value) => {
        expect(isValidOpeningHours(value)).toBe(true)
    })

    it.each(fixtures.invalid)('rejects %j', (value) => {
        expect(isValidOpeningHours(value)).toBe(false)
    })

    it('is open within an interval', () => {
        expect(openStatus(hours, at(5, '12:00'))).toEqual({
            open: true,
            until: '23:00',
        })
    })

    it('opens later the same day between intervals', () => {
        expect(openStatus(hours, at(9, '15:00'))).toEqual({
            open: false,
            opensAt: '16:00',
        })
    })

    it('stays open past midnight into the next day', () => {
        expect(openStatus(hours, at(9, '23:30'))).toEqual({
            open: true,
            until: '01:30',
        })
        expect(openStatus(hours, at(10, '01:00'))).toEqual({
            open: true,
            until: '01:30',
        })
    })

    it('names the next opening day when closed today', () => {
        expect(openStatus(hours, at(6, '08:00'))).toEqual({
            open: false,
            opensAt: '10:00',
            opensOn: 'fri',
        })
    })

    it('ignores the holiday row for the current status', () => {
        expect(
            openStatus({ holiday: [['09:00', '22:00']] }, at(5, '12:00')),
        ).toEqual({
            open: false,
        })
    })

    it('detects whether any hours are set', () => {
        expect(hasOpeningHours(null)).toBe(false)
        expect(hasOpeningHours({ mon: [] })).toBe(false)
        expect(hasOpeningHours({ holiday: [['09:00', '22:00']] })).toBe(true)
    })

    it('exports weekdays as schema.org specifications', () => {
        expect(toSchemaOrgHours(hours)).toEqual([
            {
                '@type': 'OpeningHoursSpecification',
                dayOfWeek: 'Monday',
                opens: '07:00',
                closes: '23:00',
            },
            {
                '@type': 'OpeningHoursSpecification',
                dayOfWeek: 'Friday',
                opens: '10:00',
                closes: '14:00',
            },
            {
                '@type': 'OpeningHoursSpecification',
                dayOfWeek: 'Friday',
                opens: '16:00',
                closes: '01:30',
            },
        ])
    })
})

describe('openStatus around midnight and clock changes in Europe/Berlin', () => {
    const originalTimeZone = process.env.TZ
    beforeEach(() => {
        process.env.TZ = 'Europe/Berlin'
    })
    afterEach(() => {
        process.env.TZ = originalTimeZone
    })
    const lateSunday: GymOpeningHours = { sun: [['22:00', '02:00']] }
    const lateSaturday: GymOpeningHours = { sat: [['22:00', '02:00']] }

    it('keeps a Sunday night open into Monday', () => {
        expect(openStatus(lateSunday, new Date('2026-10-19T01:00:00'))).toEqual(
            { open: true, until: '02:00' },
        )
        expect(openStatus(lateSunday, new Date('2026-10-19T02:00:00'))).toEqual(
            { open: false, opensAt: '22:00', opensOn: 'sun' },
        )
    })

    it('closes on the wall clock when summer time starts', () => {
        expect(
            openStatus(lateSaturday, new Date('2026-03-29T01:30:00')),
        ).toEqual({ open: true, until: '02:00' })
        expect(
            openStatus(lateSaturday, new Date('2026-03-29T03:00:00')),
        ).toEqual({ open: false, opensAt: '22:00', opensOn: 'sat' })
    })

    it('closes on the wall clock when summer time ends', () => {
        const firstOneThirty = new Date('2026-10-25T01:30:00+02:00')
        const repeatedTwoThirty = new Date('2026-10-25T02:30:00+01:00')
        expect(openStatus(lateSaturday, firstOneThirty)).toEqual({
            open: true,
            until: '02:00',
        })
        expect(openStatus(lateSaturday, repeatedTwoThirty)).toEqual({
            open: false,
            opensAt: '22:00',
            opensOn: 'sat',
        })
    })
})

describe('formatIntervals', () => {
    it('joins a midday break into one line', () => {
        expect(
            formatIntervals([
                ['10:00', '13:00'],
                ['15:00', '22:00'],
            ]),
        ).toBe('10:00–13:00, 15:00–22:00')
    })
})

describe('weekTimeline', () => {
    it('carries a late night into the next morning, Sunday into Monday', () => {
        const days = weekTimeline({
            fri: [['20:00', '02:00']],
            sun: [['18:00', '03:00']],
        })
        expect(days.find((d) => d.day === 'fri')!.segments).toEqual([
            { from: 20 / 24, to: 1 },
        ])
        expect(days.find((d) => d.day === 'sat')!.segments).toEqual([
            { from: 0, to: 2 / 24 },
        ])
        expect(days.find((d) => d.day === 'sat')!.intervals).toEqual([])
        expect(days.find((d) => d.day === 'mon')!.segments).toEqual([
            { from: 0, to: 3 / 24 },
        ])
    })

    it('places every weekday on a 0–24 axis with a gap for a midday break', () => {
        const days = weekTimeline({
            sat: [
                ['06:00', '12:00'],
                ['18:00', '01:00'],
            ],
        })
        expect(days).toHaveLength(7)
        expect(days.find((d) => d.day === 'mon')!.segments).toEqual([])
        expect(days.find((d) => d.day === 'sat')!.segments).toEqual([
            { from: 0.25, to: 0.5 },
            { from: 0.75, to: 1 },
        ])
    })
})

describe('nextOpeningInterval', () => {
    it('adds a valid hour after the last interval, wrapping past midnight', () => {
        expect(nextOpeningInterval([])).toEqual(['09:00', '22:00'])
        expect(nextOpeningInterval([['09:00', '22:00']])).toEqual([
            '22:00',
            '23:00',
        ])
        expect(nextOpeningInterval([['18:00', '23:30']])).toEqual([
            '23:30',
            '00:30',
        ])
        for (const intervals of [[], [['09:00', '22:00']]] as const)
            expect(
                isValidOpeningHours({
                    mon: [...intervals, nextOpeningInterval([...intervals])],
                }),
            ).toBe(true)
    })
})
