import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import RoutePage from '~/pages/route.vue'
import { getRoute } from '~/api/routes'

vi.mock('~/api/routes', () => ({ getRoute: vi.fn() }))

async function redirectError(failure: unknown) {
    vi.mocked(getRoute).mockRejectedValueOnce(failure)
    let thrown: unknown
    mount(
        defineComponent({
            components: { RoutePage },
            template: '<Suspense><RoutePage /></Suspense>',
        }),
        {
            global: {
                config: {
                    errorHandler: (error) => {
                        thrown = error
                    },
                },
            },
        },
    )
    await flushPromises()
    return thrown as { status?: number; fatal?: boolean }
}

describe('/route?id= redirect', () => {
    beforeEach(() => {
        vi.stubGlobal('useRoute', () => ({ query: { id: 'r1' }, hash: '' }))
        vi.stubGlobal('navigateTo', vi.fn())
        vi.stubGlobal(
            'createError',
            (options: { status?: number; statusCode?: number }) =>
                Object.assign(new Error('page error'), {
                    ...options,
                    status: options.status ?? options.statusCode,
                }),
        )
    })

    it('answers 404 only for an unknown route', async () => {
        expect((await redirectError({ status: 404 })).status).toBe(404)
    })

    it('surfaces outages and rate limits instead of a 404', async () => {
        expect(await redirectError({ status: 0 })).toMatchObject({
            status: 503,
            fatal: true,
        })
        expect((await redirectError({ status: 429 })).status).toBe(429)
    })
})
