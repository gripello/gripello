import { readFileSync } from 'node:fs'

const PAGES = [
    'app/pages/index.vue',
    'app/pages/[gym]/index.vue',
    'app/pages/[gym]/routes.vue',
    'app/pages/[gym]/map.vue',
    'app/pages/[gym]/info.vue',
    'app/pages/[gym]/route.vue',
    'app/pages/[gym]/competitions/index.vue',
    'app/pages/[gym]/competitions/[id]/index.vue',
    'app/pages/[gym]/competitions/[id]/rules.vue',
    'app/pages/[gym]/leaderboard/index.vue',
    'app/pages/[gym]/imprint.vue',
    'app/pages/[gym]/privacy.vue',
    'app/pages/imprint.vue',
    'app/pages/privacy/index.vue',
    'app/pages/privacy/account-deletion.vue',
]

describe('meta descriptions', () => {
    it('gives every page a default description', () => {
        expect(readFileSync('app/app.vue', 'utf8')).toContain(
            "useSeoMeta({ description: () => t('seo.default') })",
        )
    })

    it.each(PAGES)('%s describes itself', (page) => {
        const seo = readFileSync(page, 'utf8').match(
            /useSeoMeta\(\{[\s\S]*?\n\}\)/g,
        )
        expect(seo?.some((call) => call.includes('description:'))).toBe(true)
    })

    it('falls back to a generated gym info description', () => {
        expect(readFileSync('app/pages/[gym]/info.vue', 'utf8')).toMatch(
            /gym\.value\?\.description\?\.trim\(\)\.slice\(0, 160\) \|\|\s+t\('seo\.info'/,
        )
    })
})
