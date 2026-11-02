import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi } from '../api/apiMock'

let requestId: string | undefined

vi.mock('h3', () => ({
    createError: (input: unknown) => input,
    getHeader: (_: unknown, name: string) =>
        name === 'X-Request-Id' ? requestId : undefined,
}))

const { reportServerError, serverErrorReport } =
    await import('../../server/utils/serverErrors')

let api: ReturnType<typeof mockApi>

beforeEach(() => {
    api = mockApi()
    requestId = undefined
    globalThis.__NUXT_RUNTIME_CONFIG__ = {
        apiBase: 'http://go',
        public: { appVersion: '2.4.0' },
    }
})

describe('serverErrorReport', () => {
    it('reports the original error of a server crash', () => {
        const cause = new TypeError('gym is null')
        const report = serverErrorReport(
            { statusCode: 500, message: 'wrapped', cause },
            '/**',
            '2.4.0',
        )
        expect(report).toMatchObject({
            kind: 'ssr',
            message: 'TypeError: gym is null',
            route: '/**',
            version: '2.4.0',
        })
        expect(report?.stack).toContain('gym is null')
    })

    it('leaves out client errors and API failures Go has logged', () => {
        expect(
            serverErrorReport({ statusCode: 404, message: 'x' }, '', ''),
        ).toBeNull()
        expect(
            serverErrorReport(
                {
                    statusCode: 500,
                    message: '[GET] "http://go/api/gyms/x": 500 Internal',
                },
                '',
                '',
            ),
        ).toBeNull()
        const fetchError = Object.assign(new Error('boom'), {
            name: 'FetchError',
        })
        expect(
            serverErrorReport({ statusCode: 502, cause: fetchError }, '', ''),
        ).toBeNull()
    })

    it('cuts long messages and stacks', () => {
        const error = Object.assign(new Error('m'.repeat(900)), {
            stack: 's'.repeat(5000),
        })
        const report = serverErrorReport(error, '', '')
        expect(report?.message).toHaveLength(500)
        expect(report?.stack).toHaveLength(2000)
    })
})

describe('reportServerError', () => {
    it('posts the report with the page request id to the Go error log', async () => {
        requestId = 'nginx-req-1'
        await reportServerError(new Error('render failed'), {
            context: { matchedRoute: { path: '/api/ui/pdf' } },
        } as never)
        const request = api.request()
        expect(request.url).toBe('http://go/api/client-errors')
        expect(request.headers.get('X-Request-Id')).toBe('nginx-req-1')
        expect(request.body).toMatchObject({
            kind: 'ssr',
            message: 'Error: render failed',
            route: '/api/ui/pdf',
            version: '2.4.0',
        })
    })

    it('never fails the response it reports on', async () => {
        api.fetchMock.mockRejectedValueOnce(new Error('Go is down'))
        await expect(
            reportServerError(new Error('render failed')),
        ).resolves.toBeUndefined()
    })
})
