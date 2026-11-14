import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(
    path.resolve(
        import.meta.dirname,
        '../../app/components/admin/settings/BrandingSection.vue',
    ),
    'utf8',
)

describe('branding section', () => {
    it('draws the transparency checkerboard from theme tokens so it follows dark mode', () => {
        const style = source.slice(source.indexOf('<style'))
        expect(style).not.toMatch(/#[0-9a-f]{3,8}\b/i)
        expect(style).toContain('var(--ui-bg-accented) 25%')
    })
})
