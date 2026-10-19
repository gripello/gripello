import { readFileSync } from 'node:fs'

describe('placement page route drag', () => {
    it('claims touchmove in the capture phase so pull-to-refresh sees it prevented', () => {
        const source = readFileSync('app/pages/[gym]/manage/map.vue', 'utf8')
        expect(source).toMatch(
            /addEventListener\('touchmove', preventScroll, \{\s*passive: false,\s*capture: true,/,
        )
        expect(source).toMatch(
            /removeEventListener\('touchmove', preventScroll, \{\s*capture: true,?\s*\}\)/,
        )
    })
})
