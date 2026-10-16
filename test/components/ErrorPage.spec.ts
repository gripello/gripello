import { mount } from '@vue/test-utils'
import ErrorPage from '~/error.vue'

const slotStub = { template: '<div><slot /></div>' }
const buttonStub = {
    template: '<button @click="$emit(\'click\')"><slot /></button>',
}

const clearError = vi.fn(() => Promise.resolve())
const reloadNuxtApp = vi.fn()

function createWrapper(status: number) {
    vi.stubGlobal('useHead', vi.fn())
    vi.stubGlobal('useBrowserChrome', vi.fn())
    vi.stubGlobal('useRouter', () => ({ back: vi.fn() }))
    vi.stubGlobal('clearError', clearError)
    vi.stubGlobal('reloadNuxtApp', reloadNuxtApp)
    return mount(ErrorPage, {
        props: { error: { status } as never },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                NuxtLayout: slotStub,
                VApp: slotStub,
                'v-container': slotStub,
                'v-icon': true,
                'v-btn': buttonStub,
            },
        },
    })
}

describe('error page', () => {
    beforeEach(() => vi.clearAllMocks())

    it('shows the not found copy for 404', async () => {
        const wrapper = createWrapper(404)

        expect(wrapper.text()).toContain('404')
        expect(wrapper.text()).toContain('errors.notFound.title')
        expect(wrapper.find('[data-testid="error-back"]').exists()).toBe(true)
        expect(wrapper.find('[data-testid="error-retry"]').exists()).toBe(false)
    })

    it('shows the server error copy and retries for 500', async () => {
        const wrapper = createWrapper(500)

        expect(wrapper.text()).toContain('500')
        expect(wrapper.text()).toContain('errors.server.title')
        await wrapper.find('[data-testid="error-retry"]').trigger('click')
        expect(reloadNuxtApp).toHaveBeenCalled()
    })

    it('says the climber is offline and retries once the connection is back', async () => {
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
        const wrapper = createWrapper(500)
        await wrapper.vm.$nextTick()

        expect(wrapper.text()).toContain('errors.offline.title')
        window.dispatchEvent(new Event('online'))
        expect(reloadNuxtApp).toHaveBeenCalled()
        wrapper.unmount()
        vi.restoreAllMocks()
    })

    it('clears the error and redirects home', async () => {
        const wrapper = createWrapper(404)

        await wrapper.find('[data-testid="error-home"]').trigger('click')
        expect(clearError).toHaveBeenCalledWith({ redirect: '/' })
    })
})
