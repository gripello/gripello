import { describe, expect, it, vi } from 'vitest'
import { createReporter, routePattern } from '~/utils/clientErrors'

const context = { route: '/:gym/routes', version: '1.2.0' }

describe('createReporter', () => {
    it('sends each message once per page load', () => {
        const send = vi.fn()
        const report = createReporter(send)
        const error = new TypeError('x is undefined')
        report('vue', error, context)
        report('window', error, context)
        expect(send).toHaveBeenCalledTimes(1)
        expect(send.mock.calls[0]?.[0]).toMatchObject({
            kind: 'vue',
            message: 'TypeError: x is undefined',
            route: '/:gym/routes',
            version: '1.2.0',
        })
    })

    it('skips API failures, aborts, network drops, 4xx Nuxt errors and browser noise', () => {
        const send = vi.fn()
        const report = createReporter(send)
        const apiError = Object.assign(new Error('Not found'), {
            name: 'ApiError',
        })
        report('promise', apiError, context)
        report('promise', new DOMException('aborted', 'AbortError'), context)
        report('promise', new TypeError('Failed to fetch'), context)
        report('window', 'ResizeObserver loop limit exceeded', context)
        report('window', 'Script error.', context)
        report(
            'nuxt',
            Object.assign(new Error('Gym not found'), { statusCode: 404 }),
            context,
        )
        expect(send).not.toHaveBeenCalled()
        report(
            'nuxt',
            Object.assign(new Error('Server broke'), { statusCode: 500 }),
            context,
        )
        expect(send).toHaveBeenCalledTimes(1)
    })

    it('stops after ten reports', () => {
        const send = vi.fn()
        const report = createReporter(send)
        for (let i = 0; i < 15; i++) report('vue', new Error(`e${i}`), context)
        expect(send).toHaveBeenCalledTimes(10)
    })
})

describe('routePattern', () => {
    it('uses the matched pattern, not the visited path', () => {
        expect(routePattern([{ path: '/' }, { path: '/:gym/routes' }])).toBe(
            '/:gym/routes',
        )
        expect(routePattern([])).toBe('')
    })
})
