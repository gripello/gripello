import { describe, expect, it } from 'vitest'
import { changedFields, setterNames } from '~/utils/routes'

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

describe('changedFields', () => {
    it('keeps only the fields that differ from the opened route', () => {
        const opened = {
            name: 'Crimp',
            grade: '6a',
            archived: false,
            creator: ['Ann'],
        }

        expect(
            changedFields({ ...opened, grade: '6b', creator: ['Ann'] }, opened),
        ).toEqual({ grade: '6b' })
        expect(
            changedFields({ ...opened, creator: ['Ann', 'Bo'] }, opened),
        ).toEqual({ creator: ['Ann', 'Bo'] })
        expect(changedFields(opened, opened)).toEqual({})
    })
})
