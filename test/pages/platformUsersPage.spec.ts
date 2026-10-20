import { readFileSync } from 'node:fs'

describe('platform users page', () => {
    it('keeps row actions at the right edge when a user has no badges', () => {
        const source = readFileSync('app/pages/platform/users.vue', 'utf8')
        expect(source).toMatch(
            /class="ml-auto flex shrink-0 justify-end gap-1 max-md:hidden"\s*>\s+<UButton\s+icon="i-lucide-pencil"/,
        )
    })
})
