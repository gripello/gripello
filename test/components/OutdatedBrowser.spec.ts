import { mount, flushPromises } from '@vue/test-utils'
import { Capacitor } from '@capacitor/core'
import OutdatedBrowser from '~/components/layout/OutdatedBrowser.vue'

const UAlert = {
    props: ['title', 'actions'],
    template:
        '<div data-testid="outdated-browser">{{ title }}<a v-for="a in actions" :href="a.to">{{ a.label }}</a></div>',
}

function render(supports: boolean, native: boolean) {
    vi.stubGlobal('CSS', { supports: () => supports })
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(native)
    return mount(OutdatedBrowser, {
        global: { stubs: { UAlert }, mocks: { $t: (key: string) => key } },
    })
}

describe('OutdatedBrowser', () => {
    afterEach(() => vi.restoreAllMocks())

    it('stays hidden where color-mix works', async () => {
        const wrapper = render(true, true)
        await flushPromises()
        expect(wrapper.find('[data-testid="outdated-browser"]').exists()).toBe(
            false,
        )
    })

    it('links the app to the WebView update', async () => {
        const wrapper = render(false, true)
        await flushPromises()
        expect(wrapper.text()).toContain('outdatedBrowser.webview')
        expect(wrapper.find('a').attributes('href')).toContain(
            'id=com.google.android.webview',
        )
    })

    it('asks browsers for an update without a store link', async () => {
        const wrapper = render(false, false)
        await flushPromises()
        expect(wrapper.text()).toContain('outdatedBrowser.browser')
        expect(wrapper.find('a').exists()).toBe(false)
    })
})
