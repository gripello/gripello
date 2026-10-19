import { readFileSync } from 'node:fs'

describe('route page grade band', () => {
    it('names the colour band for screen readers', () => {
        const source = readFileSync('app/pages/[gym]/route.vue', 'utf8')
        const band = source.slice(
            source.indexOf('class="route-hero__difficulty-band"'),
            source.indexOf('data-testid="route-grade-band"'),
        )
        expect(band).toContain('role="img"')
        expect(band).toContain(':aria-label="bandName(gymBand)"')
    })
})
