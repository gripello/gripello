import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useTvKiosk } from '~/composables/useTvKiosk'

describe('useTvKiosk', () => {
    it('releases a wake lock that arrives after the screen unmounted', async () => {
        vi.stubGlobal('useNuxtApp', () => ({ hook: () => () => {} }))
        vi.stubGlobal('useLiveGym', () => {})
        const release = vi.fn(async () => {})
        let grant!: (lock: { release: typeof release }) => void
        const realNavigator = navigator
        onTestFinished(() => vi.stubGlobal('navigator', realNavigator))
        vi.stubGlobal('navigator', {
            ...navigator,
            wakeLock: {
                request: () => new Promise((resolve) => (grant = resolve)),
            },
        })
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'visible',
        })
        onTestFinished(
            () =>
                delete (document as { visibilityState?: unknown })
                    .visibilityState,
        )

        const wrapper = mount(
            defineComponent({
                setup() {
                    useTvKiosk()
                    return () => h('div')
                },
            }),
        )
        wrapper.unmount()
        grant({ release })
        await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
    })
})
