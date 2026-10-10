import { createHmac, randomBytes } from 'node:crypto'

export const CAP_SCOPES = [
    'rating',
    'report',
    'task',
    'password-reset',
    'login',
    'register',
    'verification',
] as const
export type CapScope = (typeof CAP_SCOPES)[number]

const TOKEN_TTL_MS = 5 * 60 * 1000

export function capSecret(): string {
    return process.env.CAP_SECRET || ''
}

export function isCapScope(value: unknown): value is CapScope {
    return CAP_SCOPES.includes(value as CapScope)
}

function base64url(input: string | Buffer): string {
    return Buffer.from(input).toString('base64url')
}

export function signCapToken(
    secret: string,
    payload: Record<string, unknown>,
): string {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const body = base64url(JSON.stringify(payload))
    const signature = createHmac('sha256', secret)
        .update(`${header}.${body}`)
        .digest('base64url')
    return `${header}.${body}.${signature}`
}

export function buildRedeemToken(
    secret: string,
    scope: CapScope,
    challengeSignature: string,
): { token: string; expires: number } {
    const expires = Date.now() + TOKEN_TTL_MS
    const token = signCapToken(secret, {
        scope,
        jti: challengeSignature || randomBytes(16).toString('hex'),
        exp: Math.floor(expires / 1000),
    })
    return { token, expires }
}
