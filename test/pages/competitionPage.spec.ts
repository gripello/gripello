import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(
    path.resolve(
        import.meta.dirname,
        '../../app/pages/[gym]/competitions/[id]/index.vue',
    ),
    'utf8',
)

describe('competition page', () => {
    it('renders the not-found page for an unknown competition', () => {
        const afterLoad = source.slice(
            source.indexOf('await useCompetitionRecord('),
        )
        expect(afterLoad).toMatch(
            /\}\)\s+if \(isNotFound\(error\.value\)\) throw createError\(\{ status: 404, fatal: true \}\)/,
        )
    })
})
