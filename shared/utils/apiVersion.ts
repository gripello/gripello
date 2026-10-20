import { parseSemver } from './version'

export type ApiVersionStatus = 'ok' | 'outdated' | 'unsupported'

export const API_VERSION_HEADER = 'X-Gripello-Api-Version'

export const NUXT_API_PREFIXES = ['/api/ui', '/api/version', '/api/cap']

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
