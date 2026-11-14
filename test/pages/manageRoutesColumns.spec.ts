import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(
    path.resolve(
        import.meta.dirname,
        '../../app/pages/[gym]/manage/routes.vue',
    ),
    'utf8',
)

describe('manage routes table', () => {
    it('keeps comment and location for the widest screens so the actions fit beside the sidebar', () => {
        expect(source).toContain(
            "class: { th: 'hidden 2xl:table-cell', td: 'hidden 2xl:table-cell' }",
        )
        expect(source).toMatch(
            /id: 'comment', header: t\('climbing\.comment'\), meta: widestOnly/,
        )
        expect(source).toMatch(
            /header: sortableHeader\(t\('climbing\.location'\), 'location'\),\s+meta: widestOnly,/,
        )
    })
})
