import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parentPath } from '~/utils/navigation'

const source = readFileSync(
    path.resolve(
        import.meta.dirname,
        '../../app/pages/privacy/account-deletion.vue',
    ),
    'utf8',
)
const en = JSON.parse(
    readFileSync(
        path.resolve(import.meta.dirname, '../../i18n/locales/en.json'),
        'utf8',
    ),
)

const listed = (name: string) =>
    [
        ...(
            source.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`))?.[1] ??
            ''
        ).matchAll(/'(\w+)'/g),
    ].map((match) => match[1]!)

describe('account deletion page', () => {
    it('sits below the privacy page and links to the delete button', () => {
        expect(parentPath('/privacy/account-deletion')).toBe('/privacy')
        expect(source).toContain('back-to="/privacy"')
        expect(source).toContain('to="/account/settings?tab=security"')
    })

    it('has a text for every step and every deleted or kept item', () => {
        const page = en.legal.accountDeletionPage
        expect(listed('STEPS').map((key) => page.steps[key])).not.toContain(
            undefined,
        )
        expect(listed('DELETED').map((key) => page.deleted[key])).not.toContain(
            undefined,
        )
        expect(listed('KEPT').map((key) => page.kept[key])).not.toContain(
            undefined,
        )
        expect(listed('KEPT')).toHaveLength(6)
        expect(listed('KEPT')).toContain('exports')
    })

    it('is linked from the privacy page', () => {
        expect(
            readFileSync(
                path.resolve(
                    import.meta.dirname,
                    '../../app/pages/privacy/index.vue',
                ),
                'utf8',
            ),
        ).toContain('to="/privacy/account-deletion"')
    })
})
