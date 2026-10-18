import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APP_SCHEME } from '~/utils/native'

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

    it('lets only the Play signing key use passkeys, which also opens App Links', () => {
        const fingerprints = (relation: string) =>
            assetLinks.find((statement: { relation: string[] }) =>
                statement.relation.includes(relation),
            ).target.sha256_cert_fingerprints
        const passkeyKeys = fingerprints(
            'delegate_permission/common.get_login_creds',
        )
        expect(passkeyKeys).toHaveLength(1)
        expect(
            fingerprints('delegate_permission/common.handle_all_urls'),
        ).toContain(passkeyKeys[0])
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
            /:root \{\s*--app-top-inset: calc\(\s*env\(safe-area-inset-top, 0px\) \+ var\(--app-window-controls, 0px\)\s*\);\s*\}/,
        )
        expect(css).not.toContain('display-mode: standalone')
    })

    it('feeds the iPad window controls into that inset', () => {
        // Only the iPad app sets the variable; without it the inset stays the status bar.
        expect(
            readFileSync('mobile/ios/App/App/MainViewController.swift', 'utf8'),
        ).toContain(':root { --app-window-controls: ')
    })
})

describe('native offline page', () => {
    it.each([
        'mobile/android/app/src/main/java/app/gripello/MainActivity.java',
        'mobile/ios/App/App/MainViewController.swift',
    ])('ships every file %s reads for its offline page', (shell) => {
        const copied = JSON.parse(readFileSync('package.json', 'utf8')).scripts[
            'capacitor:copy:before'
        ]
        const read = [
            ...readFileSync(shell, 'utf8').matchAll(
                /asset\("public\/([^"]+)"\)/g,
            ),
        ].map((match) => match[1])
        expect(read.sort()).toEqual(['icon-192.png', 'offline.html'])
        for (const file of read) expect(copied).toContain(`public/${file}`)
        expect(readFileSync('public/offline.html', 'utf8')).toContain(
            'src="/icon-192.png"',
        )
    })
})

describe('ios app links', () => {
    const ios = (file: string) => readFileSync(`mobile/ios/App/${file}`, 'utf8')
    const project = ios('App.xcodeproj/project.pbxproj')
    const association = JSON.parse(
        readFileSync('public/.well-known/apple-app-site-association', 'utf8'),
    )

    it('verifies the host the app loads for links and passkeys', () => {
        const host = new URL(config.server.url).host
        const entitlements = ios('App/App.entitlements')
        expect(entitlements).toContain(`<string>applinks:${host}</string>`)
        expect(entitlements).toContain(
            `<string>webcredentials:${host}</string>`,
        )
    })

    it('returns from the sign-in page through the scheme the backend redirects to', () => {
        expect(ios('App/Info.plist')).toMatch(
            new RegExp(
                `<key>CFBundleURLSchemes</key>\\s*<array>\\s*<string>${APP_SCHEME.slice(0, -1)}</string>`,
            ),
        )
    })

    it('trusts the app id and team the shell is signed with', () => {
        // TEAMID is a placeholder until the Apple developer team is set; both places change together.
        const teams = new Set(
            [...project.matchAll(/DEVELOPMENT_TEAM = (\w+);/g)].map(
                (match) => match[1],
            ),
        )
        const bundles = new Set(
            [...project.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([\w.]+);/g)].map(
                (match) => match[1],
            ),
        )
        expect([...bundles].sort()).toEqual([
            config.appId,
            `${config.appId}.widget`,
        ])
        expect(teams.size).toBe(1)
        const appId = `${[...teams][0]}.${config.appId}`
        expect(
            association.applinks.details.flatMap(
                (detail: { appIDs: string[] }) => detail.appIDs,
            ),
        ).toEqual([appId])
        expect(association.webcredentials.apps).toEqual([appId])
    })

    it('binds the loaded host so WKWebView runs the service worker there', () => {
        const host = new URL(config.server.url).host
        expect(ios('App/Info.plist')).toMatch(
            new RegExp(
                `<key>WKAppBoundDomains</key>\\s*<array>[^]*?<string>${host}</string>[^]*?</array>`,
            ),
        )
        // Capacitor's bridge needs the navigation limit once the plist names app-bound domains.
        expect(config.ios.limitsNavigationsToAppBoundDomains).toBe(true)
    })

    it('serves the association file as JSON although it has no extension', () => {
        expect(readFileSync('.docker/nginx.conf', 'utf8')).toMatch(
            /location = \/\.well-known\/apple-app-site-association \{\s*default_type application\/json;/,
        )
    })
})

