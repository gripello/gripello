import { readFileSync } from 'node:fs'

const source = readFileSync('app/components/RouteFormDialog.vue', 'utf8')

describe('RouteFormDialog colour swatches', () => {
    it('names each swatch by colour, not only by hex', () => {
        expect(source).toContain(':aria-label="swatchLabel(c)"')
        expect(source).toContain('translatedColorName(t, color), color')
    })

    it('grows swatches to a 44px touch target on coarse pointers', () => {
        expect(source).toMatch(
            /@media \(pointer: coarse\) \{\s*\.color-swatch \{\s*width: 44px;\s*height: 44px;/,
        )
    })
})
