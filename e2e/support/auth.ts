import { createHmac } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

export const API_URL = process.env.E2E_API_URL || 'https://localhost'

export interface AuthResult {
    token: string
    record: Record<string, unknown>
}

export type Query = Record<
    string,
    string | number | boolean | string[] | null | undefined
>

export interface ApiRequest {
    token?: string
    method?: string
    body?: unknown
    query?: Query
    headers?: Record<string, string>
}

export class ApiError extends Error {
    constructor(
        readonly method: string,
        readonly path: string,
        readonly status: number,
        readonly response: unknown,
    ) {
        super(
            `${method} ${path} answered ${status}: ${JSON.stringify(response)}`,
        )
    }
}

export function apiUrl(path: string, query: Query = {}) {
    const url = new URL(`/api${path}`, API_URL)
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue
        for (const item of [value].flat())
            url.searchParams.append(key, String(item))
    }
    return url
}

export async function apiFetch<T>(
    path: string,
    { token, method = 'GET', body, query, headers }: ApiRequest = {},
): Promise<T> {
    const json = body !== undefined && !(body instanceof FormData)
    const response = await fetch(apiUrl(path, query), {
        method,
        headers: {
            ...(json && { 'content-type': 'application/json' }),
            ...(token && { authorization: `Bearer ${token}` }),
            ...headers,
        },
        body: json ? JSON.stringify(body) : (body as FormData | undefined),
    })
    const text = await response.text()
    let parsed: unknown = text
    try {
        parsed = text ? JSON.parse(text) : null
    } catch {}
    if (!response.ok) throw new ApiError(method, path, response.status, parsed)
    return parsed as T
}

export function login(email: string, password: string) {
    return apiFetch<AuthResult>('/auth/login', {
        method: 'POST',
        body: { identity: email, password },
    })
}

export function authCookieValue({ token, record }: AuthResult) {
    const value = encodeURIComponent(JSON.stringify({ token, record }))
    if (value.length <= 4000) return value
    const { id, email, verified } = record
    return encodeURIComponent(
        JSON.stringify({
            token,
            record: { id, email, verified },
        }),
    )
}

export async function signInAs(page: Page, email: string, password: string) {
    const baseURL = test.info().project.use.baseURL!
    await page.context().addCookies([
        {
            name: 'gripello_auth',
            value: authCookieValue(await login(email, password)),
            url: baseURL,
        },
    ])
}

export async function fillLogin(
    page: Page,
    identity: string,
    password: string,
) {
    const identityInput = page.getByTestId('login-identity')
    const passwordInput = page.getByTestId('login-password')
    await expect(async () => {
        await identityInput.fill(identity)
        await passwordInput.fill(password)
        await expect(identityInput).toHaveValue(identity, { timeout: 500 })
        await expect(passwordInput).toHaveValue(password, { timeout: 500 })
    }).toPass()
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function totp(secret: string, offset = 0) {
    const bits = [...secret.replace(/[\s=]/g, '').toUpperCase()]
        .map((char) => BASE32.indexOf(char).toString(2).padStart(5, '0'))
        .join('')
    const key = Buffer.from(
        bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)),
    )
    const counter = Buffer.alloc(8)
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset))
    const hash = createHmac('sha1', key).update(counter).digest()
    const start = hash[hash.length - 1]! & 0x0f
    return String((hash.readUInt32BE(start) & 0x7fffffff) % 1_000_000).padStart(
        6,
        '0',
    )
}

export async function typeCode(page: Page, testId: string, code: string) {
    await page.getByTestId(testId).locator('input').first().click()
    await page.keyboard.type(code)
}
