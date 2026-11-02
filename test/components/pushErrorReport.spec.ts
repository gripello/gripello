import { readFileSync } from 'node:fs'

describe.each([
    'app/components/notifications/Bell.vue',
    'app/components/account/PushSettings.vue',
])('%s push failures', (file) => {
    it('tells the user first, then reports the failure', () => {
        expect(readFileSync(file, 'utf8')).toMatch(
            /notifyError\(t\('notifications\.error\.edit'\)\)\s+reportCaughtError\(err\)/,
        )
    })
})
