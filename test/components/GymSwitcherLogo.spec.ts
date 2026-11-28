import { readFileSync } from 'node:fs'
import path from 'node:path'

const read = (file: string) =>
    readFileSync(path.resolve(import.meta.dirname, '../..', file), 'utf8')

describe('gym logos', () => {
    it('puts gym logos in the switcher menu on the logo chip', () => {
        expect(read('app/components/layout/GymSwitcher.vue')).toMatch(
            /avatar: \{\s+src: logo,[\s\S]+?image: 'logo-chip object-contain'/,
        )
    })

    it('shows logos as uploaded instead of flattening them with a filter', () => {
        const css = read('app/assets/css/main.css')
        expect(css).not.toContain('logo-mono')
        expect(css).toMatch(/\.logo-chip \{\s+@apply [^;]*bg-white/)
        for (const file of [
            'app/components/layout/BrandLogo.vue',
            'app/components/layout/GymSwitcher.vue',
            'app/components/gym/MapCard.vue',
            'app/components/platform/GymIdentity.vue',
            'app/pages/index.vue',
        ]) {
            const source = read(file)
            expect(source, file).toContain('logo-chip')
            expect(source, file).not.toMatch(/filter:/)
        }
    })
})
