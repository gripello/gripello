import { createVerify, generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES } from '~/utils/locales'
import {
    publishBundle,
    RELEASE_NOTES,
    serviceAccountAssertion,
} from '../../.docker/play-publish.mts'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
})
const account = {
    client_email: 'ci@gripello.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    token_uri: 'https://oauth2.googleapis.com/token',
}

describe('serviceAccountAssertion', () => {
    it('signs a token request for the Android Publisher API', () => {
        const [header, claims, signature] = serviceAccountAssertion(
            account,
            1000,
        ).split('.')
        expect(
            createVerify('RSA-SHA256')
                .update(`${header}.${claims}`)
                .verify(publicKey, Buffer.from(signature!, 'base64url')),
        ).toBe(true)
        expect(
            JSON.parse(Buffer.from(claims!, 'base64url').toString()),
        ).toEqual({
            iss: account.client_email,
            scope: 'https://www.googleapis.com/auth/androidpublisher',
            aud: account.token_uri,
            iat: 1000,
            exp: 4600,
        })
    })
})

describe('publishBundle', () => {
    it('uploads the bundle into a new edit, assigns it to the track and commits', async () => {
        const calls: { url: string; init: RequestInit }[] = []
        const answers = [
            { access_token: 'token' },
            { id: 'edit1' },
            { versionCode: 20301 },
            {},
            {},
        ]
        const fetch = async (url: string, init: RequestInit) => {
            calls.push({ url, init })
            return Response.json(answers[calls.length - 1])
        }
        const bundle = Buffer.from('aab')

        await expect(
            publishBundle({
                account,
                packageName: 'app.gripello',
                bundle,
                track: 'alpha',
                status: 'draft',
                fetch: fetch as typeof globalThis.fetch,
            }),
        ).resolves.toBe(20301)

        const app =
            'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/app.gripello'
        expect(calls.map((call) => `${call.init.method} ${call.url}`)).toEqual([
            'POST https://oauth2.googleapis.com/token',
            `POST ${app}/edits`,
            'POST https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/app.gripello/edits/edit1/bundles?uploadType=media',
            `PUT ${app}/edits/edit1/tracks/alpha`,
            `POST ${app}/edits/edit1:commit`,
        ])
        expect(calls[2]!.init.body).toBe(bundle)
        expect(calls[3]!.init.headers).toMatchObject({
            Authorization: 'Bearer token',
        })
        expect(JSON.parse(calls[3]!.init.body as string)).toEqual({
            track: 'alpha',
            releases: [
                {
                    versionCodes: ['20301'],
                    status: 'draft',
                    releaseNotes: RELEASE_NOTES,
                },
            ],
        })
    })

    const failingAt = (step: number, answer: Response) => {
        const calls: string[] = []
        const fetch = async (url: string, init: RequestInit) => {
            calls.push(`${init.method} ${url}`)
            return calls.length === step
                ? answer
                : Response.json({ access_token: 'token', id: 'edit1' })
        }
        const publish = () =>
            publishBundle({
                account,
                packageName: 'app.gripello',
                bundle: Buffer.from('aab'),
                track: 'alpha',
                status: 'draft',
                fetch: fetch as typeof globalThis.fetch,
            })
        return { calls, publish }
    }
    const discardEdit =
        'DELETE https://androidpublisher.googleapis.com/androidpublisher/v3/applications/app.gripello/edits/edit1'

    it('fails with the API answer and discards the half-done edit', async () => {
        const { calls, publish } = failingAt(
            4,
            new Response('Track alpha is not available.', { status: 400 }),
        )

        await expect(publish()).rejects.toThrow(
            '400 Track alpha is not available.',
        )
        expect(calls).toHaveLength(5)
        expect(calls.at(-1)).toBe(discardEdit)
    })

    it('treats a version code Play already has as published, so release reruns stay green', async () => {
        const { calls, publish } = failingAt(
            3,
            Response.json(
                {
                    error: {
                        message: 'Version code 20301 has already been used.',
                    },
                },
                { status: 403 },
            ),
        )

        await expect(publish()).resolves.toBeNull()
        expect(calls.at(-1)).toBe(discardEdit)
        expect(calls.some((call) => call.endsWith(':commit'))).toBe(false)
    })
})

describe('RELEASE_NOTES', () => {
    it('covers every app language within the Play limit', () => {
        expect(
            RELEASE_NOTES.map((note) => note.language.slice(0, 2)).sort(),
        ).toEqual(SUPPORTED_LOCALES.map((locale) => locale.code).sort())
        for (const note of RELEASE_NOTES)
            expect(note.text.length).toBeLessThanOrEqual(500)
    })
})

describe('play store release in CI', () => {
    const dockerfile = readFileSync('Dockerfile', 'utf8')
    const jenkinsfile = readFileSync('Jenkinsfile', 'utf8')

    it('signs with the upload key and pushes only the release bundle', () => {
        expect(dockerfile).toContain('FROM android AS android-release')
        expect(dockerfile).toContain('ANDROID_KEY_ALIAS=upload')
        expect(dockerfile).toContain('./gradlew --no-daemon -q bundleRelease')
        expect(dockerfile).toContain(
            'node /app/.docker/play-publish.mts /run/secrets/play_service_account app.gripello',
        )
    })

    it('passes every secret the release stage mounts', () => {
        const mounted = [
            ...dockerfile.matchAll(/--mount=type=secret,id=([\w-]+)/g),
        ].map((match) => match[1])
        const passed = [...jenkinsfile.matchAll(/--secret id=([\w-]+)/g)].map(
            (match) => match[1],
        )
        expect(mounted.length).toBeGreaterThan(0)
        expect(new Set(passed)).toEqual(new Set(mounted))
    })

    it('archives the signed bundle before failing on an upload error', () => {
        expect(dockerfile).toMatch(
            /\{ node \/app\/\.docker\/play-publish\.mts .+; echo \$\? > \/release\/exit-code; \}/,
        )
        const stage = jenkinsfile.slice(
            jenkinsfile.indexOf("stage('Play Store')"),
        )
        expect(stage.indexOf('archiveArtifacts')).toBeLessThan(
            stage.indexOf("readFile('test-results/android-release/exit-code')"),
        )
    })

    it('publishes only from release commits', () => {
        expect(jenkinsfile).toMatch(
            /stage\('Play Store'\) \{\s*when \{ expression \{ env\.IS_RELEASE == 'true' \} \}/,
        )
    })
})
