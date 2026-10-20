import { describe, expect, it } from 'vitest'
import { issueTitle } from '~/utils/serverHealth'

describe('issueTitle', () => {
    it('joins message, route and error, skipping missing parts', () => {
        expect(
            issueTitle({
                message: 'request failed',
                sample: { route: 'GET /api/routes/{id}', error: 'boom' },
            }),
        ).toBe('request failed · GET /api/routes/{id} · boom')
        expect(issueTitle({ message: 'slow query' })).toBe('slow query')
    })
})
