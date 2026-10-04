import { readFileSync } from 'node:fs'
import path from 'node:path'

const page = (name: string) =>
    readFileSync(
        path.resolve(__dirname, `../../app/pages/account/${name}.vue`),
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

    it('scrolls the settings tabs sideways instead of truncating them', () => {
        const source = page('settings')
        expect(source).toMatch(/class="account-tabs"/)
        expect(source).toMatch(/w-max min-w-full/)
        expect(source).toMatch(/\.account-tabs \{[^}]*overflow-x: auto/)
        expect(source).toMatch(
            /scrollIntoView\(\{ block: 'nearest', inline: 'center' \}\)/,
        )
    })
})
