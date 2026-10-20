import { translatedItems } from '~/utils/translatedItems'

describe('translatedItems', () => {
    it('labels each value with its key under the prefix', () => {
        expect(
            translatedItems(['a', 'b'] as const, 'x.y', (key) => `<${key}>`),
        ).toEqual([
            { value: 'a', label: '<x.y.a>' },
            { value: 'b', label: '<x.y.b>' },
        ])
    })
})
