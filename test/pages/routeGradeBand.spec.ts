import { readFileSync } from 'node:fs'

describe('route page grade band', () => {
    it('names the colour band for screen readers', () => {
        const source = readFileSync('app/pages/[gym]/route.vue', 'utf8')
        const band = source.slice(
            source.indexOf('class="route-hero__difficulty-band"'),
            source.indexOf('data-testid="route-grade-band"'),
        )
        expect(band).toContain('role="img"')
        expect(band).toMatch(/:aria-label="\s*bandName\(gymBand\)\s*"/)
    })
})

describe('route page grade conversion', () => {
    it('offers a labelled conversion link next to the grade badge', () => {
        const source = readFileSync('app/pages/[gym]/route.vue', 'utf8')
        expect(source).toMatch(
            /v-bind="activator"[\s\S]+?data-testid="route-grade-badge"[\s\S]+?v-bind="activator"[\s\S]+?data-testid="route-grade-conversion"[\s\S]+?t\('gradeConversion\.open'\)/,
        )
    })
})
