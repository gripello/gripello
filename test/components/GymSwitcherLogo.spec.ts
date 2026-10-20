import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('GymSwitcher menu logos', () => {
    it('tints gym logos in the menu like the switcher itself', () => {
        const source = readFileSync(
            path.resolve(
                import.meta.dirname,
                '../../app/components/layout/GymSwitcher.vue',
            ),
            'utf8',
        )
        expect(source).toMatch(
            /avatar: \{\s+src: logo,[\s\S]+?image: 'logo-mono object-contain'/,
        )
    })
})
