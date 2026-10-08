import { readFileSync } from 'node:fs'
import path from 'node:path'

const page = (name: string) =>
    readFileSync(
        path.resolve(
            import.meta.dirname,
            `../../app/pages/account/${name}.vue`,
        ),
        'utf8',
    )

describe('account pages', () => {
    it.each(['settings', 'activity'])(
        '%s has no explanatory subtitles',
        (name) => {
            const source = page(name)
            expect(source).not.toMatch(/:subtitle=/)
            expect(source).not.toMatch(
                /accountSettings\.\w+Description'\)"\s*variant="naked"/,
            )
        },
    )

    it('keeps settings fields free of usage hints', () => {
        const source = page('settings')
        for (const key of [
            'accountSettings.emailDescription',
            'accountSettings.languageDescription',
            'accountSettings.themeDescription',
            'accountSettings.notificationsDescription',
            'account.passwordHint',
        ])
            expect(source).not.toContain(key)
    })

    it('uses the shared section tabs and keeps the active one in view', () => {
        const source = page('settings')
        expect(source).toMatch(/<LayoutTabs/)
        expect(source).not.toMatch(/UNavigationMenu/)
        expect(source).toMatch(
            /scrollIntoView\(\{ block: 'nearest', inline: 'center' \}\)/,
        )
    })

    it('lists activity entries as rows without leading separators', () => {
        const source = page('activity')
        expect(source).toMatch(/class="mx-auto w-full p-4"/)
        expect(source).toMatch(/<LayoutListGroup[\s\S]*<AuditCard/)
        const card = readFileSync(
            path.resolve(
                import.meta.dirname,
                '../../app/components/audit/Card.vue',
            ),
            'utf8',
        )
        const meta = card.slice(
            card.indexOf('audit-card__meta'),
            card.indexOf('</template>'),
        )
        expect(meta).not.toContain('audit-card__dot')
    })
})
