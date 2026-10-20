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
                    /<exclude domain="(\w+)" path="([^"]+)"/g,
                ),
            ].map((m) => `${m[1]}:${m[2]}`)
        const prefs = read(
            'mobile/android/app/src/main/java/app/gripello/widget/WidgetStore.java',
        ).match(/PREFS = "([^"]+)"/)?.[1]
        // app_webview/ holds the gripello_auth cookie.
        const local = [`sharedpref:${prefs}.xml`, 'root:app_webview/']
        expect(excluded('backup_rules.xml')).toEqual(local)
        expect(excluded('data_extraction_rules.xml')).toEqual([
            ...local,
            ...local,
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

    it('breaks a tie between grade systems by the most recent send on both widgets', () => {
        expect(
            read(
                'mobile/android/app/src/main/java/app/gripello/widget/WidgetData.java',
            ),
        ).toContain('Map<String, Integer> systems = new LinkedHashMap<>();')
        expect(read('mobile/ios/App/GripelloWidget/WidgetAPI.swift')).toContain(
            'sends.first { counts[$0.grade_system] == top }',
        )
    })

    it('keeps a late load from writing over a sign-out or a newer session', () => {
        const data = read(
            'mobile/android/app/src/main/java/app/gripello/widget/WidgetData.java',
        )
        expect(data).toContain('WidgetStore.replaceSessionIf(')
        expect(data).toContain('WidgetStore.saveSnapshotIf(')
        expect(data).not.toContain('WidgetStore.saveSnapshot(')
        const api = read('mobile/ios/App/GripelloWidget/WidgetAPI.swift')
        expect(api).toContain('WidgetStore.replaceSession(ifToken:')
        expect(api).toContain('WidgetStore.saveSnapshot(')
        expect(api).not.toContain('WidgetStore.saveSession(')
        expect(api).not.toContain('WidgetStore.shared.set(')
        // An expired token signs the widget out but keeps each widget's gym for the same climber.
        const store = read(
            'mobile/android/app/src/main/java/app/gripello/widget/WidgetStore.java',
        )
        const clearIf = store.slice(
            store.indexOf('void clearSessionIf('),
            store.indexOf('private static void drop('),
        )
        expect(clearIf).toContain('drop(context, editor, false)')
        expect(clearIf).not.toContain('clearSession(context)')
    })

    it("drops the previous climber's widget data when another one signs in on iOS", () => {
        const store = read('mobile/ios/App/GripelloWidget/WidgetStore.swift')
        const save = store.slice(
            store.indexOf('static func saveSession('),
            store.indexOf('static func replaceSession('),
        )
        expect(save).toContain(
            'previous.userId != session.userId { dropSnapshots() }',
        )
    })

    it('reruns an Android widget load that a reload joined', () => {
        const job = read(
            'mobile/android/app/src/main/java/app/gripello/widget/WidgetUpdateJob.java',
        )
        expect(job).toContain('again = true;')
        expect(job).toContain('(current && again)')
    })

    it('declares the App Group defaults in the app and the widget privacy manifests', () => {
        for (const file of [
            'mobile/ios/App/App/PrivacyInfo.xcprivacy',
            'mobile/ios/App/GripelloWidget/PrivacyInfo.xcprivacy',
        ])
            expect(read(file)).toMatch(
                /<string>NSPrivacyAccessedAPICategoryUserDefaults<\/string>\s*<key>NSPrivacyAccessedAPITypeReasons<\/key>\s*<array>\s*<string>1C8F\.1<\/string>/,
            )
        const project = read('mobile/ios/App/App.xcodeproj/project.pbxproj')
        const phase = (id: string) =>
            project.match(
                new RegExp(`${id} /\\* Resources \\*/ = \\{[^}]*\\}`),
            )?.[0] ?? ''
        const target = (name: string) =>
            project.match(
                new RegExp(
                    `/\\* ${name} \\*/ = \\{\\s*isa = PBXNativeTarget;[^]*?(\\w+) /\\* Resources \\*/`,
                ),
            )?.[1] ?? ''
        for (const name of ['App', 'GripelloWidget'])
            expect(phase(target(name))).toContain(
                'PrivacyInfo.xcprivacy in Resources',
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

describe('android passkeys', () => {
    it('ships Credential Manager, which the WebView uses for passkeys', () => {
        const gradle = readFileSync('mobile/android/app/build.gradle', 'utf8')
        expect(gradle).toContain('androidx.credentials:credentials:')
        expect(gradle).toContain(
            'androidx.credentials:credentials-play-services-auth:',
        )
    })
})

describe('android system theme', () => {
    it('tells the page when the system switches between light and dark', () => {
        const activity = readFileSync(
            'mobile/android/app/src/main/java/app/gripello/MainActivity.java',
            'utf8',
        )
        expect(activity).toContain('public void onConfigurationChanged(')
        expect(activity).toContain("CustomEvent('gripello:system-theme'")
    })
})
