import { readFileSync } from 'node:fs'

const trigger = readFileSync('app/components/layout/CommandPalette.vue', 'utf8')

describe('LayoutCommandPalette', () => {
    it('loads the palette dialog only once it is first opened', () => {
        expect(trigger).toMatch(
            /<LazyLayoutCommandPaletteDialog\s+v-if="loaded"\s+v-model:open="open"/,
        )
        expect(trigger).toMatch(
            /watch\(open, \(value\) => \{\s+if \(value\) loaded\.value = true/,
        )
        expect(trigger).not.toContain('UCommandPalette')
        expect(trigger).toContain('meta_k')
    })
})
