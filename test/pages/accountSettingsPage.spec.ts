import { readFileSync } from 'node:fs'

const source = readFileSync('app/pages/account/settings.vue', 'utf8')

describe('account settings page', () => {
    it('opens as a list of sections on phones and keeps tabs on desktop', () => {
        expect(source).toMatch(
            /<LayoutListGroup\s+v-if="!tabChosen"\s+class="mb-4 lg:hidden"/,
        )
        expect(source).toMatch(/data-testid="profile-drill-back"/)
        expect(source).toMatch(/ref="tabNav" class="mb-4 max-lg:hidden"/)
        expect(source).toMatch(/:class="\{ 'max-lg:hidden': !tabChosen \}"/)
    })
})
