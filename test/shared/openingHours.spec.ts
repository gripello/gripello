import { describe, expect, it } from 'vitest'
import fixtures from '../../pocketbase/testdata/openingHours.json'
import {
    hasOpeningHours,
    isValidOpeningHours,
    openStatus,
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
