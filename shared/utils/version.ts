export interface InstalledVersion {
    raw: string
    base: string | null
    ahead: number
    sha: string | null
}

const DESCRIBE = /^(\d+\.\d+\.\d+)-(\d+)-g([0-9a-f]{7,40})$/i
export interface Semver {
    major: number
    minor: number
    patch: number
}

export function parseSemver(
    value: unknown,
    { exact = false } = {},
): Semver | null {
    const match = (
        exact ? /^v?(\d+)\.(\d+)\.(\d+)$/ : /^v?(\d+)\.(\d+)\.(\d+)/
    ).exec(String(value ?? '').trim())
    if (!match) return null
    return { major: +match[1]!, minor: +match[2]!, patch: +match[3]! }
}

export function compareSemver(a: unknown, b: unknown): number | null {
    const left = parseSemver(a, { exact: true })
    const right = parseSemver(b, { exact: true })
    if (!left || !right) return null
    return (
        Math.sign(left.major - right.major) ||
        Math.sign(left.minor - right.minor) ||
        Math.sign(left.patch - right.patch)
    )
}

const SHA = /^[0-9a-f]{7,40}$/i

export function parseAppVersion(raw: unknown): InstalledVersion {
    const value = String(raw ?? '')
        .trim()
        .replace(/^v/, '')

    const describe = value.match(DESCRIBE)
    if (describe)
        return {
            raw: value,
            base: describe[1]!,
            ahead: Number(describe[2]),
            sha: describe[3]!,
        }

    if (parseSemver(value, { exact: true }))
        return { raw: value, base: value, ahead: 0, sha: null }

    if (SHA.test(value)) return { raw: value, base: null, ahead: 0, sha: value }

    return { raw: value, base: null, ahead: 0, sha: null }
}

export function versionLabel(raw: unknown, dev = false) {
    const version = parseAppVersion(raw)
    const label =
        version.base && version.sha && version.ahead > 0
            ? `${version.base}-${version.sha.slice(0, 7)}`
            : version.raw || 'dev'
    return dev && label !== 'dev' ? `${label}-dev` : label
}
