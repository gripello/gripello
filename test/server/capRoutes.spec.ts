// @vitest-environment node
import { createHmac } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, createRouter, toNodeListener } from 'h3'
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import challenge from '../../server/api/cap/[scope]/challenge.post'
import redeem from '../../server/api/cap/[scope]/redeem.post'

const SECRET = 'a-test-secret-of-32-characters!!'

const solved = vi.hoisted(() => ({ pass: false }))
vi.mock('capjs-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('capjs-core')>()
    return {
        ...actual,
        validateChallenge: async (
            secret: string,
            body: { token: string; solutions: number[] },
            opts: Parameters<typeof actual.validateChallenge>[2],
        ) => {
            const result = await actual.validateChallenge(secret, body, opts)
            if (result.reason !== 'invalid_solution' || !solved.pass)
                return result
            await opts?.consumeNonce?.(body.token.split('.')[2]!, 1)
            return { success: true }
        },
    }
})

let server: Server
let base = ''

beforeAll(async () => {
    const router = createRouter()
        .post('/api/cap/:scope/challenge', challenge)
        .post('/api/cap/:scope/redeem', redeem)
    server = createServer(toNodeListener(createApp().use(router)))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => server.close())

beforeEach(() => {
    vi.stubEnv('CAP_SECRET', SECRET)
    solved.pass = false
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

const post = (path: string, body?: unknown) =>
    fetch(`${base}/api/cap/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
    })

async function challengeFor(scope: string) {
    const res = await post(`${scope}/challenge`)
    expect(res.status).toBe(200)
    return (await res.json()) as {
        token: string
        challenge: { c: number }
    }
}

function decode(jwt: string) {
    const [header, body, signature] = jwt.split('.')
    const expected = createHmac('sha256', SECRET)
        .update(`${header}.${body}`)
        .digest('base64url')
    expect(signature).toBe(expected)
    return JSON.parse(Buffer.from(body!, 'base64url').toString())
}

describe('cap routes', () => {
    it('answer 503 while no secret is configured', async () => {
        vi.stubEnv('CAP_SECRET', '')
        expect((await post('login/challenge')).status).toBe(503)
        expect((await post('login/redeem')).status).toBe(503)
    })

    it('refuse unknown scopes', async () => {
        expect((await post('admin/challenge')).status).toBe(404)
        expect((await post('admin/redeem')).status).toBe(404)
    })

    it('reject a challenge redeemed for another scope', async () => {
        const { token, challenge } = await challengeFor('login')
        solved.pass = true
        const res = await post('register/redeem', {
            token,
            solutions: Array(challenge.c).fill(0),
        })
        expect(res.status).toBe(400)
    })

    it('reject wrong solutions', async () => {
        const { token, challenge } = await challengeFor('login')
        const res = await post('login/redeem', {
            token,
            solutions: Array(challenge.c).fill(0),
        })
        expect(res.status).toBe(400)
    })

    it('issue a scoped token whose jti is the challenge, so it redeems once', async () => {
        const { token, challenge } = await challengeFor('rating')
        solved.pass = true
        const body = { token, solutions: Array(challenge.c).fill(0) }
        const first = await (await post('rating/redeem', body)).json()
        const second = await (await post('rating/redeem', body)).json()

        const claims = decode(first.token)
        expect(claims.scope).toBe('rating')
        expect(claims.jti).toBe(token.split('.')[2])
        expect(decode(second.token).jti).toBe(claims.jti)
        expect(claims.exp * 1000).toBeGreaterThan(Date.now())
        expect(claims.exp * 1000).toBeLessThanOrEqual(Date.now() + 5 * 60_000)
    })
})
