import { readFileSync } from 'node:fs'

describe('app shell', () => {
    it('announces route changes to screen readers', () => {
        expect(readFileSync('app/app.vue', 'utf8')).toContain(
            '<NuxtRouteAnnouncer />',
        )
    })
})
