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

    it('explains a profile frozen by moderation instead of a generic error', () => {
        expect(source).toMatch(
            /fieldErrorCode\(err, 'profile'\) === 'moderation_hidden'\) \{\s+notifyError\(t\('account.profileHidden'\)\)/,
        )
    })

    it('explains a lockout and the last-admin refusal instead of a generic error', () => {
        expect(source.match(/throttledErrorKey\(err\)\)/g)).toHaveLength(2)
        expect(source).toMatch(
            /fieldErrorCode\(err, 'gym'\) === 'validation_last_admin'\) \{\s+notifyError\(t\('account.lastAdmin'\)\)/,
        )
    })
})
