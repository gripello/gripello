import { describe, expect, it } from 'vitest'
import { timelineDays, type Contribution } from '~/utils/timeline'

const route = (gym: string) => ({
    id: 'r1',
    name: 'Crimp',
    color: '#f00',
    grade: '6a',
    gym,
})
const tick = {
    id: 't1',
    date: '2026-10-03 12:00:00.000Z',
    created: '2026-10-03 18:00:00.000Z',
    type: 'flash' as const,
    route: 'r1',
    expand: { route: { name: 'Crimp', gym: 'g1' } },
}
const review: Contribution = {
    id: 'v1',
    created: '2026-10-03T19:00:00.000Z',
    rating: 4,
    comment: 'Nice',
    route: route('g1'),
}
const beta: Contribution = {
    id: 'b1',
    created: '2026-10-01T10:00:00.000Z',
    url: 'https://youtube.com/shorts/1',
    route: route('g2'),
}

describe('timelineDays', () => {
    it('merges sends, reviews and betas per day, newest first', () => {
        const days = timelineDays([tick], [review], [beta], 'all')
        expect(days.map((day) => day.day)).toEqual(['2026-10-03', '2026-10-01'])
        expect(days[0]!.entries.map((entry) => entry.kind)).toEqual([
            'review',
            'send',
        ])
        expect(days[0]!.entries[1]).toMatchObject({
            routeName: 'Crimp',
            tickType: 'flash',
        })
    })

    it('filters by kind and gym', () => {
        expect(
            timelineDays([tick], [review], [beta], 'beta').flatMap((day) =>
                day.entries.map((entry) => entry.id),
            ),
        ).toEqual(['b1'])
        expect(
            timelineDays([tick], [review], [beta], 'all', 'g1').flatMap((day) =>
                day.entries.map((entry) => entry.id),
            ),
        ).toEqual(['v1', 't1'])
    })

    it('groups PocketBase timestamps with a space separator', () => {
        const days = timelineDays(
            [],
            [{ ...review, created: '2026-10-03 19:00:00.000Z' }],
            [],
            'all',
        )
        expect(days).toHaveLength(1)
        expect(days[0]!.day).toMatch(/^2026-10-0[34]$/)
    })

    it('keeps attempts out of sends', () => {
        const attempt = { ...tick, id: 'a1', type: 'attempt' as const }
        expect(
            timelineDays([tick, attempt], [], [], 'send').flatMap((day) =>
                day.entries.map((entry) => entry.id),
            ),
        ).toEqual(['t1'])
        expect(
            timelineDays([attempt], [], [], 'all')[0]!.entries[0]!.kind,
        ).toBe('attempt')
    })

    it('dates backdated sends by their tick date', () => {
        const backdated = { ...tick, created: '2026-10-05 08:00:00.000Z' }
        expect(
            timelineDays([backdated], [], [], 'all')[0]!.entries[0],
        ).toMatchObject({
            at: backdated.date,
        })
    })

    it('keeps sends on deleted routes without a route id', () => {
        const orphan = { ...tick, route: null, expand: {}, route_name: 'Gone' }
        expect(
            timelineDays([orphan], [], [], 'all')[0]!.entries[0],
        ).toMatchObject({
            routeId: '',
            routeName: 'Gone',
        })
    })
})
