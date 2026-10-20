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
        expect(page('settings')).toMatch(/desktop-tabs/)
        const source = readFileSync(
            'app/components/settings/Layout.vue',
            'utf8',
        )
        expect(source).toMatch(/<LayoutTabs/)
        expect(source).not.toContain('scrollIntoView')
        expect(readFileSync('app/components/layout/Tabs.vue', 'utf8')).toMatch(
            /watch\(model, revealActiveTab\)/,
        )
    })

    it('lists gym members as actors only for those allowed to list them', () => {
        const source = page('activity')
        const members = source.slice(source.indexOf("'audit-members'"))
        expect(members).toMatch(
            /enabled: \(\) =>[\s\S]*can\('manage_users', memberGymId\.value\)/,
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

    it('shows the export state only once the client fetch settled', () => {
        const source = page('export/index')
        expect(source).toMatch(
            /fetchStatus\.value === 'idle' \|\| fetchStatus\.value === 'pending'/,
        )
        expect(source).toContain(':loading="loading"')
        expect(source).toContain('v-else-if="!loading"')
    })

    it('tells an expired export link apart from a failed check', () => {
        const source = page('export/[token]')
        expect(source).toMatch(
            /<LayoutLoadError v-if="error"[^>]*@retry="refresh\(\)"/,
        )
        expect(source).toContain(':loading="!error && available === null"')
    })
})
