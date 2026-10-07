import { describe, expect, it } from 'vitest'
import type { FollowRecord } from '~/types/models'
import { followState } from '~/utils/friends'

const follow = (
    follower: string,
    followee: string,
    status: FollowRecord['status'],
): FollowRecord => ({
    id: `${follower}-${followee}`,
    follower,
    followee,
    status,
})

describe('followState', () => {
    const follows = [
        follow('me', 'anna', 'accepted'),
        follow('me', 'ben', 'pending'),
        follow('carl', 'me', 'accepted'),
    ]

    it('tells how I relate to a climber', () => {
        expect(followState(follows, 'me', 'me')).toEqual({ kind: 'self' })
        expect(followState(follows, 'me', 'anna')).toEqual({
            kind: 'following',
            id: 'me-anna',
        })
        expect(followState(follows, 'me', 'ben')).toEqual({
            kind: 'requested',
            id: 'me-ben',
        })
        expect(followState(follows, 'me', 'carl')).toEqual({ kind: 'none' })
    })
})
