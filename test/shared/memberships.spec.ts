import { describe, expect, it } from 'vitest'
import { activeMemberships } from '#shared/utils/memberships'

describe('activeMemberships', () => {
    it('keeps only memberships of active gyms', () => {
        const active = { expand: { gym: { active: true } } }
        expect(
            activeMemberships([
                active,
                { expand: { gym: { active: false } } },
                { expand: {} },
            ]),
        ).toEqual([active])
    })
})
