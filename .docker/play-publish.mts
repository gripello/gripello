import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

interface ServiceAccount {
    client_email: string
    private_key: string
    token_uri: string
}

const API = 'https://androidpublisher.googleapis.com'
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher'

export const RELEASE_NOTES = [
    { language: 'en-US', text: 'Bug fixes and improvements.' },
    { language: 'de-DE', text: 'Fehlerbehebungen und Verbesserungen.' },
    { language: 'es-ES', text: 'Corrección de errores y mejoras.' },
    { language: 'fr-FR', text: 'Corrections de bugs et améliorations.' },
    { language: 'nl-NL', text: 'Bugfixes en verbeteringen.' },
]

const base64url = (value: string | Buffer) =>
    Buffer.from(value).toString('base64url')

export function serviceAccountAssertion(
    account: ServiceAccount,
    now = Math.floor(Date.now() / 1000),
) {
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claims = base64url(
        JSON.stringify({
            iss: account.client_email,
            scope: SCOPE,
            aud: account.token_uri,
            iat: now,
            exp: now + 3600,
        }),
    )
    const signature = createSign('RSA-SHA256')
        .update(`${header}.${claims}`)
        .sign(account.private_key)
    return `${header}.${claims}.${base64url(signature)}`
}

export async function publishBundle(options: {
    account: ServiceAccount
    packageName: string
    bundle: Buffer
    track: string
    status: string
    fetch?: typeof fetch
}) {
    const send = options.fetch ?? fetch
    const call = async (url: string, init: RequestInit = {}) => {
        const response = await send(url, init)
        if (!response.ok)
            throw new Error(
                `${init.method ?? 'GET'} ${url}: ${response.status} ${await response.text()}`,
            )
        return response.json()
    }

    const { access_token } = await call(options.account.token_uri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: serviceAccountAssertion(options.account),
        }),
    })
    const auth = { Authorization: `Bearer ${access_token}` }
    const app = `applications/${options.packageName}`

    const edit = await call(`${API}/androidpublisher/v3/${app}/edits`, {
        method: 'POST',
        headers: auth,
    })
    const editPath = `${app}/edits/${edit.id}`
    try {
        const { versionCode } = await call(
            `${API}/upload/androidpublisher/v3/${editPath}/bundles?uploadType=media`,
            {
                method: 'POST',
                headers: {
                    ...auth,
                    'Content-Type': 'application/octet-stream',
                },
                body: options.bundle,
            },
        )
        await call(
            `${API}/androidpublisher/v3/${editPath}/tracks/${options.track}`,
            {
                method: 'PUT',
                headers: { ...auth, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    track: options.track,
                    releases: [
                        {
                            versionCodes: [String(versionCode)],
                            status: options.status,
                            releaseNotes: RELEASE_NOTES,
                        },
                    ],
                }),
            },
        )
        await call(`${API}/androidpublisher/v3/${editPath}:commit`, {
            method: 'POST',
            headers: auth,
        })
        return versionCode as number
    } catch (error) {
        await send(`${API}/androidpublisher/v3/${editPath}`, {
            method: 'DELETE',
            headers: auth,
        }).catch(() => null)
        // A rerun of a release build: the committed edit already used this version code.
        if (/already been used/i.test(String(error))) return null
        throw error
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [account, packageName, bundle, track, status] = process.argv.slice(2)
    const versionCode = await publishBundle({
        account: JSON.parse(readFileSync(account!, 'utf8')),
        packageName: packageName!,
        bundle: readFileSync(bundle!),
        track: track!,
        status: status!,
    })
    console.log(
        versionCode === null
            ? `${packageName}: this version code is already on Play, nothing to publish`
            : `Published ${packageName} ${versionCode} to ${track} (${status})`,
    )
}
