import { readFileSync } from 'node:fs'
import { robotsAllows } from '#shared/utils/robots'
import { skipHeavyPrefetches } from '#shared/utils/lazyChunks'

const robots = readFileSync('public/robots.txt', 'utf8')

const PUBLIC = [
    '/',
    '/e2e',
    '/e2e/routes',
    '/e2e/route?id=abc',
    '/route?id=abc',
    '/e2e/map',
    '/e2e/info',
    '/e2e/feed',
    '/e2e/competitions',
    '/e2e/competitions/abc',
    '/e2e/competitions/abc/rules',
    '/e2e/leaderboard',
    '/e2e/imprint',
    '/e2e/privacy',
    '/imprint',
    '/privacy',
    '/privacy/account-deletion',
    '/accounting-climbing',
    '/climbers-hall',
    '/scanner-gym/routes',
    '/platformers',
    '/tvgym',
    '/e2e/tvx',
]

const PRIVATE = [
    '/api/gyms',
    '/auth/login',
    '/account',
    '/account/settings',
    '/platform',
    '/platform/users',
    '/logbook',
    '/logbook?kind=route',
    '/friends',
    '/climber?id=abc',
    '/scan',
    '/e2e/manage',
    '/e2e/manage/routes',
    '/e2e/admin/settings',
    '/e2e/tv',
    '/e2e/tv?screen=main',
    '/e2e/leaderboard/tv',
    '/e2e/competitions/abc/tv',
]

describe('robots.txt', () => {
    it.each(PUBLIC)('lets crawlers index %s', (path) => {
        expect(robotsAllows(robots, path)).toBe(true)
    })

    it.each(PRIVATE)('keeps crawlers out of %s', (path) => {
        expect(robotsAllows(robots, path)).toBe(false)
    })

    it('lets the longer Allow win over a shorter Disallow', () => {
        const txt = 'User-agent: *\nDisallow: /a\nAllow: /a/b'
        expect(robotsAllows(txt, '/a/b/c')).toBe(true)
        expect(robotsAllows(txt, '/a/c')).toBe(false)
    })

    it('marks every page robots.txt blocks as noindex', () => {
        const app = readFileSync('app/app.vue', 'utf8')
        expect(app).toContain(
            "import robotsTxt from '~~/public/robots.txt?raw'",
        )
        expect(app).toMatch(
            /robotsAllows\(robotsTxt, route\.fullPath\)\s+\? \[\]\s+: \[\{ name: 'robots', content: 'noindex' \}\]/,
        )
    })
})

describe('skipHeavyPrefetches', () => {
    it('drops heavy lazy libraries from the prefetch hints and keeps page chunks', () => {
        const manifest = {
            'pages/routes.vue': {
                dynamicImports: [
                    'node_modules/@cj-tech-master/excelts/dist/browser/index.browser.js',
                    'node_modules/maplibre-gl/dist/maplibre-gl.mjs',
                    'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs?url',
                    'node_modules/pako/dist/browser/pako_inflate.umd.min.js?url',
                    'node_modules/@cap.js/wasm/browser/cap_wasm_bg.wasm?url',
                    'node_modules/cap-widget/cap.min.js',
                    'utils/echartsCore.ts',
                    'components/settings/PrivacyEditor.vue',
                    'components/route/FormDialog.vue',
                ],
            },
            'entry.js': {},
        }
        skipHeavyPrefetches(manifest)
        expect(manifest['pages/routes.vue'].dynamicImports).toEqual([
            'components/route/FormDialog.vue',
        ])
    })

    it('runs on the client build manifest', () => {
        expect(readFileSync('nuxt.config.ts', 'utf8')).toContain(
            "'build:manifest': skipHeavyPrefetches",
        )
    })
})
