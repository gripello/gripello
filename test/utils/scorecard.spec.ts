import { describe, expect, it } from 'vitest'
import {
    applyScoreAction,
    flagEntries,
    EMPTY_SCORE,
    isFlash,
    replaceEntryScores,
    scoreFromRecord,
    supersededUnsavedKeys,
    type ScoreAction,
} from '~/utils/scorecard'

const run = (actions: ScoreAction[], hasZone = true) =>
    actions.reduce(
        (score, action) => applyScoreAction(score, action, hasZone),
        EMPTY_SCORE,
    )

describe('scorecard', () => {
    it('counts a top straight away as a flash with zone', () => {
        const score = run([{ type: 'top' }])
        expect(score).toMatchObject({
            attempts: 1,
            topAttempt: 1,
            zoneAttempt: 1,
        })
        expect(isFlash(score)).toBe(true)
    })

    it('tops on the current attempt after failed tries', () => {
        const score = run([
            { type: 'attempt' },
            { type: 'zone' },
            { type: 'attempt' },
            { type: 'attempt' },
            { type: 'top' },
        ])
        expect(score).toMatchObject({
            attempts: 3,
            zoneAttempt: 1,
            topAttempt: 3,
        })
        expect(isFlash(score)).toBe(false)
    })

    it('stops counting attempts once topped', () => {
        expect(run([{ type: 'top' }, { type: 'attempt' }]).attempts).toBe(1)
    })

    it('never undoes attempts below a zone or top', () => {
        const score = run([
            { type: 'attempt' },
            { type: 'attempt' },
            { type: 'zone' },
            { type: 'undoAttempt' },
        ])
        expect(score.attempts).toBe(2)
        expect(
            run([{ type: 'attempt' }, { type: 'undoAttempt' }]).attempts,
        ).toBe(0)
    })

    it('removing a top also removes the zone it implied', () => {
        expect(run([{ type: 'top' }, { type: 'top' }])).toMatchObject({
            topAttempt: 0,
            zoneAttempt: 0,
            attempts: 1,
        })
        expect(
            run([
                { type: 'attempt' },
                { type: 'zone' },
                { type: 'attempt' },
                { type: 'top' },
                { type: 'top' },
            ]),
        ).toMatchObject({ topAttempt: 0, zoneAttempt: 1 })
    })

    it('ignores zones on routes without one', () => {
        expect(run([{ type: 'zone' }], false)).toEqual(EMPTY_SCORE)
        expect(run([{ type: 'top' }], false).zoneAttempt).toBe(0)
    })

    it('keeps the climbing style', () => {
        expect(
            run([{ type: 'style', style: 'toprope' }, { type: 'top' }], false)
                .style,
        ).toBe('toprope')
    })

    it('reads stored records', () => {
        expect(scoreFromRecord({ attempts: 2, top_attempt: 2 })).toEqual({
            attempts: 2,
            zoneAttempt: 0,
            topAttempt: 2,
            style: '',
        })
    })
})

describe('flagEntries', () => {
    const top = (entry: string, route: string, attempt = 1) => ({
        entry,
        comp_route: route,
        top_attempt: attempt,
    })

    it('flags climbers who flashed every top of many', () => {
        const scores = ['r1', 'r2', 'r3', 'r4', 'r5'].map((route) =>
            top('anna', route),
        )
        expect(flagEntries(scores, 2).get('anna')).toEqual(['allFlashes'])
        expect(
            flagEntries([...scores.slice(0, 4), top('anna', 'r5', 2)], 2).get(
                'anna',
            ),
        ).toBeUndefined()
    })

    it('flags a top nobody else managed once the field is big enough', () => {
        const scores = [top('anna', 'r1'), top('ben', 'r1'), top('ben', 'r2')]
        expect(flagEntries(scores, 5).get('ben')).toEqual(['uniqueTop'])
        expect(flagEntries(scores, 5).get('anna')).toBeUndefined()
        expect(flagEntries(scores, 3).size).toBe(0)
    })
})

describe('replaceEntryScores', () => {
    it('swaps the scores of changed entries only', () => {
        const scores = [
            { id: '1', entry: 'a' },
            { id: '2', entry: 'b' },
        ]
        expect(
            replaceEntryScores(scores, ['a'], [{ id: '3', entry: 'a' }]),
        ).toEqual([
            { id: '2', entry: 'b' },
            { id: '3', entry: 'a' },
        ])
    })
})

describe('supersededUnsavedKeys', () => {
    const score = (entry: string, updated: string) => ({
        entry,
        comp_route: 'r1',
        updated,
    })

    it('drops an unsaved score once the server has a newer one', () => {
        const unsaved = new Map([
            ['e1:r1', { base: '2026-01-01T10:00:00.000Z' }],
            ['e2:r1', { base: undefined }],
            ['e3:r1', { base: '2026-01-01T10:00:00.000Z' }],
        ])
        expect(
            supersededUnsavedKeys(unsaved, [
                score('e1', '2026-01-01T10:05:00.000Z'),
                score('e2', '2026-01-01T10:05:00.000Z'),
                score('e3', '2026-01-01T10:00:00.000Z'),
            ]),
        ).toEqual(['e1:r1', 'e2:r1'])
    })

    it('keeps an unsaved score while the server still has none', () => {
        expect(
            supersededUnsavedKeys(
                new Map([['e1:r1', { base: undefined }]]),
                [],
            ),
        ).toEqual([])
    })
})
