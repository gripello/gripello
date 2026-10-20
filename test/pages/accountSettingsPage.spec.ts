import { readFileSync } from 'node:fs'

const source = readFileSync('app/pages/account/settings.vue', 'utf8')

describe('account settings page', () => {
    it('uses the settings layout with drill-down on phones and tabs on desktop', () => {
        expect(source).toMatch(/<SettingsLayout[\s\S]*query-key="tab"/)
        expect(source).toMatch(
            /<SettingsLayout[\s\S]*drill-down\s+desktop-tabs/,
        )
        expect(source).toMatch(/test-id-prefix="profile"/)
        expect(source).toMatch(/:unsaved-changes="hasChanges"/)
    })
})
