import { readFileSync } from 'node:fs'

describe('platform gyms page', () => {
    it('keeps New gym in the page header instead of floating it on phones', () => {
        const source = readFileSync('app/pages/platform/gyms/index.vue', 'utf8')
        expect(source).not.toMatch(/max-lg:fixed/)
        expect(source).toMatch(/<LayoutPageHeader[^>]*inline-actions/)
        expect(source).toMatch(
            /<template #actions>\s+<UButton[\s\S]+?data-testid="platform-gym-create"/,
        )
    })
})
