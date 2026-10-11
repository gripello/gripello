export interface Semver {
    major: number
    minor: number
    patch: number
}

export type ApiVersionStatus = 'ok' | 'outdated' | 'unsupported'

export const API_VERSION_HEADER = 'X-Gripello-Api-Version'

const NUXT_API_PREFIXES = ['/api/ui', '/api/manage', '/api/version', '/api/cap']

export function parseSemver(value: string | null | undefined): Semver | null {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value ?? '')
    if (!match) return null
    return { major: +match[1]!, minor: +match[2]!, patch: +match[3]! }
}

export function checkApiVersion(
    client: string | null | undefined,
    server: string | null | undefined,
): ApiVersionStatus {
    const a = parseSemver(client)
    const b = parseSemver(server)
    if (!a || !b) return 'ok'
    if (a.major !== b.major || a.minor > b.minor) return 'unsupported'
    return a.minor === b.minor && a.patch === b.patch ? 'ok' : 'outdated'
}

export function isGoApiPath(pathname: string) {
    return (
        pathname.startsWith('/api/') &&
        !NUXT_API_PREFIXES.some(
            (prefix) =>
                pathname === prefix || pathname.startsWith(`${prefix}/`),
        )
    )
}
