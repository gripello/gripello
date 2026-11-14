import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(
    path.resolve(
        import.meta.dirname,
        '../../app/components/admin/settings/BrandingSection.vue',
    ),
    'utf8',
)

describe('branding uploads', () => {
    it('offers one upload control per empty image, the drop zone itself', () => {
        const template = source.slice(0, source.indexOf('<script'))
        expect(
            template.match(/\{\{ \$t\('settings\.clickToUpload'\) \}\}/g),
        ).toHaveLength(1)
    })
})
