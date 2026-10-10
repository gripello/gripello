import { vi } from 'vitest'
import { ofetch } from 'ofetch'

export function jsonResponse(body: unknown, status = 200) {
    return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    })
}

export function mockApi() {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    Object.assign(globalThis.$fetch, { create: ofetch.create })

    function respond(body: unknown, status = 200) {
        fetchMock.mockResolvedValueOnce(jsonResponse(body, status))
    }

    function request(index = -1) {
        const [url, init = {}] = fetchMock.mock.calls.at(index) as unknown as [
            string,
            RequestInit,
        ]
        const body = init.body
        return {
            url,
            method: init.method ?? 'GET',
            headers: new Headers(init.headers),
            body: typeof body === 'string' ? JSON.parse(body) : body,
        }
    }

    return { fetchMock, respond, request }
}

export function routeApi(handler: (path: string, options?: object) => unknown) {
    Object.assign(globalThis.$fetch, { create: () => handler })
}
