import { describe, expect, it } from 'vitest'
import { setterNames } from '~/utils/routes'

describe('setterNames', () => {
    it('lists each setter once, newest routes first', () => {
        expect(
            setterNames([
                { creator: ['Mia', 'Ben'] },
                { creator: 'Ben' },
                { creator: [] },
                { creator: ['Lou'] },
            ]),
        ).toEqual(['Mia', 'Ben', 'Lou'])
    })
})
