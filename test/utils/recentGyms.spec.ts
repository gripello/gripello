import { describe, expect, it } from 'vitest'
import { parseRecentGyms, withRecentGym } from '~/utils/recentGyms'

describe('recent gyms', () => {
    it('moves the visited gym to the front without duplicates', () => {
        expect(withRecentGym(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    })

    it('keeps the five most recent', () => {
        expect(withRecentGym(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual([
            'f',
            'a',
            'b',
            'c',
            'd',
        ])
    })

    it('ignores broken storage values', () => {
        expect(parseRecentGyms(null)).toEqual([])
        expect(parseRecentGyms('{')).toEqual([])
        expect(parseRecentGyms('{"a":1}')).toEqual([])
        expect(parseRecentGyms('["a",2]')).toEqual(['a'])
    })
})
