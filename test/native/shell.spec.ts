import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(readFileSync('capacitor.config.json', 'utf8'))
const manifest = readFileSync(
    'mobile/android/app/src/main/AndroidManifest.xml',
    'utf8',
)
const assetLinks = JSON.parse(
    readFileSync('public/.well-known/assetlinks.json', 'utf8'),
)

describe('android app links', () => {
    it('verifies the host the app loads', () => {
        const host = new URL(config.server.url).host
        expect(manifest).toContain(
            `<data android:scheme="https" android:host="${host}" />`,
        )
    })

    it('never lets the App Link (debug) keys use passkeys', () => {
        // get_login_creds belongs in its own statement listing only the Play signing key.
        for (const statement of assetLinks)
            expect(
                statement.relation.includes(
                    'delegate_permission/common.get_login_creds',
                ) &&
                    statement.relation.includes(
                        'delegate_permission/common.handle_all_urls',
                    ),
            ).toBe(false)
    })

    it('trusts the app id the shell is built with', () => {
        expect(
            assetLinks.map(
                (link: { target: { package_name: string } }) =>
                    link.target.package_name,
            ),
        ).toContain(config.appId)
    })
})

describe('native layout', () => {
    it('keeps every page below the status bar without a marker or script', () => {
        const css = readFileSync('app/assets/css/main.css', 'utf8')
        expect(css).toMatch(
            /:root \{\s*--app-top-inset: env\(safe-area-inset-top, 0px\);\s*\}/,
        )
        expect(css).not.toContain('display-mode: standalone')
    })
})

describe('native offline page', () => {
    it('ships every file MainActivity reads for its offline page', () => {
        const activity = readFileSync(
            'mobile/android/app/src/main/java/app/gripello/MainActivity.java',
            'utf8',
        )
        const copied = JSON.parse(readFileSync('package.json', 'utf8')).scripts[
            'capacitor:copy:before'
        ]
        const read = [...activity.matchAll(/asset\("public\/([^"]+)"\)/g)].map(
            (match) => match[1],
        )
        expect(read).toEqual(['icon-192.png', 'offline.html'])
        for (const file of read) expect(copied).toContain(`public/${file}`)
        expect(readFileSync('public/offline.html', 'utf8')).toContain(
            'src="/icon-192.png"',
        )
    })
})
