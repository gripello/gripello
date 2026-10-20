import { readFileSync } from 'node:fs'

describe.each([
    'app/components/notifications/Bell.vue',
    'app/components/account/PushSettings.vue',
])('%s push failures', (file) => {
    it('tells the user first and reports only where the browser can', () => {
        expect(readFileSync(file, 'utf8')).toMatch(
            /notifyError\(t\('notifications\.error\.edit'\)\)\s+globalThis\.reportError\?\.\(err\)/,
        )
    })
})
