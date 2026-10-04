import { describe, expect, it } from 'vitest'
import { realtimeCommentPlacement } from '~/utils/comments'

describe('realtimeCommentPlacement', () => {
    it('prepends under newest', () => {
        expect(realtimeCommentPlacement('newest', false, true)).toBe('prepend')
    })

    it('appends under oldest once the list is complete', () => {
        expect(realtimeCommentPlacement('oldest', false, false)).toBe('append')
        expect(realtimeCommentPlacement('oldest', false, true)).toBe('refetch')
    })

    it('refetches under a non-date sort', () => {
        expect(realtimeCommentPlacement('highest', false, false)).toBe(
            'refetch',
        )
    })

    it('refetches when a racing refetch already listed the comment', () => {
        expect(realtimeCommentPlacement('newest', true, false)).toBe('refetch')
        expect(realtimeCommentPlacement('highest', true, false)).toBe('refetch')
    })
})