describe('home-screen widget', () => {
    const read = (file: string) => readFileSync(file, 'utf8')
    const strings = (plist: string) =>
        [...plist.matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1])
    const group = (entitlements: string, key: string) =>
        strings(
            entitlements.match(
                new RegExp(`<key>${key}</key>\\s*<array>([^]*?)</array>`),
            )?.[1] ?? '',
        )

    it('uses one plugin name in the page, on iOS and on Android', () => {
        expect(read('app/utils/widget.ts')).toContain(
            "registerPlugin<WidgetPlugin>('GripelloWidget')",
        )
        expect(read('mobile/ios/App/App/GripelloWidgetPlugin.swift')).toContain(
            'public let jsName = "GripelloWidget"',
        )
        expect(
            read(
                'mobile/android/app/src/main/java/app/gripello/GripelloWidgetPlugin.java',
            ),
        ).toContain('@CapacitorPlugin(name = "GripelloWidget")')
        expect(read('mobile/ios/App/App/MainViewController.swift')).toContain(
            'registerPluginInstance(GripelloWidgetPlugin())',
        )
        expect(
            read(
                'mobile/android/app/src/main/java/app/gripello/MainActivity.java',
            ),
        ).toContain('registerPlugin(GripelloWidgetPlugin.class)')
    })

    it('shares the session store between the iOS app and its widget', () => {
        const app = read('mobile/ios/App/App/App.entitlements')
        const widget = read(
            'mobile/ios/App/GripelloWidget/GripelloWidget.entitlements',
        )
        const store = read('mobile/ios/App/GripelloWidget/WidgetStore.swift')
        for (const key of [
            'com.apple.security.application-groups',
            'keychain-access-groups',
        ]) {
            expect(group(app, key)).toHaveLength(1)
            expect(group(widget, key)).toEqual(group(app, key))
        }
        expect(store).toContain(
            `appGroup = "${group(app, 'com.apple.security.application-groups')[0]}"`,
        )
        // WidgetStore reads the keychain group from Info.plist, where Xcode fills in the team prefix.
        const keychain = group(app, 'keychain-access-groups')[0]
        for (const plist of [
            'mobile/ios/App/App/Info.plist',
            'mobile/ios/App/GripelloWidget/Info.plist',
        ])
            expect(read(plist)).toMatch(
                new RegExp(
                    `<key>GripelloKeychainGroup</key>\\s*<string>${keychain!.replace(/[$()]/g, '\\$&')}</string>`,
                ),
            )
    })

    it('keeps the widget session out of backups and device transfers', () => {
        const res = 'mobile/android/app/src/main/res/xml'
        expect(manifest).toContain(
            'android:dataExtractionRules="@xml/data_extraction_rules"',
        )
        expect(manifest).toContain(
            'android:fullBackupContent="@xml/backup_rules"',
        )
        const excluded = (file: string) =>
            [
                ...read(`${res}/${file}`).matchAll(
                    /<exclude domain="sharedpref" path="([^"]+)"/g,
                ),
            ].map((m) => m[1])
        const prefs = read(
            'mobile/android/app/src/main/java/app/gripello/widget/WidgetStore.java',
        ).match(/PREFS = "([^"]+)"/)?.[1]
        expect(excluded('backup_rules.xml')).toEqual([`${prefs}.xml`])
        expect(excluded('data_extraction_rules.xml')).toEqual([
            `${prefs}.xml`,
            `${prefs}.xml`,
        ])
        expect(
            read('mobile/ios/App/GripelloWidget/WidgetStore.swift'),
        ).toContain('kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly')
    })

    it('takes the hardest send from one grade system on both widgets', () => {
        expect(
            read(
                'mobile/android/app/src/main/java/app/gripello/widget/WidgetData.java',
            ),
        ).toContain('optString("grade_system").equals(system)')
        expect(read('mobile/ios/App/GripelloWidget/WidgetAPI.swift')).toContain(
            'sends.filter { $0.grade_system == system }',
        )
    })

    it('embeds the widget extension under the app id', () => {
        const project = read('mobile/ios/App/App.xcodeproj/project.pbxproj')
        expect(project).toContain(
            `PRODUCT_BUNDLE_IDENTIFIER = ${config.appId}.widget;`,
        )
        expect(project).toContain(
            'GripelloWidget.appex in Embed Foundation Extensions',
        )
    })

    it('registers the Android widget with its picker and every translation', () => {
        expect(manifest).toContain('android:name=".widget.ClimbingWidget"')
        expect(manifest).toContain(
            'android:resource="@xml/climbing_widget_info"',
        )
        expect(manifest).toContain(
            'android:name=".widget.WidgetConfigureActivity"',
        )
        // The widget loads in a job; only the system may bind it.
        expect(manifest).toMatch(
            /android:name="\.widget\.WidgetUpdateJob"[^>]*android:permission="android\.permission\.BIND_JOB_SERVICE"/,
        )
        const res = 'mobile/android/app/src/main/res'
        expect(read(`${res}/xml/climbing_widget_info.xml`)).toContain(
            'android:configure="app.gripello.widget.WidgetConfigureActivity"',
        )
        const names = (file: string) =>
            [...read(file).matchAll(/name="(widget_\w+)"/g)]
                .map((m) => m[1])
                .sort()
        const base = names(`${res}/values/widget_strings.xml`)
        for (const locale of ['de', 'nl', 'fr', 'es'])
            expect(names(`${res}/values-${locale}/widget_strings.xml`)).toEqual(
                base,
            )
    })
})
