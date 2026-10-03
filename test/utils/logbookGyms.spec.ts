import { describe, expect, it } from 'vitest'
import type { TickRecord } from '~/types/models'
import { ALL_GYMS, gymsInTicks, ticksInGym } from '~/utils/logbookGyms'

const tickAt = (id: string, gym?: { id: string; name: string }) =>
    ({
        id,
        expand: gym
            ? { route: { id: `r-${id}`, gym: gym.id, expand: { gym } } }
            : {},
    }) as unknown as TickRecord

const north = { id: 'g1', name: 'North' }
const alpha = { id: 'g2', name: 'Alpha' }
const ticks = [
    tickAt('a', north),
    tickAt('b', alpha),
    tickAt('c', north),
    tickAt('d'),
]

describe('logbook gyms', () => {
    it('lists each gym of the ticked routes once, by name', () => {
        expect(gymsInTicks(ticks)).toEqual([alpha, north])
    })

    it('filters ticks to one gym or keeps all', () => {
        expect(ticksInGym(ticks, 'g1').map((tick) => tick.id)).toEqual([
            'a',
            'c',
        ])
        expect(ticksInGym(ticks, ALL_GYMS)).toHaveLength(4)
    })
})
